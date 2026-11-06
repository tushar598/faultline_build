// Full demo phase 2 — deploy and wire the CURRENT main-repo build (D17) on the phase-1 bond and the reused fUSD
// (faultline ARCHITECTURE §8, D4, D5, D11, D13 testnet demo profile, D14, D17). THE SCHEDULE CLOCK STARTS HERE.
//   pool       FaultlinePool({admin: deployer, stablecoin: fUSD, bond, sponsor, schedule, grace 180, couponBps 600,
//              cap 1e10, minTicket 1e8}); D17 bounds: grace <= 365 days
//   trigger    FaultlineTrigger(pool, termsHash(kutchTerms("replay", offset)), 120, oracle, deployer, trustee);
//              D14 replay allowlist; D17 bounds: 0 < window <= 30 days
//   initialize pool.initialize(trigger) — D5; associates the pool with fUSD (HIP-719)
//   kyc        SDK TokenGrantKyc(pool's contract account), deployer = fUSD KYC key
//   roles      bond.applyRoles([ISSUER, CONTROLLER], [true, true], pool); D4 + wiring asserts
//   backup     TRUSTEE (primary) grantRole(TRUSTEE_ROLE, backup trustee) — D17: TRUSTEE_ROLE is its own
//              admin (sent through the relay like every EVM tx); then SIMULATE ONLY (no tx) that the trigger admin cannot grant or revoke TRUSTEE_ROLE
//              (expects AccessControlUnauthorizedAccount)
//   oracle     writes out/demo/oracle.testnet.json + terms.json (real HCS, the phase-1 topic, payer = relayer,
//              fromBlock = the trigger's deploy block) and runs the oracle's `verify-config` refusal gate (no key)
// SCHEDULE (from t = latest block): issuanceStart t + 2 min, issuanceEnd = riskStart t + 15 min, grace 3 min,
// maturity = max(riskStart + 20 min, bondMaturity - grace + 60 s). TERMS: Bhuj replayed to riskStart + 60 s, so the
// SYNTHETIC Flow A record (Bhuj + 60 s) lands at riskStart + 120 s.
// DRY RUN without the phase-1 bond: the pool simulation reads this repo's smoke-run bond (out/smoke-state.json) READ-ONLY
// for decimals(); EXECUTE uses ONLY the bond in out/demo-state.json. PHASE=pool,trigger,initialize,kyc,roles,backup,oracle (default all).
import fs from "node:fs";
import path from "node:path";
import { TokenGrantKycTransaction } from "@hashgraph/sdk";
import { Contract } from "ethers";
import { BOND_ABI, ROLES, ROOT, explain } from "../lib/common.js";
import { closeClient, mirror, sdkStep } from "../lib/hedera.js";
import {
  ACCOUNTS, BOND, EXECUTE, MIN, P, balances, bondAt, bondAudit, buildInfo, clientOf, contractIdOf, deploy, eventually, iso, latestTs, loadDemo, poolAt, printHbar,
  printInvariants, printTimeline, provider, report, runOracle, saveSmoke, scheduleFor, termsFor, triggerAt, tx, untilSimulates, useFaultlineErrors, usd,
  writeOracleConfig, type Schedule,
  STATE_NAME,
} from "./lib.js";

const PHASE = "demo-2";
const phases = (process.env.PHASE ?? "pool,trigger,initialize,kyc,roles,backup,oracle").split(",");
// The smoke run's bond (this repo, docs/DEPLOYMENTS.md): a read-only stand-in for the dry run, never EXECUTE.
const SMOKE_BOND = (() => {
  const f = path.join(ROOT, "out", "smoke-state.json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")).bond as string | undefined) : undefined;
})();
const dep = ACCOUNTS.deployer;
useFaultlineErrors();

const p = await provider();
const chainId = (await p.getNetwork()).chainId;
const start = await balances();
const st = loadDemo();

// ------------------------------------------------------------ build + inputs
const build = buildInfo();
const recorded = st.build as typeof build | undefined;
if (!recorded) throw new Error("run phase 0 first (no build recorded)");
if (build.dirty || build.poolInitcodeKeccak !== recorded.poolInitcodeKeccak || build.triggerInitcodeKeccak !== recorded.triggerInitcodeKeccak) {
  throw new Error(`the main-repo build changed since phase 0 (recorded ${recorded.commit.slice(0, 7)}, now ${build.commit.slice(0, 7)}${build.dirty ? ", dirty" : ""}) — rerun phase 0; nothing sent`);
}
console.log(`build: faultline @ ${build.commit} (pool ${build.poolInitcodeKeccak.slice(0, 18)}…, trigger ${build.triggerInitcodeKeccak.slice(0, 18)}…)`);
const token = String(st.tokenAddress);
const demoBond = st.bond as string | undefined;
const topicId = st.topicId as string | undefined;
if (EXECUTE) {
  if (!demoBond) throw new Error(`EXECUTE needs the phase-1 bond in out/${STATE_NAME}; none found — nothing sent`);
  if (SMOKE_BOND && demoBond.toLowerCase() === SMOKE_BOND.toLowerCase()) throw new Error("state points at the smoke-run bond — refusing to EXECUTE on it");
  if (!topicId || !st.topicVerifiedAt) throw new Error("EXECUTE needs the phase-1 topic (created and mirror-verified) — nothing sent");
  if (!st.keysCheckedAt) throw new Error("run phase 0 with CHECK_KEYS=1 first — nothing sent");
}
if (!demoBond && !SMOKE_BOND) throw new Error("no phase-1 bond and no smoke-run bond to stand in for the dry run — run the smoke run (or phase 1) first");
const bondAddr = demoBond ?? SMOKE_BOND!;
const standIn = !demoBond;
console.log(`chainId ${chainId}; fUSD ${st.token} (${token}); topic ${topicId ?? "(phase 1)"}`);
console.log(standIn ? `bond: NONE yet — DRY RUN uses the smoke-run bond ${SMOKE_BOND} READ-ONLY as a stand-in for decimals(); EXECUTE would abort` : `bond: ${bondAddr} (ISIN ${st.isin}, phase 1)`);
const bondRead = new Contract(bondAddr, BOND_ABI, p);

// ------------------------------------------------------------ schedule + terms
let schedule = st.schedule as Schedule | undefined;
const now = await latestTs(p);
const bondStart = standIn ? now + 120 : Number(st.bondStartingDate);
const bondMaturity = standIn ? now + BOND.maturityMin * MIN : Number(await bondRead.getMaturityDate());
if (!standIn && bondMaturity !== Number(st.bondMaturityDate)) throw new Error(`bond maturity on chain ${bondMaturity} ≠ state ${st.bondMaturityDate}`);
if (!schedule) {
  const { s, problems } = scheduleFor(now, bondStart, bondMaturity);
  console.log(`\ntimeline if the pool is deployed now (t = ${iso(now)})${standIn ? " on a bond deployed now (what-if)" : ""}:`);
  printTimeline(now, s, termsFor(s, chainId).observedAt, { start: bondStart, maturity: bondMaturity });
  if (problems.length) {
    for (const x of problems) console.log(`  ✖ ${x}`);
    throw new Error("schedule and bond dates do not fit — nothing sent");
  }
  schedule = s;
} else {
  console.log(`\ntimeline (pool deployed; from out/${STATE_NAME}):`);
  printTimeline(Number(st.poolDeployedAt), schedule, termsFor(schedule, chainId).observedAt, { start: bondStart, maturity: bondMaturity });
}
const t0 = termsFor(schedule, chainId);
console.log(`\nterms: kutchTerms("replay", ${t0.offset}); termsHash ${t0.termsHash}; replay allowed on chainId ${chainId} (D14)`);

// ------------------------------------------------------------ pool
let pool = st.pool as string | undefined;
if (phases.includes("pool")) {
  if (pool) console.log(`\n[${PHASE}] pool already deployed: ${pool} — skip`);
  else {
    let t = now;
    if (EXECUTE) {
      // Recompute from the latest block right before sending; the numbers above are a preview.
      t = await latestTs(p);
      const fresh = scheduleFor(t, bondStart, bondMaturity);
      if (fresh.problems.length) throw new Error(`schedule no longer fits: ${fresh.problems.join("; ")} — nothing sent`);
      schedule = fresh.s;
    }
    const params = {
      admin: dep.evm, stablecoin: token, bond: bondAddr, sponsor: ACCOUNTS.sponsor.evm,
      issuanceStart: BigInt(schedule.issuanceStart), issuanceEnd: BigInt(schedule.issuanceEnd), riskStart: BigInt(schedule.riskStart),
      maturity: BigInt(schedule.maturity), grace: BigInt(schedule.grace), couponBps: P.couponBps, cap: P.cap, minTicket: P.minTicket,
    };
    const r = await deploy(PHASE, "deployer", `deploy FaultlinePool (D17 build ${build.commit.slice(0, 7)})${standIn ? " (SIMULATION on the smoke-run stand-in bond)" : ""}`, "FaultlinePool", [params]);
    if (r.address) {
      pool = r.address;
      const tt = termsFor(schedule, chainId);
      saveSmoke({ pool, poolId: await contractIdOf(pool), poolDeployTx: r.txHash, poolDeployedAt: t, schedule, terms: tt.terms, termsHash: tt.termsHash, replayOffset: tt.offset, observedAt: tt.observedAt });
    }
  }
}

// ------------------------------------------------------------ trigger
let trigger = loadDemo().trigger as string | undefined;
if (phases.includes("trigger")) {
  if (trigger) console.log(`\n[${PHASE}] trigger already deployed: ${trigger} — skip`);
  else if (!pool) console.log(`\n[${PHASE}] deploy FaultlineTrigger(pool, ${t0.termsHash}, ${P.challengeWindow}, oracle ${ACCOUNTS.oracle.evm}, admin deployer, trustee ${ACCOUNTS.trustee.evm})\n  simulation deferred: the constructor reads riskStart/maturity/grace from the pool (smoke 2,001,742 gas)`);
  else {
    await eventually(() => poolAt(p).maturity(), (v: bigint) => typeof v === "bigint" && v > 0n); // mirror-backed reads lag
    const r = await deploy(PHASE, "deployer", "deploy FaultlineTrigger", "FaultlineTrigger", [pool, loadDemo().termsHash, P.challengeWindow, ACCOUNTS.oracle.evm, dep.evm, ACCOUNTS.trustee.evm]);
    if (r.address) {
      trigger = r.address;
      saveSmoke({ trigger, triggerId: await contractIdOf(trigger), triggerDeployBlock: r.blockNumber ?? (await p.getBlockNumber()), triggerDeployTx: r.txHash });
    }
  }
}

// ------------------------------------------------------------ initialize
if (phases.includes("initialize")) {
  if (!pool || !trigger) console.log(`\n[${PHASE}] pool.initialize(trigger) — D5, HIP-719 associate\n  simulation deferred: pool and trigger must exist (smoke 744,974 gas)`);
  else if ((await eventually(() => poolAt(p).trigger(), (v: string) => typeof v === "string")) !== "0x0000000000000000000000000000000000000000") console.log(`\n[${PHASE}] pool already initialized — skip`);
  else {
    await eventually(() => triggerAt(p).pool(), (v: string) => typeof v === "string" && v.toLowerCase() === pool!.toLowerCase());
    await untilSimulates(poolAt(p), "initialize", [trigger], dep.evm);
    await tx(PHASE, "deployer", "pool.initialize(trigger) — D5; associates the pool with fUSD", poolAt(p), "initialize", [trigger]);
  }
}

// ------------------------------------------------------------ kyc (SDK)
if (phases.includes("kyc")) {
  const poolId = loadDemo().poolId as string | undefined;
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
      plan: { type: "TokenGrantKycTransaction", token: st.token, account: poolId ? `${poolId} (FaultlinePool ${pool})` : "<pool contract id after deploy>", estimate: "smoke 0.0130 HBAR" },
      build: () => new TokenGrantKycTransaction().setTokenId(String(st.token)).setAccountId(poolId!),
    });
    closeClient();
  }
}

// ------------------------------------------------------------ roles
if (phases.includes("roles")) {
  if (!pool || standIn) console.log(`\n[${PHASE}] bond.applyRoles([ROLE_ISSUER, ROLE_CONTROLLER], [true, true], pool)\n  simulation deferred: needs the phase-1 bond and the pool (smoke 321,608 gas)`);
  else {
    const b = bondAt(p);
    const has = await eventually(async () => [await b.hasRole(ROLES.ISSUER, pool), await b.hasRole(ROLES.CONTROLLER, pool)], (v) => Array.isArray(v));
    if (has[0] && has[1]) console.log(`\n[${PHASE}] pool already holds ROLE_ISSUER and ROLE_CONTROLLER — skip`);
    else await tx(PHASE, "deployer", "bond.applyRoles([ISSUER, CONTROLLER], [true, true], pool)", b, "applyRoles", [[ROLES.ISSUER, ROLES.CONTROLLER], [true, true], pool]);
    if (await b.hasRole(ROLES.ISSUER, dep.evm)) throw new Error("the deployer holds ROLE_ISSUER on the bond (phase 1 never grants it) — stop and report");
  }
}

// ------------------------------------------------------------ backup trustee (D17)
if (phases.includes("backup")) {
  if (!trigger) console.log(`\n[${PHASE}] trustee grantRole(TRUSTEE_ROLE, backup ${ACCOUNTS.trusteeBackup.evm}) — D17\n  simulation deferred: the trigger does not exist yet (est. ~90k gas; the trustee's first tx completes its hollow account)`);
  else {
    const tr = triggerAt(p);
    const ROLE: string = await tr.TRUSTEE_ROLE();
    if (await eventually(() => tr.hasRole(ROLE, ACCOUNTS.trusteeBackup.evm), (v) => v === true)) console.log(`\n[${PHASE}] backup trustee already holds TRUSTEE_ROLE — skip`);
    else await tx(PHASE, "trustee", "trigger.grantRole(TRUSTEE_ROLE, backup trustee) — by the primary trustee (D17: TRUSTEE_ROLE administers itself)", tr, "grantRole", [ROLE, ACCOUNTS.trusteeBackup.evm]);
    // The trigger admin can NOT manage trustees any more (SEC-01 fix): simulation only, no transaction.
    const adminChecks: [string, boolean][] = [];
    for (const [what, method, args] of [
      ["admin grantRole(TRUSTEE_ROLE, deployer)", "grantRole", [ROLE, dep.evm]],
      ["admin revokeRole(TRUSTEE_ROLE, primary trustee)", "revokeRole", [ROLE, ACCOUNTS.trustee.evm]],
      ["admin revokeRole(TRUSTEE_ROLE, backup trustee)", "revokeRole", [ROLE, ACCOUNTS.trusteeBackup.evm]],
    ] as const) {
      let got = "no revert";
      try {
        await tr.getFunction(method).staticCall(...args, { from: dep.evm });
      } catch (e) {
        got = explain(e);
      }
      adminChecks.push([`${what} (simulated, no tx) → ${got}`, got.startsWith("AccessControlUnauthorizedAccount(") && got.toLowerCase().includes(dep.evm.toLowerCase())]);
    }
    adminChecks.push(["getRoleAdmin(TRUSTEE_ROLE) == TRUSTEE_ROLE", (await tr.getRoleAdmin(ROLE)) === ROLE]);
    if (report("D17 trustee administration", adminChecks)) saveSmoke({ adminCannotManageTrusteesAt: new Date().toISOString() });
    else process.exitCode = 1;
  }
}

// ------------------------------------------------------------ oracle config + refusal gate
if (phases.includes("oracle")) {
  const s = loadDemo();
  if (!trigger || !s.topicId) console.log(`\n[${PHASE}] oracle config + verify-config\n  deferred: needs the trigger and the phase-1 topic`);
  else {
    writeOracleConfig({ trigger, topicId: String(s.topicId), terms: s.terms, fromBlock: Number(s.triggerDeployBlock) });
    const r = await runOracle(["verify-config"]);
    if (r.code !== 0) {
      process.exitCode = 1;
      console.log("  ✖ the oracle refuses this config — stop and report");
    } else saveSmoke({ oracleConfigVerifiedAt: new Date().toISOString() });
  }
}

// ------------------------------------------------------------ D4 + wiring asserts
if (pool && trigger && !standIn) {
  const s = loadDemo();
  const b = bondAt(p);
  const pl = poolAt(p);
  const tr = triggerAt(p);
  const members = async (role: string) => (await b.getRoleMembers(role, 0n, 20n)).map((x: string) => x.toLowerCase());
  const issuers = await eventually(() => members(ROLES.ISSUER), (v) => Array.isArray(v) && v.length === 1);
  const controllers = await members(ROLES.CONTROLLER);
  const sc = s.schedule as Schedule;
  const ROLE: string = await tr.TRUSTEE_ROLE();
  const roleProblems = await bondAudit().auditBondRoles(b as never, pool); // SEC-20: every role that moves supply or burns
  const ok = report("assertions", [
    [`D4: ROLE_ISSUER == [pool] (got ${JSON.stringify(issuers)})`, issuers.length === 1 && issuers[0] === pool.toLowerCase()],
    [`ROLE_CONTROLLER == [pool] (got ${JSON.stringify(controllers)})`, controllers.length === 1 && controllers[0] === pool.toLowerCase()],
    ["D4: no ROLE_AGENT, ROLE_ADJUSTMENT_BALANCE, ROLE_PAUSER", (await b.getRoleMemberCount(ROLES.AGENT)) === 0n && (await b.getRoleMemberCount(ROLES.ADJUSTMENT_BALANCE)) === 0n && (await b.getRoleMemberCount(ROLES.PAUSER)) === 0n],
    [`SEC-20 bond role audit: ${roleProblems.join("; ") || "clean"}`, roleProblems.length === 0],
    ["bond not paused, controllable", !(await b.paused()) && (await b.isControllable())],
    ["pool.trigger() == trigger, trigger.pool() == pool", (await pl.trigger()).toLowerCase() === trigger.toLowerCase() && (await tr.pool()).toLowerCase() === pool.toLowerCase()],
    [`trigger.termsHash() == ${s.termsHash}`, (await tr.termsHash()) === s.termsHash],
    ["trigger.oracle() == oracle", (await tr.oracle()).toLowerCase() === ACCOUNTS.oracle.evm.toLowerCase()],
    [`trigger.challengeWindow() == ${P.challengeWindow} s (demo-only)`, (await tr.challengeWindow()) === P.challengeWindow],
    ["primary trustee and backup trustee hold TRUSTEE_ROLE; deployer does not", (await tr.hasRole(ROLE, ACCOUNTS.trustee.evm)) && (await tr.hasRole(ROLE, ACCOUNTS.trusteeBackup.evm)) && !(await tr.hasRole(ROLE, dep.evm))],
    ["deployer holds DEFAULT_ADMIN_ROLE on pool and trigger", (await pl.hasRole(ROLES.DEFAULT_ADMIN, dep.evm)) && (await tr.hasRole(ROLES.DEFAULT_ADMIN, dep.evm))],
    ["pool schedule == state", Number(await pl.issuanceStart()) === sc.issuanceStart && Number(await pl.issuanceEnd()) === sc.issuanceEnd && Number(await pl.riskStart()) === sc.riskStart && Number(await pl.maturity()) === sc.maturity && Number(await pl.grace()) === sc.grace],
    ["trigger copied riskStart/maturity/grace", Number(await tr.riskStart()) === sc.riskStart && Number(await tr.maturity()) === sc.maturity && Number(await tr.grace()) === sc.grace],
    [`bond fits: start ≤ issuanceStart, issuanceEnd + 60 ≤ bondMaturity ≤ maturity + grace - 60`, bondStart <= sc.issuanceStart && sc.issuanceEnd + P.margin <= bondMaturity && bondMaturity <= sc.maturity + sc.grace - P.margin],
    ["D17 admin-cannot-manage-trustees check passed", Boolean(s.adminCannotManageTrusteesAt)],
    ["oracle verify-config passed", Boolean(s.oracleConfigVerifiedAt)],
  ]);
  if (!ok) {
    process.exitCode = 1;
    console.log("  ✖ ASSERTION FAILED — stop and report before phase 3");
  } else saveSmoke({ deployVerifiedAt: new Date().toISOString() });
  console.log(`  requiredReserve(${usd(500_000_000n)}) = ${usd(await pl.requiredReserve(500_000_000n))} fUSD`);
}

await printInvariants(p);
await printHbar(start);
