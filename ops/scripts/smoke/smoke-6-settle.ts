// Ported from the reference repo (ops/scripts/smoke/smoke-6-settle.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Smoke phase 6 — settlement after submissionDeadline() (faultline ARCHITECTURE §3.3, D2, D3):
//   wait until latest block > submissionDeadline(), trigger not paused, pendingCount == 0 (abort with nothing sent if
//   that is more than MAX_WAIT_SEC away)
//   1. investorA pool.redeem()   — the pool burns A's 600 units through ATS controllerRedeem; credits principal + coupon
//   2. investorA pool.claim()
//   3. investorB pool.redeem()   4. investorB pool.claim()
//   5. sponsor   pool.claim()    — the write-down collateral credited in phase 5
//   6. deployer  pool.sweepExcess()  (anyone; D3) — unused coupon reserve to the sponsor
//   7. deployer  pool.sweepDust()    (anyone; only once bond supply is 0) — rounding dust to the sponsor
//   8. sponsor   pool.claim()    — whatever 6 and 7 credited
// Final asserts: pool fUSD balance == 0, bond supply == 0, total claimed == deposits + reserve funded == 1,001 USD.
// Every step: skips when already done; polls the state it depends on (mirror-backed Hashio reads) and its own
// simulation; then sends; then prints the invariants. Any failure stops the run (no retry).
import { Interface } from "ethers";
import {
  ACCOUNTS, EXECUTE, USD, artifact, balances, bondAt, eventually, latestTs, loadSmoke, poolAt, printHbar, printInvariants, provider, saveSmoke,
  tokenAt, triggerAt, tx, untilSimulates, useFaultlineErrors, usd, waitForBlockTime, type Role,
} from "./lib.js";

const PHASE = "smoke-6";
const MAX_WAIT_SEC = Number(process.env.MAX_WAIT_SEC ?? "900");
const DEPOSITS = USD(1_000n);
const RESERVE = USD(1n);
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadSmoke();
const iso = (s: number) => new Date(s * 1000).toISOString().slice(11, 19) + "Z";

console.log("plan: A redeem → A claim → B redeem → B claim → sponsor claim → sweepExcess → sweepDust → sponsor claim");
console.log("  HBAR estimate: redeem ≈ 0.45 each (local 195,969 + ATS controllerRedeem S1 178,446 gas), claim ≈ 0.08 each, sweepExcess ≈ 0.14, sweepDust ≈ 0.06");
console.log("  expected (U = 1,000 USD, L = 7000): A principal 180 USD, B 120 USD (+ coupons); sponsor 700 USD collateral + unused reserve + dust; total 1,001 USD");

if (!st.trigger || !st.eventExecutedAt) {
  console.log(`\n${!st.trigger ? "the pool/trigger do not exist yet (phase 3)" : "phase 5 has not executed the event yet"} — plan only, nothing simulated`);
  await printHbar(start);
  process.exit(0);
}

const pool = poolAt(p);
const trigger = triggerAt(p);
const bond = bondAt(p);
const token = tokenAt(p);
const poolAddr = String(st.pool);
const POOL_EVENTS = new Interface(artifact("FaultlinePool").abi as never);

// ------------------------------------------------------------ open?
const deadline = Number(await trigger.submissionDeadline());
console.log(`\nsubmissionDeadline ${deadline} (${iso(deadline)}); latest block ${iso(await latestTs(p))}; paused ${await trigger.paused()}; pendingCount ${await trigger.pendingCount()}`);
if (await trigger.paused()) throw new Error("trigger is paused: redemption is closed (D2) — nothing sent");
if ((await trigger.pendingCount()) !== 0n) throw new Error("an event is pending: redemption is closed — nothing sent");
if (!(await waitForBlockTime(p, deadline + 1, "submissionDeadline() + 1 s", EXECUTE ? MAX_WAIT_SEC : 0))) {
  console.log(`  redemption opens at ${iso(deadline + 1)} — ${EXECUTE ? `more than ${MAX_WAIT_SEC} s away; ` : ""}run this phase after it; nothing sent`);
  process.exit(EXECUTE ? 1 : 0);
}

// ------------------------------------------------------------ steps
const claimed = (st.claimed ?? {}) as Record<string, string>;
function logEvents(receipt: unknown): void {
  for (const l of (receipt as { logs: { topics: string[]; data: string }[] } | undefined)?.logs ?? []) {
    let ev;
    try { ev = POOL_EVENTS.parseLog(l); } catch { continue; }
    if (!ev) continue;
    if (ev.name === "Redeemed") console.log(`  Redeemed: ${ev.args.holder} units ${usd(ev.args.units)} → principal ${usd(ev.args.principal)} + coupon ${usd(ev.args.coupon)}`);
    if (ev.name === "Claimed") {
      const who = (Object.keys(ACCOUNTS) as Role[]).find((r) => ACCOUNTS[r].evm.toLowerCase() === String(ev.args.account).toLowerCase()) ?? String(ev.args.account);
      claimed[who] = (BigInt(claimed[who] ?? "0") + BigInt(ev.args.amount)).toString();
      saveSmoke({ claimed });
      console.log(`  Claimed: ${who} ${usd(ev.args.amount)} fUSD`);
    }
    if (ev.name === "ExcessSwept" || ev.name === "DustSwept") console.log(`  ${ev.name}: ${usd(ev.args.amount)} credited to the sponsor`);
  }
}
async function run(role: Role, method: "redeem" | "claim" | "sweepExcess" | "sweepDust", what: string, skip: () => Promise<boolean>, ready?: { label: string; check: () => Promise<boolean> }, after?: () => void) {
  if (await skip()) {
    console.log(`\n[${PHASE}] ${what} — already done / nothing to do, skip`);
    return;
  }
  if (EXECUTE && ready) {
    if (!(await eventually(ready.check, (v: boolean) => v === true))) throw new Error(`${what}: ${ready.label} not visible through Hashio after ~30 s — stopped`);
  }
  if (EXECUTE) await untilSimulates(pool, method, [], ACCOUNTS[role].evm, 60);
  if (method === "claim") what = `${what} [claims ${usd(await pool.claimable(ACCOUNTS[role].evm))} fUSD]`;
  const r = await tx(PHASE, role, what, pool, method, []);
  logEvents(r.receipt);
  // State flags that change which invariants apply (sweptExcess: the bookkeeping form of invariant 1 is false by design
  // after a sweep, ARCHITECTURE §5) must be set BEFORE the invariants are printed.
  if (EXECUTE) after?.();
  if (EXECUTE && !(await printInvariants(p))) throw new Error("invariant broken — stopped");
}
const A = ACCOUNTS.investorA.evm;
const B = ACCOUNTS.investorB.evm;
const S = ACCOUNTS.sponsor.evm;

await run("investorA", "redeem", "investorA pool.redeem() — controllerRedeem of 600 units", async () => (await bond.balanceOf(A)) === 0n);
await run("investorA", "claim", "investorA pool.claim()", async () => (await pool.claimable(A)) === 0n && (await bond.balanceOf(A)) === 0n, {
  label: "A's redemption (claimable(A) > 0)", check: async () => (await pool.claimable(A)) > 0n,
});
await run("investorB", "redeem", "investorB pool.redeem() — controllerRedeem of 400 units", async () => (await bond.balanceOf(B)) === 0n, {
  label: "A's claim (claimable(A) == 0)", check: async () => (await pool.claimable(A)) === 0n,
});
await run("investorB", "claim", "investorB pool.claim()", async () => (await pool.claimable(B)) === 0n && (await bond.balanceOf(B)) === 0n, {
  label: "B's redemption (claimable(B) > 0)", check: async () => (await pool.claimable(B)) > 0n,
});
// Skips once the collateral is claimed (tally from the Claimed events in out/smoke-state.json), so a resumed run does
// not use this step to claim what a later sweep credited.
await run("sponsor", "claim", "sponsor pool.claim() — write-down collateral", async () => (await pool.claimable(S)) === 0n || BigInt(((loadSmoke().claimed ?? {}) as Record<string, string>).sponsor ?? "0") >= (await pool.sponsorCredited()), {
  label: "B's claim (claimable(B) == 0)", check: async () => (await pool.claimable(B)) === 0n,
});
await run("deployer", "sweepExcess", "pool.sweepExcess() — anyone (D3)", async () => Boolean(loadSmoke().sweptExcess), {
  label: "sponsor's claim (claimable(sponsor) == 0)", check: async () => (await pool.claimable(S)) === 0n,
}, () => saveSmoke({ sweptExcess: true }));
await run("deployer", "sweepDust", "pool.sweepDust() — anyone, bond supply 0", async () => Boolean(loadSmoke().sweptDust), {
  label: "bond totalSupply == 0", check: async () => (await bond.totalSupply()) === 0n,
}, () => saveSmoke({ sweptDust: true }));
await run("sponsor", "claim", "sponsor pool.claim() — unused reserve + dust", async () => (await pool.claimable(S)) === 0n && Boolean(loadSmoke().sweptDust), {
  label: "sweeps credited (claimable(sponsor) > 0; the unused reserve is ≈ 1 USD minus coupons)", check: async () => (await pool.claimable(S)) > 0n,
});

// ------------------------------------------------------------ final books
if (EXECUTE || loadSmoke().sweptDust) {
  const bal: bigint = await eventually(() => token.balanceOf(poolAddr), (v: bigint) => v === 0n);
  const c = (loadSmoke().claimed ?? {}) as Record<string, string>;
  const total = Object.values(c).reduce((a, v) => a + BigInt(v), 0n);
  const checks: [string, boolean][] = [
    [`pool fUSD balance == 0 (got ${usd(bal)})`, bal === 0n],
    [`bond totalSupply == 0, unitsRedeemed == unitsIssued`, (await bond.totalSupply()) === 0n && (await pool.unitsRedeemed()) === (await pool.unitsIssued())],
    [`total claimed ${usd(total)} == deposits ${usd(DEPOSITS)} + reserve funded ${usd(RESERVE)} = ${usd(DEPOSITS + RESERVE)}`, total === DEPOSITS + RESERVE],
    [`totalClaimable == 0`, (await pool.totalClaimable()) === 0n],
    [`isSolvent()`, await pool.isSolvent()],
  ];
  console.log("\nfinal books:");
  for (const [who, v] of Object.entries(c)) console.log(`  ${who.padEnd(9)} claimed ${usd(BigInt(v))} fUSD`);
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  else saveSmoke({ settledAt: new Date().toISOString() });
}
await printInvariants(p);
await printHbar(start);
