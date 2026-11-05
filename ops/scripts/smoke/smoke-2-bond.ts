// Ported from the reference repo (ops/scripts/smoke/smoke-2-bond.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Smoke phase 2 — a fresh ATS v8 bond through the factory, exactly the S1 shape (faultline docs/LESSONS.md S1), with the
// deployer as bond admin, SSI issuer and KYC operator:
//   deploy  Factory.deployBond: Luhn-valid ISIN (US + "FLS" + 6 clock digits + check digit), 6 decimals, nominal
//           1 USD (100 with 2 decimals), maxSupply = pool cap 1e10, controllable, internal KYC, single partition,
//           Reg S / NONE. rbacs: DEFAULT_ADMIN, SSI_MANAGER, KYC → deployer. Nobody gets ROLE_ISSUER, ROLE_AGENT or
//           ROLE_PAUSER (S1 also gave the issuer PAUSER for spike S2; Faultline never pauses the bond).
//   issuer  addIssuer(deployer) — registers the deployer as SSI (VC) issuer
//   kyc     grantKyc(A / B, vcId, now, now + 100 y, deployer) — the mint recipients. ATS v8 grantKyc stores the vcId and
//           checks only that the issuer is registered; it does not verify a VC document (S1 source read). No VC file
//           is generated (the ATS createVC task takes the issuer key on the command line); vcId is an opaque label
//           "urn:faultline:smoke:kyc:<role>", stated as such in the evidence.
//
// BOND DATES (reasoning; ATS v8.0.0 source, faultline-refs commit be4f860):
// - Factory._checkBondDates: maturityDate >= startingDate (DatesValidation.checkDates) and maturityDate > now
//   (ScheduledTasksStorageWrapper.requireValidTimestamp). Nothing else.
// - mint / issue (facets/mint) and controllerRedeem (facets/controller) have NO date guard in the source: only
//   fullRedeemAtMaturity checks maturity (MaturityDateStorageWrapper.checkMaturityReached), and Faultline never calls it.
// - Testnet (S1): mint happened after startingDate and before maturityDate; controllerRedeem worked both before and
//   AFTER maturityDate. To stay inside what S1 proved, the smoke bond must have
//       startingDate <= pool.issuanceStart   (mint after the bond start, as in S1)
//       pool.issuanceEnd <= maturityDate      (every mint before the bond maturity, as in S1)
//       maturityDate <= pool.maturity + grace (every redeem after the bond maturity, as in S1 step 9)
// - The pool schedule is fixed only in phase 3 (relative to its deploy), after an owner go-ahead of unknown length. So
//   startingDate = now + 2 min, maturityDate = now + BOND_MATURITY_MIN (default 45 min), and phase 3 fits the pool to
//   the bond: issuance 2 → 15 min after its deploy, riskStart = issuanceEnd, maturity = max(riskStart + 20 min,
//   bondMaturity - grace + 60 s), grace 3 min. Phase 3 aborts if bondMaturity < issuanceEnd + 60 s, i.e. if phase 3
//   starts later than ≈ 29 min after this bond (then a new bond is needed). Starting earlier only lengthens the risk
//   period (28 min if phase 3 starts at once, 20 min from ≈ 8 min on).
//
// PHASE=deploy,issuer,kyc (default all, in order); each step skips itself when it is already done on chain.
import { Contract, Interface } from "ethers";
import { FACTORY, FACTORY_ABI, ROLES } from "../lib/common.js";
import { bondArgs as atsBondArgs } from "../lib/atsBond.js";
import { ACCOUNTS, EXECUTE, balances, bondAt, eventually, latestTs, loadSmoke, printHbar, printInvariants, provider, saveSmoke, tx, usd } from "./lib.js";

const PHASE = "smoke-2";
const phases = (process.env.PHASE ?? "deploy,issuer,kyc").split(",");
const BOND_MATURITY_MIN = Number(process.env.BOND_MATURITY_MIN ?? "45");
const CAP = 10_000_000_000n; // = pool cap (10,000 USD at 6 decimals), D13
const KYC_HOLDERS = ["investorA", "investorB"] as const;
const dep = ACCOUNTS.deployer;

const p = await provider();
const start = await balances();
const deferred = (what: string, why: string) => console.log(`\n[${PHASE}] ${what}\n  simulation deferred: ${why}`);

const bondArgs = (nowSec: number) =>
  atsBondArgs(nowSec, { name: "Faultline Smoke Bond", symbol: "FLSMK", info: "Faultline smoke run (testnet only)", admin: dep.evm, cap: CAP, startDelaySec: 120, maturityMin: BOND_MATURITY_MIN });

// ------------------------------------------------------------ deploy
if (phases.includes("deploy")) {
  if (loadSmoke().bond) console.log(`\n[${PHASE}] bond already deployed: ${loadSmoke().bond} — skip`);
  else {
    const now = await latestTs(p);
    const { args, isin, startingDate, maturityDate } = bondArgs(now);
    const factory = new Contract(FACTORY, FACTORY_ABI, p);
    const predicted = await factory.deployBond.staticCall(...args, { from: dep.evm }).catch(() => undefined);
    console.log(`\nbond plan: ISIN ${isin}, startingDate ${startingDate} (${new Date(startingDate * 1000).toISOString()}), maturityDate ${maturityDate} (${new Date(maturityDate * 1000).toISOString()}, now + ${BOND_MATURITY_MIN} min)`);
    if (predicted) console.log(`  simulated bond address: ${predicted} (S1: the simulation predicted the real address)`);
    const r = await tx(PHASE, "deployer", `deployBond ISIN ${isin} (Faultline Smoke Bond FLSMK)`, factory, "deployBond", args);
    if (EXECUTE && r.receipt) {
      const iface = new Interface(FACTORY_ABI);
      const ev = (r.receipt as { logs: { topics: string[]; data: string }[] }).logs
        .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((x) => x?.name === "BondDeployed");
      if (!ev) throw new Error("BondDeployed event not found in the receipt");
      const bond = String(ev.args.bondAddress);
      saveSmoke({ bond, isin, bondStartingDate: startingDate, bondMaturityDate: maturityDate, bondDeployTx: r.hash! });
      console.log(`  bond: ${bond}  (https://hashscan.io/testnet/contract/${bond})`);
    }
  }
}

// ------------------------------------------------------------ issuer
if (phases.includes("issuer")) {
  if (!loadSmoke().bond) deferred("addIssuer(deployer)", "the bond does not exist yet (deploy first)");
  else if (await eventually(() => bondAt(p).isIssuer(dep.evm), (v) => v === false || v === true)) console.log(`\n[${PHASE}] deployer already a registered SSI issuer — skip`);
  else await tx(PHASE, "deployer", "addIssuer(deployer) — SSI issuer", bondAt(p), "addIssuer", [dep.evm]);
}

// ------------------------------------------------------------ kyc
if (phases.includes("kyc")) {
  for (const r of KYC_HOLDERS) {
    const vcId = `urn:faultline:smoke:kyc:${r}`;
    if (!loadSmoke().bond) { deferred(`grantKyc(${r}, ${vcId})`, "the bond does not exist yet (deploy first)"); continue; }
    const b = bondAt(p);
    if ((await b.getKycStatusFor(ACCOUNTS[r].evm)) === 1n) { console.log(`\n[${PHASE}] ${r} bond KYC already GRANTED — skip`); continue; }
    if (!(await eventually(() => b.isIssuer(dep.evm), (v) => v === true))) { deferred(`grantKyc(${r}, ${vcId})`, "addIssuer(deployer) must land first (grantKyc needs a registered issuer)"); continue; }
    const now = await latestTs(p);
    await tx(PHASE, "deployer", `grantKyc(${r}, ${vcId}) — opaque vcId, no VC document`, b, "grantKyc", [ACCOUNTS[r].evm, vcId, BigInt(now), BigInt(now + 100 * 365 * 24 * 3600), dep.evm]);
  }
}

// ------------------------------------------------------------ state of the bond
if (loadSmoke().bond) {
  const b = bondAt(p);
  console.log(`\nbond ${loadSmoke().bond} (ISIN ${loadSmoke().isin}):`);
  console.log(`  name ${await b.name()} / ${await b.symbol()}, decimals ${await b.decimals()}, nominal ${await b.getNominalValue()} (2 dp), controllable ${await b.isControllable()}, paused ${await b.paused()}, internal KYC ${await b.isInternalKycActivated()}`);
  console.log(`  totalSupply ${usd(await b.totalSupply())}, maturityDate ${await b.getMaturityDate()}`);
  for (const [n, role] of Object.entries(ROLES)) console.log(`  getRoleMemberCount(${n}) = ${await b.getRoleMemberCount(role)}`);
  console.log(`  deployer is SSI issuer: ${await b.isIssuer(dep.evm)}`);
  for (const r of KYC_HOLDERS) console.log(`  getKycStatusFor(${r}) = ${await b.getKycStatusFor(ACCOUNTS[r].evm)} (1 = GRANTED)`);
}
await printInvariants(p);
await printHbar(start);
