// What each wallet step of the issuer wizard sends, and what each ops/check step reads. Every step first reads the chain
// and sends nothing that is already in place, so a step interrupted after its transaction mined can simply be run again.
// Local: MockBond + MockUSD (MOCK-TESTED, local only). Testnet: ATS v8 factory + HTS (NOT testnet-verified until the
// owner runs it). The wizard state machine (wizard.ts) decides which step may run.
import { Contract, Interface, getAddress, type JsonRpcProvider } from "ethers";
import { POOL_ABI, TRIGGER_ABI } from "@/lib/abi";
import { ATS_BOND_ABI, ATS_FACTORY, ATS_FACTORY_ABI, ATS_ROLES, atsBondArgs } from "./ats";
import { auditPassed, launchChecks, sentInitcodeKeccak, type Check } from "./audit";
import { MOCK_USD_ABI, type IssuerBuild } from "./build";
import { checkHtsKyc, checkTopic } from "./opsSteps";
import { atsBondDates, validateSchedule, type Schedule } from "./schedule";
import { buildTerms } from "./terms";
import { sendCall, sendDeploy, type Eip1193, type TxPhase } from "./tx";
import { trusteeSignerProblem, type Outputs, type StepId, type WizardState } from "./wizard";

export type StepContext = {
  eth: Eip1193;
  /** The page's chain; every send refuses a wallet on another chain (SEC-11). */
  chainId: number;
  /** Read-only provider of the page's network (the wallet only signs). */
  provider: JsonRpcProvider;
  build: IssuerBuild;
  wallet: string;
  mirrorUrl: string | null;
  onPhase?: (label: string, phase: TxPhase) => void;
};

export type StepResult = { out?: Partial<Outputs>; txs?: string[]; note?: string; checks?: Check[]; passed: boolean; lines?: string[] };

const HUNDRED_YEARS = 100n * 365n * 86_400n;
const ZERO = "0x0000000000000000000000000000000000000000";

/** The validated schedule and terms of a wizard; throws if the stored inputs no longer validate (never expected). */
export function launchInputs(state: WizardState): { schedule: Schedule; termsHash: string; terms: ReturnType<typeof buildTerms> & { ok: true } } {
  const s = validateSchedule(state.inputs.schedule);
  const t = buildTerms(state.inputs.terms, state.chainId);
  if (!s.ok || !t.ok) throw new Error("The stored inputs no longer validate; reset the launch.");
  return { schedule: s.value, termsHash: t.value.hash, terms: t };
}

const latestTs = async (p: JsonRpcProvider) => Number((await p.getBlock("latest"))!.timestamp);

async function call(ctx: StepContext, label: string, address: string, abi: readonly (string | object)[], method: string, args: readonly unknown[]): Promise<string> {
  const r = await sendCall(ctx.eth, ctx.chainId, { address, abi: abi as never, method, args }, (p) => ctx.onPhase?.(label, p));
  return r.hash;
}

/** Runs one step. Throws on a revert, a rejection or a read failure (the page shows it in plain words). */
export async function runStep(id: StepId, state: WizardState, ctx: StepContext, extra: { topicId?: string } = {}): Promise<StepResult> {
  const { schedule, termsHash } = launchInputs(state);
  const p = state.inputs.parties;
  const o = state.out;
  const local = state.mode === "local";
  const chainId = state.chainId;
  const txs: string[] = [];

  switch (id) {
    case "topic": {
      if (local) return { passed: true, note: "local chain: mock HCS" };
      if (!ctx.mirrorUrl) throw new Error("No mirror node is configured for this network.");
      const topicId = (extra.topicId ?? o.topicId ?? "").trim();
      const r = await checkTopic(ctx.mirrorUrl, topicId, { oracle: p.oracle, trustee: p.trustee });
      return { passed: r.ok, lines: r.lines, out: r.ok ? { topicId } : undefined };
    }

    case "bond": {
      if (o.bond) return { passed: true, note: "bond already deployed" };
      if (local) {
        const r = await sendDeploy(ctx.eth, chainId, { abi: ctx.build.mockBond.abi, bytecode: ctx.build.mockBond.bytecode, args: [ctx.wallet, schedule.cap, true] }, (ph) => ctx.onPhase?.("Deploy MockBond", ph));
        return { passed: true, txs: [r.hash], out: { bond: r.address, initcodeKeccak: { bond: await sentInitcodeKeccak(ctx.provider, r.hash, ctx.build.mockBond.bytes) } } };
      }
      const now = await latestTs(ctx.provider);
      const dates = atsBondDates(schedule, now);
      if (dates.problems.length) throw new Error(dates.problems.join(" "));
      const { args, isin } = atsBondArgs({ name: p.bondName, symbol: p.bondSymbol, info: "Faultline bond launched from the issuer page (testnet only)", admin: ctx.wallet, cap: schedule.cap, startingDate: dates.startingDate, maturityDate: dates.maturityDate, isinSeed: now });
      const r = await sendCall(ctx.eth, chainId, { address: ATS_FACTORY, abi: ATS_FACTORY_ABI as never, method: "deployBond", args }, (ph) => ctx.onPhase?.("Deploy the ATS bond", ph));
      const iface = new Interface(ATS_FACTORY_ABI as never);
      const ev = r.receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "BondDeployed");
      if (!ev) throw new Error("BondDeployed was not found in the receipt; check the transaction on HashScan before running this step again.");
      return { passed: true, txs: [r.hash], out: { bond: getAddress(String(ev.args.bondAddress)), bondIsin: isin, bondStartingDate: dates.startingDate, bondMaturityDate: dates.maturityDate } };
    }

    case "issuerRole": {
      const bond = new Contract(o.bond!, local ? ctx.build.mockBond.abi : (ATS_BOND_ABI as never), ctx.provider);
      if (local) {
        if (!(await bond.hasRole(ATS_ROLES.KYC, ctx.wallet))) txs.push(await call(ctx, "Grant ROLE_KYC", o.bond!, ctx.build.mockBond.abi as never, "grantRole", [ATS_ROLES.KYC, ctx.wallet]));
      } else if (!(await bond.isIssuer(ctx.wallet))) txs.push(await call(ctx, "addIssuer", o.bond!, ATS_BOND_ABI, "addIssuer", [ctx.wallet]));
      return { passed: true, txs };
    }

    case "bondKyc": {
      const abi = local ? (ctx.build.mockBond.abi as never) : ATS_BOND_ABI;
      const bond = new Contract(o.bond!, abi as never, ctx.provider);
      for (const [i, inv] of p.investors.entries()) {
        if ((await bond.getKycStatusFor(inv)) === 1n) continue;
        const now = BigInt(await latestTs(ctx.provider));
        txs.push(await call(ctx, `Bond KYC for investor ${i + 1}`, o.bond!, abi, "grantKyc", [inv, `urn:faultline:${p.bondSymbol.toLowerCase()}:kyc:${i + 1}`, now, now + HUNDRED_YEARS, ctx.wallet]));
      }
      return { passed: true, txs };
    }

    case "pool": {
      if (o.pool) return { passed: true, note: "pool already deployed" };
      const params = {
        admin: p.admin, stablecoin: p.stablecoin, bond: o.bond!, sponsor: p.sponsor,
        issuanceStart: schedule.issuanceStart, issuanceEnd: schedule.issuanceEnd, riskStart: schedule.riskStart, maturity: schedule.maturity,
        grace: schedule.grace, couponBps: schedule.couponBps, cap: schedule.cap, minTicket: schedule.minTicket,
      };
      const r = await sendDeploy(ctx.eth, chainId, { abi: ctx.build.pool.abi, bytecode: ctx.build.pool.bytecode, args: [params] }, (ph) => ctx.onPhase?.("Deploy FaultlinePool", ph));
      return { passed: true, txs: [r.hash], out: { pool: r.address, initcodeKeccak: { pool: await sentInitcodeKeccak(ctx.provider, r.hash, ctx.build.pool.bytes) } } };
    }

    case "trigger": {
      if (o.trigger) return { passed: true, note: "trigger already deployed" };
      const r = await sendDeploy(ctx.eth, chainId, { abi: ctx.build.trigger.abi, bytecode: ctx.build.trigger.bytecode, args: [o.pool!, termsHash, schedule.challengeWindow, p.oracle, p.admin, p.trustee] }, (ph) => ctx.onPhase?.("Deploy FaultlineTrigger", ph));
      return { passed: true, txs: [r.hash], out: { trigger: r.address, termsHash, fromBlock: r.receipt.blockNumber, initcodeKeccak: { trigger: await sentInitcodeKeccak(ctx.provider, r.hash, ctx.build.trigger.bytes) } } };
    }

    case "backupTrustee": {
      const backup = p.backupTrustee ?? "";
      if (!backup) return { passed: true, note: "no backup trustee listed" };
      const trigger = new Contract(o.trigger!, TRIGGER_ABI, ctx.provider);
      const role = String(await trigger.TRUSTEE_ROLE());
      if (await trigger.hasRole(role, backup)) return { passed: true, note: "the backup trustee already holds TRUSTEE_ROLE" };
      const problem = trusteeSignerProblem(ctx.wallet, p.trustee);
      if (problem) throw new Error(problem);
      txs.push(await call(ctx, "Grant TRUSTEE_ROLE to the backup trustee", o.trigger!, TRIGGER_ABI, "grantRole", [role, backup]));
      return { passed: true, txs };
    }

    case "initialize": {
      const pool = new Contract(o.pool!, POOL_ABI, ctx.provider);
      const linked = String(await pool.trigger());
      if (linked === ZERO) txs.push(await call(ctx, "pool.initialize(trigger)", o.pool!, POOL_ABI, "initialize", [o.trigger!]));
      else if (linked.toLowerCase() !== o.trigger!.toLowerCase()) throw new Error(`The pool is already linked to another trigger (${linked}).`);
      return { passed: true, txs };
    }

    case "poolHtsKyc":
    case "investorHtsKyc": {
      const accounts = id === "poolHtsKyc" ? [o.pool!] : p.investors;
      if (!local) {
        if (!ctx.mirrorUrl) throw new Error("No mirror node is configured for this network.");
        const r = await checkHtsKyc(ctx.mirrorUrl, p.stablecoin, accounts);
        return { passed: r.ok, lines: r.lines };
      }
      const usd = new Contract(p.stablecoin, MOCK_USD_ABI, ctx.provider);
      const admin = String(await usd.admin());
      for (const a of accounts) {
        if (await usd.kycGranted(a)) continue;
        if (!(await usd.associatedOf(a))) throw new Error(`${a} is not associated with the stablecoin yet (an investor calls the token's associate() from its own wallet).`);
        if (admin.toLowerCase() !== ctx.wallet.toLowerCase()) throw new Error(`Only the MockUSD admin ${admin} (the local deployer) can grant stablecoin KYC; connect that account for this step.`);
        txs.push(await call(ctx, `Stablecoin KYC for ${a.slice(0, 8)}`, p.stablecoin, MOCK_USD_ABI, "grantKyc", [a]));
      }
      return { passed: true, txs };
    }

    case "roles": {
      const abi = local ? (ctx.build.mockBond.abi as never) : ATS_BOND_ABI;
      const bond = new Contract(o.bond!, abi as never, ctx.provider);
      const [issuer, controller] = await Promise.all([bond.hasRole(ATS_ROLES.ISSUER, o.pool!), bond.hasRole(ATS_ROLES.CONTROLLER, o.pool!)]);
      if (local) {
        if (!issuer) txs.push(await call(ctx, "Grant ROLE_ISSUER to the pool", o.bond!, abi, "grantRole", [ATS_ROLES.ISSUER, o.pool!]));
        if (!controller) txs.push(await call(ctx, "Grant ROLE_CONTROLLER to the pool", o.bond!, abi, "grantRole", [ATS_ROLES.CONTROLLER, o.pool!]));
      } else if (!issuer || !controller) {
        txs.push(await call(ctx, "applyRoles to the pool", o.bond!, abi, "applyRoles", [[ATS_ROLES.ISSUER, ATS_ROLES.CONTROLLER], [true, true], o.pool!]));
      }
      return { passed: true, txs };
    }

    case "audit": {
      // A creation-code read that lagged at deploy time is retried here from the recorded transaction.
      const deployed = {
        pool: o.initcodeKeccak?.pool ?? (await sentInitcodeKeccak(ctx.provider, state.steps.pool?.txs?.[0], ctx.build.pool.bytes)),
        trigger: o.initcodeKeccak?.trigger ?? (await sentInitcodeKeccak(ctx.provider, state.steps.trigger?.txs?.[0], ctx.build.trigger.bytes)),
      };
      const checks = await launchChecks({
        provider: ctx.provider, bond: o.bond!, pool: o.pool!, trigger: o.trigger!, stablecoin: p.stablecoin, sponsor: p.sponsor, oracle: p.oracle, trustee: p.trustee, admin: p.admin,
        backupTrustee: p.backupTrustee ?? "", backupSkipped: state.steps.backupTrustee?.status === "skipped",
        termsHash, schedule, build: { pool: ctx.build.pool.keccak, trigger: ctx.build.trigger.keccak }, deployed,
      });
      const passed = auditPassed(checks);
      return { passed, checks, out: { auditPassed: passed, initcodeKeccak: deployed } };
    }
  }
}
