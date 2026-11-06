// Smoke phase 4 — subscription inside the pool's issuance window, all in ONE owner run (the keystore password is asked
// once per process; hardhat-keystore caches the unlocked keystore):
//   sponsor   fUSD.approve(pool, 1 USD) → pool.fundCoupons(1 USD)   (D6; >= requiredReserve(1,000 USD); the excess
//             returns to the sponsor through sweepExcess in phase 6)
//   investorA fUSD.approve(pool, 600 USD) → pool.invest(600 USD)      (mints 600 FLSMK units through the pool, D4)
//   investorB fUSD.approve(pool, 400 USD) → pool.invest(400 USD)
// Every tx is simulated right before it is sent (common.step); a failed simulation or tx stops the run.
//
// ABORTS WITH NOTHING SENT unless: phase 3 assertions passed; the pool is initialized and associated + KYC'd for fUSD;
// sponsor/A/B are KYC'd with enough fUSD; A and B have bond KYC; requiredReserve(1,000 USD) <= 1 USD; and the latest
// block time is inside [issuanceStart, issuanceEnd) with at least MIN_REMAINING_SEC (default 180 s) left, so the six
// transactions cannot be cut in half by the window closing.
// Each step skips itself when already done (allowance, couponReserve, bond balance), so a rerun resumes.
import { ACCOUNTS, EXECUTE, USD, balances, bondAt, eventually, latestTs, loadSmoke, poolAt, printHbar, printInvariants, provider, saveSmoke, tokenAt, tx, untilSimulates, useFaultlineErrors, usd } from "./lib.js";
import { mirror } from "../lib/hedera.js";

const PHASE = "smoke-4";
const RESERVE = USD(1n);
const TICKET = { investorA: USD(600n), investorB: USD(400n) } as const;
const TOTAL_UNITS = USD(1_000n);
const MIN_REMAINING_SEC = Number(process.env.MIN_REMAINING_SEC ?? "180");
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadSmoke();
const iso = (s: number) => new Date(s * 1000).toISOString().slice(11, 19) + "Z";

console.log("plan (one EXECUTE run, 6 transactions, each simulated right before it is sent):");
console.log(`  1. sponsor   fUSD.approve(pool, ${usd(RESERVE)})          2. sponsor   pool.fundCoupons(${usd(RESERVE)})`);
console.log(`  3. investorA fUSD.approve(pool, ${usd(TICKET.investorA)})        4. investorA pool.invest(${usd(TICKET.investorA)})`);
console.log(`  5. investorB fUSD.approve(pool, ${usd(TICKET.investorB)})        6. investorB pool.invest(${usd(TICKET.investorB)})`);
console.log("  HBAR estimate: approve ≈ 0.80 each (S3/smoke-1: HTS facade approve 727,020 gas), fundCoupons ≈ 0.2, invest ≈ 0.8 each (first ATS mint S1 477,449 gas + transferFrom + 2 isKyc) → sponsor ≈ 1.0, A ≈ 1.6, B ≈ 1.6");

if (!st.pool || !st.trigger) {
  console.log("\nthe pool does not exist yet (phase 3) — plan only, nothing simulated");
  await printHbar(start);
  process.exit(0);
}

// ------------------------------------------------------------ preconditions (abort with nothing sent)
const pool = poolAt(p);
const poolAddr = String(st.pool);
const problems: string[] = [];
if (!st.deployVerifiedAt) problems.push("phase 3 assertions have not passed (deployVerifiedAt missing)");
if ((await pool.trigger()) === "0x0000000000000000000000000000000000000000") problems.push("pool is not initialized");
const rel = async (id: string) => (await mirror<{ tokens: { kyc_status: string; balance: number }[] }>(`/api/v1/accounts/${id}/tokens?token.id=${st.token}`))?.tokens?.[0];
const poolRel = await rel(String(st.poolId));
if (poolRel?.kyc_status !== "GRANTED") problems.push(`pool ${st.poolId} fUSD relationship: ${poolRel ? `kyc ${poolRel.kyc_status}` : "not associated"} (needs associated + KYC GRANTED)`);
for (const [r, need] of [["sponsor", RESERVE], ["investorA", TICKET.investorA], ["investorB", TICKET.investorB]] as const) {
  const x = await rel(ACCOUNTS[r].id!);
  if (x?.kyc_status !== "GRANTED") problems.push(`${r} fUSD KYC is ${x?.kyc_status ?? "not associated"}`);
  if (BigInt(x?.balance ?? 0) < need) problems.push(`${r} holds ${usd(BigInt(x?.balance ?? 0))} fUSD < ${usd(need)}`);
}
for (const r of ["investorA", "investorB"] as const) if ((await bondAt(p).getKycStatusFor(ACCOUNTS[r].evm)) !== 1n) problems.push(`${r} has no bond KYC (mint would revert InvalidKycStatus)`);
const required = await pool.requiredReserve(TOTAL_UNITS);
if (required > RESERVE) problems.push(`requiredReserve(1,000 USD) = ${usd(required)} > ${usd(RESERVE)}`);
const [iStart, iEnd] = [Number(await pool.issuanceStart()), Number(await pool.issuanceEnd())];
const now = await latestTs(p);
console.log(`\nissuance window [${iso(iStart)}, ${iso(iEnd)}), latest block ${iso(now)}: ${now < iStart ? `opens in ${iStart - now} s` : now >= iEnd ? "CLOSED" : `${iEnd - now} s left`}`);
console.log(`requiredReserve(1,000 USD) = ${usd(required)} fUSD; funding ${usd(RESERVE)}`);
if (now < iStart) problems.push(`issuance not open yet (opens ${iso(iStart)}, in ${iStart - now} s)`);
else if (now >= iEnd) problems.push("issuance window is closed");
else if (iEnd - now < MIN_REMAINING_SEC) problems.push(`only ${iEnd - now} s left in the issuance window (< ${MIN_REMAINING_SEC} s)`);
if (problems.length) {
  console.log("\npreconditions:");
  for (const x of problems) console.log(`  ✖ ${x}`);
  if (EXECUTE) {
    console.log("ABORT — nothing sent.");
    process.exitCode = 1;
    await printInvariants(p);
    process.exit();
  }
  console.log("(dry run: continuing to simulate what can be simulated)");
} else console.log("preconditions: all ✓");

// ------------------------------------------------------------ the six transactions
const token = tokenAt(p);
// Every step that depends on the previous step's state first polls until Hashio (mirror-backed eth_call) shows that
// state, then polls its own simulation (untilSimulates), so mirror lag cannot stop the run inside the window.
async function approveAndCall(role: "sponsor" | "investorA" | "investorB", amount: bigint, method: "fundCoupons" | "invest", done: () => Promise<boolean>, ready?: { label: string; check: () => Promise<boolean> }) {
  if (ready && EXECUTE) {
    const ok = await eventually(ready.check, (v: boolean) => v === true);
    if (!ok) throw new Error(`${role}: ${ready.label} still not visible through Hashio after ~30 s — stopped before sending`);
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
    await eventually(() => token.allowance(ACCOUNTS[role].evm, poolAddr), (v: bigint) => v >= amount); // mirror-backed eth_call lag
    await untilSimulates(pool, method, [amount], ACCOUNTS[role].evm, 45);
  }
  await tx(PHASE, role, `${role} pool.${method}(${usd(amount)})`, pool, method, [amount]);
}
await approveAndCall("sponsor", RESERVE, "fundCoupons", async () => (await pool.couponReserve()) >= RESERVE);
await approveAndCall("investorA", TICKET.investorA, "invest", async () => (await bondAt(p).balanceOf(ACCOUNTS.investorA.evm)) >= TICKET.investorA, {
  label: "pool.couponReserve() >= 1 USD (sponsor's fundCoupons)",
  check: async () => (await pool.couponReserve()) >= RESERVE,
});
await approveAndCall("investorB", TICKET.investorB, "invest", async () => (await bondAt(p).balanceOf(ACCOUNTS.investorB.evm)) >= TICKET.investorB, {
  label: "investor A's 600 USD (bond balance and unitsIssued)",
  check: async () => (await bondAt(p).balanceOf(ACCOUNTS.investorA.evm)) >= TICKET.investorA && (await pool.unitsIssued()) >= TICKET.investorA,
});

// ------------------------------------------------------------ assertions
if (EXECUTE || (await pool.unitsIssued()) > 0n) {
  const b = bondAt(p);
  const supply: bigint = await eventually(() => b.totalSupply(), (v: bigint) => v === TOTAL_UNITS);
  const checks: [string, boolean][] = [
    [`bond.totalSupply() ${usd(supply)} == unitsIssued == 1,000 USD`, supply === TOTAL_UNITS && (await pool.unitsIssued()) === TOTAL_UNITS],
    [`bond.balanceOf(A) == 600 USD`, (await b.balanceOf(ACCOUNTS.investorA.evm)) === TICKET.investorA],
    [`bond.balanceOf(B) == 400 USD`, (await b.balanceOf(ACCOUNTS.investorB.evm)) === TICKET.investorB],
    [`couponReserve == 1 USD`, (await pool.couponReserve()) === RESERVE],
    [`pool fUSD balance == 1,001 USD`, (await token.balanceOf(poolAddr)) === TOTAL_UNITS + RESERVE],
  ];
  console.log("\nassertions:");
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  else saveSmoke({ subscribedAt: new Date().toISOString() });
}
await printInvariants(p);
await printHbar(start);
