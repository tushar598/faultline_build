// Ported from the reference repo (ops/scripts/demo/demo-3-subscribe.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Full demo phase 3 — subscription inside the issuance window, in ONE owner run (the keystore is unlocked once):
//   sponsor   fUSD.approve(pool, 1 USD) → pool.fundCoupons(1 USD)   (D6; >= requiredReserve(500 USD); the unused
//             part returns to the sponsor through sweepExcess in phase 6)
//   investorA fUSD.approve(pool, 300 USD) → pool.invest(300 USD)      (the pool mints 300 FLDMO units, D4)
//   investorB fUSD.approve(pool, 200 USD) → pool.invest(200 USD)
// ABORTS WITH NOTHING SENT unless phase 2's assertions passed, the pool is associated + KYC'd for fUSD, sponsor/A/B are
// KYC'd with enough fUSD, A and B have bond KYC, requiredReserve <= 1 USD, and the latest block is inside
// [issuanceStart, issuanceEnd) with >= MIN_REMAINING_SEC (default 180 s) left. Steps skip themselves when done.
import { mirror } from "../lib/hedera.js";
import {
  ACCOUNTS, EXECUTE, RESERVE, TICKET, TOTAL_UNITS, balances, bondAt, eventually, iso, latestTs, loadDemo, poolAt, printHbar, printInvariants, provider, report,
  saveSmoke, tokenAt, tx, untilSimulates, useFaultlineErrors, usd,
} from "./lib.js";

const PHASE = "demo-3";
const MIN_REMAINING_SEC = Number(process.env.MIN_REMAINING_SEC ?? "180");
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadDemo();

console.log("plan (one EXECUTE run, 6 transactions, each simulated right before it is sent):");
console.log(`  1. sponsor   fUSD.approve(pool, ${usd(RESERVE)})          2. sponsor   pool.fundCoupons(${usd(RESERVE)})`);
console.log(`  3. investorA fUSD.approve(pool, ${usd(TICKET.investorA)})        4. investorA pool.invest(${usd(TICKET.investorA)})`);
console.log(`  5. investorB fUSD.approve(pool, ${usd(TICKET.investorB)})        6. investorB pool.invest(${usd(TICKET.investorB)})`);
console.log("  HBAR (smoke measured): approve 0.80 each, fundCoupons 0.08, invest 0.52–0.60 → sponsor ≈ 0.88, A ≈ 1.40, B ≈ 1.32");

if (!st.pool || !st.trigger) {
  console.log("\nthe pool does not exist yet (phase 2) — plan only, nothing simulated");
  await printHbar(start);
  process.exit(0);
}

// ------------------------------------------------------------ preconditions
const pool = poolAt(p);
const poolAddr = String(st.pool);
const problems: string[] = [];
if (!st.deployVerifiedAt) problems.push("phase 2 assertions have not passed (deployVerifiedAt missing)");
if ((await pool.trigger()) === "0x0000000000000000000000000000000000000000") problems.push("pool is not initialized");
const rel = async (id: string) => (await mirror<{ tokens: { kyc_status: string; balance: number }[] }>(`/api/v1/accounts/${id}/tokens?token.id=${st.token}`))?.tokens?.[0];
const poolRel = await rel(String(st.poolId));
if (poolRel?.kyc_status !== "GRANTED") problems.push(`pool ${st.poolId} fUSD relationship: ${poolRel ? `kyc ${poolRel.kyc_status}` : "not associated"}`);
for (const [r, need] of [["sponsor", RESERVE], ["investorA", TICKET.investorA], ["investorB", TICKET.investorB]] as const) {
  const x = await rel(ACCOUNTS[r].id!);
  if (x?.kyc_status !== "GRANTED") problems.push(`${r} fUSD KYC is ${x?.kyc_status ?? "not associated"}`);
  if (BigInt(x?.balance ?? 0) < need) problems.push(`${r} holds ${usd(BigInt(x?.balance ?? 0))} fUSD < ${usd(need)}`);
}
for (const r of ["investorA", "investorB"] as const) if ((await bondAt(p).getKycStatusFor(ACCOUNTS[r].evm)) !== 1n) problems.push(`${r} has no bond KYC`);
const required = await pool.requiredReserve(TOTAL_UNITS);
if (required > RESERVE) problems.push(`requiredReserve(${usd(TOTAL_UNITS)}) = ${usd(required)} > ${usd(RESERVE)}`);
const [iStart, iEnd] = [Number(await pool.issuanceStart()), Number(await pool.issuanceEnd())];
const now = await latestTs(p);
console.log(`\nissuance window [${iso(iStart)}, ${iso(iEnd)}), latest block ${iso(now)}: ${now < iStart ? `opens in ${iStart - now} s` : now >= iEnd ? "CLOSED" : `${iEnd - now} s left`}`);
console.log(`requiredReserve(${usd(TOTAL_UNITS)}) = ${usd(required)} fUSD; funding ${usd(RESERVE)}`);
if (now < iStart) problems.push(`issuance not open yet (opens ${iso(iStart)}, in ${iStart - now} s)`);
else if (now >= iEnd) problems.push("issuance window is closed");
else if (iEnd - now < MIN_REMAINING_SEC) problems.push(`only ${iEnd - now} s left in the issuance window (< ${MIN_REMAINING_SEC} s)`);
if (problems.length) {
  console.log("\npreconditions:");
  for (const x of problems) console.log(`  ✖ ${x}`);
  if (EXECUTE) {
    console.log("ABORT — nothing sent.");
    process.exitCode = 1;
    process.exit();
  }
  console.log("(dry run: continuing to simulate what can be simulated)");
} else console.log("preconditions: all ✓");

// ------------------------------------------------------------ the six transactions
const token = tokenAt(p);
async function approveAndCall(role: "sponsor" | "investorA" | "investorB", amount: bigint, method: "fundCoupons" | "invest", done: () => Promise<boolean>, ready?: { label: string; check: () => Promise<boolean> }) {
  if (ready && EXECUTE) {
    if (!(await eventually(ready.check, (v: boolean) => v === true))) throw new Error(`${role}: ${ready.label} still not visible through the RPC after ~30 s — stopped before sending`);
    console.log(`\n  ${ready.label}: visible ✓`);
  }
  if (await done()) {
    console.log(`\n[${PHASE}] ${role} ${method} already done — skip`);
    return;
  }
  const allowance: bigint = await token.allowance(ACCOUNTS[role].evm, poolAddr);
  if (allowance >= amount) console.log(`\n[${PHASE}] ${role} allowance already ${usd(allowance)} — skip approve`);
  else await tx(PHASE, role, `${role} fUSD.approve(pool, ${usd(amount)})`, token, "approve", [poolAddr, amount]);
  if (!EXECUTE && allowance < amount) {
    console.log(`\n[${PHASE}] ${role} pool.${method}(${usd(amount)})\n  simulation deferred: needs the approve above (allowance now ${usd(allowance)})`);
    return;
  }
  if (EXECUTE) {
    await eventually(() => token.allowance(ACCOUNTS[role].evm, poolAddr), (v: bigint) => v >= amount);
    await untilSimulates(pool, method, [amount], ACCOUNTS[role].evm, 45);
  }
  await tx(PHASE, role, `${role} pool.${method}(${usd(amount)})`, pool, method, [amount]);
}
await approveAndCall("sponsor", RESERVE, "fundCoupons", async () => (await pool.couponReserve()) >= RESERVE);
await approveAndCall("investorA", TICKET.investorA, "invest", async () => (await bondAt(p).balanceOf(ACCOUNTS.investorA.evm)) >= TICKET.investorA, {
  label: `pool.couponReserve() >= ${usd(RESERVE)} (sponsor's fundCoupons)`,
  check: async () => (await pool.couponReserve()) >= RESERVE,
});
await approveAndCall("investorB", TICKET.investorB, "invest", async () => (await bondAt(p).balanceOf(ACCOUNTS.investorB.evm)) >= TICKET.investorB, {
  label: `investor A's ${usd(TICKET.investorA)} (bond balance and unitsIssued)`,
  check: async () => (await bondAt(p).balanceOf(ACCOUNTS.investorA.evm)) >= TICKET.investorA && (await pool.unitsIssued()) >= TICKET.investorA,
});

// ------------------------------------------------------------ assertions
if (EXECUTE || (await pool.unitsIssued()) > 0n) {
  const b = bondAt(p);
  const supply: bigint = await eventually(() => b.totalSupply(), (v: bigint) => v === TOTAL_UNITS);
  const ok = report("assertions", [
    [`bond.totalSupply() ${usd(supply)} == unitsIssued == ${usd(TOTAL_UNITS)}`, supply === TOTAL_UNITS && (await pool.unitsIssued()) === TOTAL_UNITS],
    [`bond.balanceOf(A) == ${usd(TICKET.investorA)}`, (await b.balanceOf(ACCOUNTS.investorA.evm)) === TICKET.investorA],
    [`bond.balanceOf(B) == ${usd(TICKET.investorB)}`, (await b.balanceOf(ACCOUNTS.investorB.evm)) === TICKET.investorB],
    [`couponReserve == ${usd(RESERVE)}`, (await pool.couponReserve()) === RESERVE],
    [`pool fUSD balance == ${usd(TOTAL_UNITS + RESERVE)}`, (await token.balanceOf(poolAddr)) === TOTAL_UNITS + RESERVE],
  ]);
  if (!ok) process.exitCode = 1;
  else saveSmoke({ subscribedAt: new Date().toISOString() });
}
await printInvariants(p);
await printHbar(start);
