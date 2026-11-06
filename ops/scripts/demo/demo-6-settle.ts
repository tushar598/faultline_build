// Full demo phase 6 — settlement after submissionDeadline() (faultline ARCHITECTURE §3.3, D2, D3), in two parts around
// the ONE dashboard write of phase 8 (investor B redeems and claims through the dashboard with the owner's MetaMask):
//   PART=a (default)  1. investorA pool.redeem()  2. investorA pool.claim()  3. sponsor pool.claim() — the 350 USD
//                     write-down collateral. Then STOP: investor B redeems + claims in the dashboard (phase 8).
//                     B_BY_SCRIPT=1 does B's redeem + claim here instead (fallback if the dashboard write fails).
//   PART=sweep        needs B redeemed and claimed: 4. pool.sweepExcess()  5. pool.sweepDust() (bond supply 0)
//                     6. sponsor pool.claim() — unused reserve + dust. Final books from the pool's Claimed logs on the
//                     mirror node (so B's dashboard claim counts): pool fUSD 0, total paid == deposits + reserve.
// Waits until latest block > submissionDeadline() (abort with nothing sent if that is > MAX_WAIT_SEC away). Every step
// skips when done, polls the state it depends on and its own simulation, then sends; invariants after each.
import { Interface } from "ethers";
import { mirror } from "../lib/hedera.js";
import {
  ACCOUNTS, EXECUTE, RESERVE, TOTAL_UNITS, artifact, balances, bondAt, eventually, iso, latestTs, loadDemo, poolAt, printHbar, printInvariants, provider, report,
  saveSmoke, tokenAt, triggerAt, tx, untilSimulates, useFaultlineErrors, usd, waitForBlockTime, type Role,
} from "./lib.js";

const PHASE = "demo-6";
const PART = process.env.PART ?? "a";
const B_BY_SCRIPT = process.env.B_BY_SCRIPT === "1";
const MAX_WAIT_SEC = Number(process.env.MAX_WAIT_SEC ?? "900");
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadDemo();
console.log(`PART=${PART}${B_BY_SCRIPT ? " (B_BY_SCRIPT=1)" : ""}`);
console.log("plan: a = A redeem → A claim → sponsor claim (collateral)  |  phase 8: B redeem + claim in the dashboard  |  sweep = sweepExcess → sweepDust → sponsor claim");
console.log(`  expected (U = ${usd(TOTAL_UNITS)}, L = 7000): A principal 90, B 60 (+ coupons); sponsor 350 collateral + unused reserve + dust; total ${usd(TOTAL_UNITS + RESERVE)}`);

if (!st.trigger || !st.flowBVerifiedAt) {
  console.log(`\n${!st.trigger ? "the pool/trigger do not exist yet (phase 2)" : "Flow B (phase 5) has not been verified yet"} — plan only, nothing simulated`);
  await printHbar(start);
  process.exit(0);
}
const pool = poolAt(p);
const trigger = triggerAt(p);
const bond = bondAt(p);
const token = tokenAt(p);
const poolAddr = String(st.pool);
const POOL = new Interface(artifact("FaultlinePool").abi as never);

const deadline = Number(await trigger.submissionDeadline());
console.log(`\nsubmissionDeadline ${iso(deadline)}; latest block ${iso(await latestTs(p))}; paused ${await trigger.paused()}; pendingCount ${await trigger.pendingCount()}`);
if (await trigger.paused()) throw new Error("trigger is paused: redemption is closed (D2) — nothing sent");
if ((await trigger.pendingCount()) !== 0n) throw new Error("an event is pending: redemption is closed — nothing sent");
if (!(await waitForBlockTime(p, deadline + 1, "submissionDeadline() + 1 s", EXECUTE ? MAX_WAIT_SEC : 0))) {
  console.log(`  redemption opens at ${iso(deadline + 1)} — run this phase after it; nothing sent`);
  process.exit(EXECUTE ? 1 : 0);
}

function logEvents(receipt: unknown): void {
  for (const l of (receipt as { logs: { topics: string[]; data: string }[] } | undefined)?.logs ?? []) {
    let ev;
    try { ev = POOL.parseLog(l); } catch { continue; }
    if (ev?.name === "Redeemed") console.log(`  Redeemed: ${ev.args.holder} units ${usd(ev.args.units)} → principal ${usd(ev.args.principal)} + coupon ${usd(ev.args.coupon)}`);
    if (ev?.name === "Claimed") console.log(`  Claimed: ${ev.args.account} ${usd(ev.args.amount)} fUSD`);
    if (ev?.name === "ExcessSwept" || ev?.name === "DustSwept") console.log(`  ${ev.name}: ${usd(ev.args.amount)} credited to the sponsor`);
  }
}
async function run(role: Role, method: "redeem" | "claim" | "sweepExcess" | "sweepDust", what: string, skip: () => Promise<boolean>, ready?: { label: string; check: () => Promise<boolean> }, after?: () => void) {
  if (await skip()) {
    console.log(`\n[${PHASE}] ${what} — already done / nothing to do, skip`);
    return;
  }
  if (EXECUTE && ready && !(await eventually(ready.check, (v: boolean) => v === true))) throw new Error(`${what}: ${ready.label} not visible through the RPC after ~30 s — stopped`);
  if (EXECUTE) await untilSimulates(pool, method, [], ACCOUNTS[role].evm, 60);
  if (method === "claim") what = `${what} [claims ${usd(await pool.claimable(ACCOUNTS[role].evm))} fUSD]`;
  const r = await tx(PHASE, role, what, pool, method, []);
  logEvents(r.receipt);
  if (EXECUTE) after?.();
  if (EXECUTE && !(await printInvariants(p))) throw new Error("invariant broken — stopped");
}
const A = ACCOUNTS.investorA.evm;
const B = ACCOUNTS.investorB.evm;
const S = ACCOUNTS.sponsor.evm;

if (PART === "a") {
  await run("investorA", "redeem", "investorA pool.redeem() — controllerRedeem of 300 units", async () => (await bond.balanceOf(A)) === 0n);
  await run("investorA", "claim", "investorA pool.claim()", async () => (await pool.claimable(A)) === 0n && (await bond.balanceOf(A)) === 0n, {
    label: "A's redemption (claimable(A) > 0)", check: async () => (await pool.claimable(A)) > 0n,
  });
  await run("sponsor", "claim", "sponsor pool.claim() — write-down collateral", async () => Boolean(loadDemo().sponsorCollateralClaimedAt) || (await pool.claimable(S)) === 0n, {
    label: "A's claim (claimable(A) == 0)", check: async () => (await pool.claimable(A)) === 0n,
  }, () => saveSmoke({ sponsorCollateralClaimedAt: new Date().toISOString() }));
  if (B_BY_SCRIPT) {
    await run("investorB", "redeem", "investorB pool.redeem() — controllerRedeem of 200 units (script fallback)", async () => (await bond.balanceOf(B)) === 0n, {
      label: "sponsor's claim (claimable(sponsor) == 0)", check: async () => (await pool.claimable(S)) === 0n,
    });
    await run("investorB", "claim", "investorB pool.claim() (script fallback)", async () => (await pool.claimable(B)) === 0n && (await bond.balanceOf(B)) === 0n, {
      label: "B's redemption (claimable(B) > 0)", check: async () => (await pool.claimable(B)) > 0n,
    });
  } else {
    console.log(`\nNEXT: investor B (${B}) redeems ${usd(await bond.balanceOf(B))} units and claims in the dashboard with MetaMask (phase 8); then PART=sweep.`);
    const [bp, bc] = await pool.effectiveValue(B);
    console.log(`  B will receive ≈ ${usd(bp + bc)} fUSD (principal ${usd(bp)} + coupon ${usd(bc)})`);
  }
}

if (PART === "sweep") {
  if ((await bond.balanceOf(B)) !== 0n || (await pool.claimable(B)) !== 0n) throw new Error("investor B has not redeemed and claimed yet (phase 8 dashboard write, or B_BY_SCRIPT=1 with PART=a) — nothing sent");
  await run("deployer", "sweepExcess", "pool.sweepExcess() — anyone (D3)", async () => Boolean(loadDemo().sweptExcess), undefined, () => saveSmoke({ sweptExcess: true }));
  await run("deployer", "sweepDust", "pool.sweepDust() — anyone, bond supply 0", async () => Boolean(loadDemo().sweptDust), {
    label: "bond totalSupply == 0", check: async () => (await bond.totalSupply()) === 0n,
  }, () => saveSmoke({ sweptDust: true }));
  await run("sponsor", "claim", "sponsor pool.claim() — unused reserve + dust", async () => (await pool.claimable(S)) === 0n && Boolean(loadDemo().sweptDust), {
    label: "sweeps credited (claimable(sponsor) > 0)", check: async () => (await pool.claimable(S)) > 0n,
  });
}

// ------------------------------------------------------------ final books (from the chain, incl. B's dashboard claim)
if (loadDemo().sweptDust) {
  type MirrorLog = { topics: string[]; data: string; transaction_hash: string };
  const topic0 = POOL.getEvent("Claimed")!.topicHash;
  // The mirror node refuses a topic filter without a timestamp range: from the pool's deploy (minus a minute) to now.
  const from = Number(st.poolDeployedAt) - 60;
  const range = `timestamp=gte:${from}&timestamp=lte:${Math.floor(Date.now() / 1000) + 60}`;
  const logs: MirrorLog[] = (await eventually(async () => (await mirror<{ logs: MirrorLog[] }>(`/api/v1/contracts/${st.poolId}/results/logs?topic0=${topic0}&${range}&limit=100&order=asc`))?.logs ?? [], (l) => (l?.length ?? 0) >= 4)) ?? [];
  const paid: Record<string, bigint> = {};
  for (const l of logs) {
    const ev = POOL.parseLog({ topics: l.topics, data: l.data })!;
    const who = (Object.keys(ACCOUNTS) as Role[]).find((r) => ACCOUNTS[r].evm.toLowerCase() === String(ev.args.account).toLowerCase()) ?? String(ev.args.account);
    paid[who] = (paid[who] ?? 0n) + BigInt(ev.args.amount);
  }
  const total = Object.values(paid).reduce((a, v) => a + v, 0n);
  const bal: bigint = await eventually(() => token.balanceOf(poolAddr), (v: bigint) => v === 0n);
  console.log("\nfinal books (Claimed logs, mirror node):");
  for (const [who, v] of Object.entries(paid)) console.log(`  ${who.padEnd(9)} claimed ${usd(v)} fUSD`);
  const ok = report("final assertions", [
    [`pool fUSD balance == 0 (got ${usd(bal)})`, bal === 0n],
    [`bond totalSupply == 0, unitsIssued - unitsRedeemed == units burned by holders (${st.holderBurned ?? 0})`, (await bond.totalSupply()) === 0n && BigInt(await pool.unitsIssued()) - BigInt(await pool.unitsRedeemed()) === BigInt(String(st.holderBurned ?? 0))],
    [`total claimed ${usd(total)} == deposits ${usd(TOTAL_UNITS)} + reserve funded ${usd(RESERVE)}`, total === TOTAL_UNITS + RESERVE],
    [`totalClaimable == 0, isSolvent()`, (await pool.totalClaimable()) === 0n && (await pool.isSolvent())],
  ]);
  if (ok) saveSmoke({ settledAt: new Date().toISOString(), paid: Object.fromEntries(Object.entries(paid).map(([k, v]) => [k, v.toString()])) });
  else process.exitCode = 1;
}
await printInvariants(p);
await printHbar(start);
