// Smoke phase 3 — deploy and wire the REAL FaultlinePool + FaultlineTrigger (main repo artifacts) on the smoke token and
// bond (faultline ARCHITECTURE §8, D4, D5, D11, D13 testnet demo profile, D14):
//   pool       FaultlinePool({admin: deployer, stablecoin: fUSD, bond, sponsor, schedule, grace, couponBps 600,
//              cap 1e10, minTicket 1e8})
//   trigger    FaultlineTrigger(pool, termsHash(kutchTerms("replay", offset)), 60, oracle, deployer, trustee);
//              refused unless the chain is in shared/ts REPLAY_CHAIN_IDS (D14)
//   initialize pool.initialize(trigger) — D5; associates the pool with fUSD (HIP-719)
//   kyc        SDK TokenGrantKyc(pool's contract account) — order associate → KYC (S3)
//   roles      bond.applyRoles([ISSUER, CONTROLLER], [true, true], pool) (S1 pattern); revoke ROLE_ISSUER from the
//              deployer if it holds it (the phase 2 bond never gives it); then assert D4 and the wiring
//
// SCHEDULE (demo-only, D13 testnet profile with a 13 min issuance window instead of ~5 min, owner 2026-10-26: one
// owner run for phase 4 needs the time; real values are recorded in out/smoke-state.json). From t = latest block:
//   issuanceStart = t + 2 min, issuanceEnd = t + 15 min, riskStart = issuanceEnd, grace = 3 min,
//   maturity = max(riskStart + 20 min, bondMaturity - grace + 60 s)
// so that bondStart <= issuanceStart, issuanceEnd + 60 s <= bondMaturity <= maturity + grace - 60 s (reasoning in
// smoke-2-bond.ts). Aborts if the bond does not fit or the risk period would exceed 95 min.
// TERMS: kutchTerms("replay", offset), offset chosen so Bhuj's replayed observedAt = riskStart + 60 s.
//
// DRY RUN without a smoke bond: the pool constructor needs bond.decimals(), so the pool simulation is deferred until
// phase 2 has deployed the bond, and the schedule is
// shown for a bond deployed now with phase 2's rule. EXECUTE uses ONLY the bond in out/smoke-state.json.
import { TokenGrantKycTransaction } from "@hashgraph/sdk";
import { Contract } from "ethers";
import { BOND_ABI, ROLES } from "../lib/common.js";
import { closeClient, mirror, sdkStep } from "../lib/hedera.js";
import {
  ACCOUNTS, EXECUTE, balances, bhujFixture, bondAt, bondAudit, clientOf, contractIdOf, deploy, eventually, latestTs, loadSmoke, poolAt, printHbar,
  printInvariants, provider, saveSmoke, sharedTs, triggerAt, tx, untilSimulates, useFaultlineErrors, usd,
} from "./lib.js";
const PHASE = "smoke-3";
const phases = (process.env.PHASE ?? "pool,trigger,initialize,kyc,roles").split(",");
const MIN = 60;
const P = {
  issuanceStartDelay: 2 * MIN,
  issuance: 13 * MIN, // issuanceEnd = t + 15 min (demo-only deviation from D13's ~5 min, ARCHITECTURE §12.1)
  riskMin: 20 * MIN,
  riskMax: 95 * MIN,
  grace: 3 * MIN,
  margin: 60,
  observedAfterRiskStart: 60,
  challengeWindow: 60n,
  couponBps: 600n,
  cap: 10_000_000_000n, // 10,000 USD
  minTicket: 100_000_000n, // 100 USD
  bondMaturityMin: Number(process.env.BOND_MATURITY_MIN ?? "45"), // must match phase 2 (dry-run what-if only)
};
const dep = ACCOUNTS.deployer;
const shared = sharedTs();
useFaultlineErrors();

const p = await provider();
const chainId = (await p.getNetwork()).chainId;
const start = await balances();
const st = loadSmoke();
const iso = (s: number) => new Date(s * 1000).toISOString().slice(11, 19) + "Z";

type Schedule = { issuanceStart: number; issuanceEnd: number; riskStart: number; maturity: number; grace: number };
function scheduleFor(t: number, bondStart: number, bondMaturity: number): { s: Schedule; problems: string[] } {
  const issuanceStart = t + P.issuanceStartDelay;
  const issuanceEnd = issuanceStart + P.issuance;
  const riskStart = issuanceEnd;
  const maturity = Math.max(riskStart + P.riskMin, bondMaturity - P.grace + P.margin);
  const s = { issuanceStart, issuanceEnd, riskStart, maturity, grace: P.grace };
  const problems: string[] = [];
  if (bondStart > issuanceStart) problems.push(`bond startingDate ${bondStart} is after issuanceStart ${issuanceStart}`);
  if (bondMaturity < issuanceEnd + P.margin) problems.push(`bond maturity ${bondMaturity} is before issuanceEnd + 60 s (${issuanceEnd + P.margin}): phase 3 started too late, a new bond is needed`);
  if (bondMaturity > maturity + P.grace - P.margin) problems.push("internal: bond maturity after pool maturity + grace - 60 s");
  if (maturity - riskStart > P.riskMax) problems.push(`risk period would be ${(maturity - riskStart) / MIN} min (> ${P.riskMax / MIN}): bond maturity too far ahead`);
  return { s, problems };
}
function printSchedule(s: Schedule, bondStart: number, bondMaturity: number) {
  const rows: [string, number][] = [
    ["bond startingDate", bondStart], ["issuanceStart", s.issuanceStart], ["issuanceEnd = riskStart", s.issuanceEnd],
    ["Bhuj observedAt (replayed)", s.riskStart + P.observedAfterRiskStart], ["bond maturityDate", bondMaturity],
    ["pool maturity", s.maturity], ["submissionDeadline = maturity + grace", s.maturity + s.grace],
  ];
  for (const [k, v] of rows.sort((a, b) => a[1] - b[1])) console.log(`  ${k.padEnd(38)} ${v}  ${iso(v)}`);
  console.log(`  risk period ${(s.maturity - s.riskStart) / MIN} min, grace ${s.grace / MIN} min, challenge window ${P.challengeWindow} s`);
}
function termsFor(s: Schedule) {
  const bhujSec = Math.floor(bhujFixture().properties.time / 1000);
  const offset = s.riskStart + P.observedAfterRiskStart - bhujSec;
  const terms = shared.kutchTerms("replay", offset);
  shared.assertReplayAllowed(terms, chainId); // D14: refuse replay terms outside 31337 / 296
  return { terms, offset, termsHash: shared.termsHash(terms), observedAt: shared.observedAtOf(bhujFixture(), terms) };
}

// ------------------------------------------------------------ which bond / token
const smokeBond = st.bond as string | undefined;
const token = st.tokenAddress as string | undefined;
if (!token) throw new Error("no smoke token in out/smoke-state.json — run phase 1 first");
if (EXECUTE && !smokeBond) throw new Error("EXECUTE needs the phase-2 bond in out/smoke-state.json; none found — nothing sent");
const bondAddr = smokeBond ?? "";
const standIn = !smokeBond;
console.log(`chainId ${chainId}; stablecoin fUSD ${st.token} (${token})`);
console.log(standIn
  ? "bond: NONE yet — DRY RUN shows the schedule what-if only; the pool simulation needs the phase-2 bond (run phase 2 first)"
  : `bond: ${bondAddr} (ISIN ${st.isin}, from phase 2)`);
const bondRead = standIn ? undefined : new Contract(bondAddr, BOND_ABI, p);
if (bondRead) console.log(`  bond decimals ${await bondRead.decimals()}, controllable ${await bondRead.isControllable()}, paused ${await bondRead.paused()}, ROLE_ISSUER members ${await bondRead.getRoleMemberCount(ROLES.ISSUER)}`);

// ------------------------------------------------------------ schedule + terms
let schedule = st.schedule as Schedule | undefined;
let bondStart: number, bondMaturity: number;
const now = await latestTs(p);
if (standIn) {
  bondStart = now + 120;
  bondMaturity = now + P.bondMaturityMin * MIN;
  console.log(`\nschedule what-if: phase 2 bond deployed now (start ${iso(bondStart)}, maturity ${iso(bondMaturity)} = now + ${P.bondMaturityMin} min); phase 3 starts N min later:`);
  // Latest phase-3 start: bondMaturity >= t + issuanceStartDelay + issuance + margin. Risk = max(riskMin,
  // bondMaturity - grace + margin - riskStart), largest when phase 3 starts right away.
  const latestDelay = bondMaturity - P.margin - P.issuance - P.issuanceStartDelay - now;
  const riskAt = (d: number) => scheduleFor(now + d, bondStart, bondMaturity).s;
  const r0 = riskAt(0);
  const rL = riskAt(latestDelay);
  console.log(`  latest phase-3 start: ${(latestDelay / MIN).toFixed(1)} min after the bond deploy; risk period from ${(r0.maturity - r0.riskStart) / MIN} min (phase 3 at once) down to ${(rL.maturity - rL.riskStart) / MIN} min (from ${((bondMaturity - P.grace + P.margin - P.riskMin - P.issuance - P.issuanceStartDelay - now) / MIN).toFixed(1)} min on)`);
  for (const delay of [0, 2, 5, 8, 15, 20, 25, 29, 30]) {
    const { s, problems } = scheduleFor(now + delay * MIN, bondStart, bondMaturity);
    console.log(`  +${String(delay).padStart(2)} min: risk ${String((s.maturity - s.riskStart) / MIN).padStart(5)} min, redemption opens ${String(((s.maturity + s.grace) - (now + delay * MIN)) / MIN).padStart(5)} min after phase 3 ${problems.length ? `✖ ${problems[0]}` : "✓"}`);
  }
} else {
  bondStart = Number(st.bondStartingDate);
  bondMaturity = Number(await bondRead!.getMaturityDate());
  if (bondMaturity !== Number(st.bondMaturityDate)) throw new Error(`bond maturity on chain ${bondMaturity} ≠ state ${st.bondMaturityDate}`);
}
if (!schedule) {
  const { s, problems } = scheduleFor(now, bondStart, bondMaturity);
  console.log(`\nschedule if the pool is deployed now (t = ${now}, ${iso(now)}):`);
  printSchedule(s, bondStart, bondMaturity);
  if (problems.length) {
    for (const x of problems) console.log(`  ✖ ${x}`);
    throw new Error("schedule and bond dates do not fit — nothing sent");
  }
  schedule = s;
} else {
  console.log("\nschedule (already deployed, from out/smoke-state.json):");
  printSchedule(schedule, bondStart, bondMaturity);
}
const t = termsFor(schedule);
console.log(`\nterms: kutchTerms("replay", ${t.offset}) — Bhuj usp000a8ds origin ${Math.floor(bhujFixture().properties.time / 1000)} + ${t.offset} = observedAt ${t.observedAt} (riskStart + ${P.observedAfterRiskStart} s)`);
console.log(`  termsHash ${t.termsHash}; replay allowed on chainId ${chainId}: yes (D14 allowlist ${shared.REPLAY_CHAIN_IDS.join(", ")})`);

// ------------------------------------------------------------ pool
let pool = st.pool as string | undefined;
if (phases.includes("pool")) {
  if (pool) console.log(`\n[${PHASE}] pool already deployed: ${pool} — skip`);
  else if (standIn) console.log(`\n[${PHASE}] deploy FaultlinePool(admin deployer, fUSD, bond, sponsor, schedule, couponBps ${P.couponBps}, cap ${P.cap}, minTicket ${P.minTicket})\n  simulation deferred: the constructor reads bond.decimals(), and the phase-2 bond does not exist yet`);
  else {
    if (EXECUTE) {
      // Recompute from the latest block right before sending; the dry-run numbers above are only a preview.
      const fresh = scheduleFor(await latestTs(p), bondStart, bondMaturity);
      if (fresh.problems.length) throw new Error(`schedule no longer fits: ${fresh.problems.join("; ")} — nothing sent`);
      schedule = fresh.s;
    }
    const params = {
      admin: dep.evm, stablecoin: token, bond: bondAddr, sponsor: ACCOUNTS.sponsor.evm,
      issuanceStart: BigInt(schedule.issuanceStart), issuanceEnd: BigInt(schedule.issuanceEnd), riskStart: BigInt(schedule.riskStart),
      maturity: BigInt(schedule.maturity), grace: BigInt(schedule.grace), couponBps: P.couponBps, cap: P.cap, minTicket: P.minTicket,
    };
    const r = await deploy(PHASE, "deployer", "deploy FaultlinePool", "FaultlinePool", [params]);
    if (r.address) {
      pool = r.address;
      const tt = termsFor(schedule);
      saveSmoke({ pool, poolId: await contractIdOf(pool), schedule, terms: tt.terms, termsHash: tt.termsHash, replayOffset: tt.offset, observedAt: tt.observedAt });
    }
  }
}

// ------------------------------------------------------------ trigger
let trigger = loadSmoke().trigger as string | undefined;
const tNow = termsFor(schedule);
if (phases.includes("trigger")) {
  if (trigger) console.log(`\n[${PHASE}] trigger already deployed: ${trigger} — skip`);
  else if (!pool) console.log(`\n[${PHASE}] deploy FaultlineTrigger(pool, ${tNow.termsHash}, 60, oracle ${ACCOUNTS.oracle.evm}, admin deployer, trustee ${ACCOUNTS.trustee.evm})\n  simulation deferred: the constructor reads riskStart/maturity/grace from the pool, which does not exist yet (local gas 2,001,766)`);
  else {
    shared.assertReplayAllowed(loadSmoke().terms as never, chainId);
    // The trigger constructor reads riskStart/maturity/grace from the pool; wait until Hashio (mirror-backed) sees it.
    await eventually(() => poolAt(p).maturity(), (v: bigint) => typeof v === "bigint" && v > 0n);
    const r = await deploy(PHASE, "deployer", "deploy FaultlineTrigger", "FaultlineTrigger", [pool, loadSmoke().termsHash, P.challengeWindow, ACCOUNTS.oracle.evm, dep.evm, ACCOUNTS.trustee.evm]);
    if (r.address) {
      trigger = r.address;
      saveSmoke({ trigger, triggerId: await contractIdOf(trigger) });
    }
  }
}

// ------------------------------------------------------------ initialize
if (phases.includes("initialize")) {
  if (!pool || !trigger) console.log(`\n[${PHASE}] pool.initialize(trigger) — D5, HIP-719 associate\n  simulation deferred: pool and trigger must exist (S3: associate from a contract ≈ 734k gas)`);
  else if ((await eventually(() => poolAt(p).trigger(), (v: string) => typeof v === "string")) !== "0x0000000000000000000000000000000000000000") console.log(`\n[${PHASE}] pool already initialized — skip`);
  else {
    // initialize checks trigger.pool() == pool; wait until the trigger is visible through Hashio.
    await eventually(() => triggerAt(p).pool(), (v: string) => typeof v === "string" && v.toLowerCase() === pool!.toLowerCase());
    await untilSimulates(poolAt(p), "initialize", [trigger], dep.evm);
    await tx(PHASE, "deployer", "pool.initialize(trigger) — D5; associates the pool with fUSD", poolAt(p), "initialize", [trigger]);
  }
}

// ------------------------------------------------------------ kyc (SDK)
if (phases.includes("kyc")) {
  const poolId = loadSmoke().poolId as string | undefined;
  const relOf = async () => (poolId ? (await mirror<{ tokens: { kyc_status: string }[] }>(`/api/v1/accounts/${poolId}/tokens?token.id=${st.token}`))?.tokens?.[0] : undefined);
  const rel = poolId ? await eventually(relOf, (x) => x !== undefined) : undefined;
  if (rel?.kyc_status === "GRANTED") console.log(`\n[${PHASE}] pool KYC already GRANTED — skip`);
  else {
    if (EXECUTE && !rel) throw new Error("the pool is not associated with fUSD on the mirror node yet (initialize first) — nothing sent");
    await sdkStep({
      spike: PHASE,
      what: "TokenGrantKyc(pool contract account)",
      payer: `deployer ${dep.id}`,
      client: () => clientOf("deployer"),
      plan: { type: "TokenGrantKycTransaction", token: st.token, account: poolId ? `${poolId} (FaultlinePool ${pool})` : "<pool contract id after deploy>" },
      build: () => new TokenGrantKycTransaction().setTokenId(String(st.token)).setAccountId(poolId!),
    });
    closeClient();
  }
}

// ------------------------------------------------------------ roles + D4
if (phases.includes("roles")) {
  if (!pool || standIn) console.log(`\n[${PHASE}] bond.applyRoles([ROLE_ISSUER, ROLE_CONTROLLER], [true, true], pool)\n  simulation deferred: needs the phase-2 bond and the pool (S1 applyRoles 321,620 gas)`);
  else {
    const b = bondAt(p);
    const has = await eventually(async () => [await b.hasRole(ROLES.ISSUER, pool), await b.hasRole(ROLES.CONTROLLER, pool)], (v) => Array.isArray(v));
    if (has[0] && has[1]) console.log(`\n[${PHASE}] pool already holds ROLE_ISSUER and ROLE_CONTROLLER — skip`);
    else await tx(PHASE, "deployer", "bond.applyRoles([ISSUER, CONTROLLER], [true, true], pool)", b, "applyRoles", [[ROLES.ISSUER, ROLES.CONTROLLER], [true, true], pool]);
    if (await b.hasRole(ROLES.ISSUER, dep.evm)) await tx(PHASE, "deployer", "bond.revokeRole(ROLE_ISSUER, deployer)", b, "revokeRole", [ROLES.ISSUER, dep.evm]);
    else console.log(`\n[${PHASE}] deployer never held ROLE_ISSUER on this bond (rbacs in phase 2 do not give it) — no revoke needed`);
  }
}

// ------------------------------------------------------------ D4 + wiring assertions
if (pool && trigger && !standIn) {
  const b = bondAt(p);
  const pl = poolAt(p);
  const tr = triggerAt(p);
  const checks: [string, boolean][] = [];
  const members = async (role: string) => (await b.getRoleMembers(role, 0n, 20n)).map((x: string) => x.toLowerCase());
  const issuers = await eventually(() => members(ROLES.ISSUER), (v) => Array.isArray(v) && v.length === 1);
  const controllers = await members(ROLES.CONTROLLER);
  checks.push([`D4: ROLE_ISSUER == [pool] (got ${JSON.stringify(issuers)})`, issuers.length === 1 && issuers[0] === pool.toLowerCase()]);
  checks.push([`ROLE_CONTROLLER == [pool] (got ${JSON.stringify(controllers)})`, controllers.length === 1 && controllers[0] === pool.toLowerCase()]);
  checks.push(["D4: no ROLE_AGENT", (await b.getRoleMemberCount(ROLES.AGENT)) === 0n]);
  checks.push(["D4: no ROLE_ADJUSTMENT_BALANCE", (await b.getRoleMemberCount(ROLES.ADJUSTMENT_BALANCE)) === 0n]);
  const roleProblems = await bondAudit().auditBondRoles(b as never, pool); // SEC-20: every role that moves supply or burns
  checks.push([`SEC-20 bond role audit: ${roleProblems.join("; ") || "clean"}`, roleProblems.length === 0]);
  checks.push(["bond not paused, controllable", !(await b.paused()) && (await b.isControllable())]);
  checks.push(["pool.trigger() == trigger", (await pl.trigger()).toLowerCase() === trigger.toLowerCase()]);
  checks.push(["trigger.pool() == pool", (await tr.pool()).toLowerCase() === pool.toLowerCase()]);
  checks.push([`trigger.termsHash() == ${loadSmoke().termsHash}`, (await tr.termsHash()) === loadSmoke().termsHash]);
  checks.push(["trigger.oracle() == oracle", (await tr.oracle()).toLowerCase() === ACCOUNTS.oracle.evm.toLowerCase()]);
  checks.push(["trigger.challengeWindow() == 60", (await tr.challengeWindow()) === P.challengeWindow]);
  checks.push(["trustee holds TRUSTEE_ROLE", await tr.hasRole(await tr.TRUSTEE_ROLE(), ACCOUNTS.trustee.evm)]);
  const s = loadSmoke().schedule as Schedule;
  checks.push(["pool schedule == state", Number(await pl.issuanceStart()) === s.issuanceStart && Number(await pl.issuanceEnd()) === s.issuanceEnd && Number(await pl.riskStart()) === s.riskStart && Number(await pl.maturity()) === s.maturity && Number(await pl.grace()) === s.grace]);
  checks.push(["trigger copied riskStart/maturity/grace", Number(await tr.riskStart()) === s.riskStart && Number(await tr.maturity()) === s.maturity && Number(await tr.grace()) === s.grace]);
  checks.push([`bond fits: start ${bondStart} ≤ issuanceStart, issuanceEnd + 60 ≤ bondMaturity ${bondMaturity} ≤ maturity + grace - 60`, bondStart <= s.issuanceStart && s.issuanceEnd + P.margin <= bondMaturity && bondMaturity <= s.maturity + s.grace - P.margin]);
  console.log("\nassertions:");
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (checks.some(([, ok]) => !ok)) {
    process.exitCode = 1;
    console.log("  ✖ ASSERTION FAILED — stop and report before phase 4");
  } else saveSmoke({ deployVerifiedAt: new Date().toISOString() });
  console.log(`  pool fUSD balance ${usd(await (new Contract(token, ["function balanceOf(address) view returns (uint256)"], p)).balanceOf(pool))}, requiredReserve(1,000 USD) = ${usd(await pl.requiredReserve(1_000_000_000n))}`);
}

// ------------------------------------------------------------ HBAR estimate for this phase
if (!loadSmoke().deployVerifiedAt) {
  const price = Number(await p.getFeeData().then((f) => f.gasPrice ?? 0n)) / 1e18;
  const items: [string, number, string][] = [
    ["deploy FaultlinePool", 2_450_566, "testnet simulation"],
    ["deploy FaultlineTrigger", 2_001_766, "local Hardhat gas"],
    ["initialize (HIP-719 associate)", 760_000, "S3 contract associate 733,941 + overhead"],
    ["applyRoles", 321_620, "S1 measured"],
  ];
  console.log(`
HBAR estimate for phase 3 (deployer; fees follow gas used):`);
  let sum = 0.013;
  for (const [k, gas, src] of items) {
    sum += gas * price;
    console.log(`  ${k.padEnd(32)} ${(gas * price).toFixed(3).padStart(6)} HBAR  (${gas.toLocaleString("en-US")} gas, ${src})`);
  }
  console.log(`  ${"TokenGrantKyc(pool) (SDK)".padEnd(32)}  0.013 HBAR  (S3/smoke-1 measured)
  ${"total".padEnd(32)} ${sum.toFixed(3).padStart(6)} HBAR`);
}

await printInvariants(p);
await printHbar(start);
