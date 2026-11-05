// Issuer page, step c: the launch wizard as a pure state machine. The plan depends on the network: on the local chain the
// bond is a MockBond and the stablecoin a MockUSD whose admin acts for the HTS keys; on Hedera testnet the bond comes from
// the ATS v8 factory and the two native steps (HCS topic, HTS KYC) run from ops/ (docs/LESSONS.md "Issuer page").
// Progress is kept in localStorage per chain so a closed tab resumes where it stopped; every storage access is guarded.
// Unit-tested in test/issuer.wizard.test.ts.
import { getAddress, isAddress } from "ethers";
import type { SessionStore } from "@/lib/walletSession";
import type { ScheduleDraft } from "./schedule";
import type { TermsDraft } from "./terms";

export type IssuerMode = "local" | "testnet";
export type StepId = "topic" | "bond" | "issuerRole" | "bondKyc" | "pool" | "trigger" | "backupTrustee" | "initialize" | "poolHtsKyc" | "roles" | "investorHtsKyc" | "audit";
/** wallet: signed in the browser; ops: run a command in ops/, then the page checks the result on chain or the mirror node;
 *  check: read-only. */
export type StepKind = "wallet" | "ops" | "check";
/** `optional`: the page offers "Skip" (the launch is complete without it; the audit then shows a warning). */
export type StepDef = { id: StepId; title: string; kind: StepKind; requires: StepId[]; detail: string; optional?: boolean };

export type Parties = {
  /** Gets DEFAULT_ADMIN_ROLE on the pool and the trigger; must be the connected wallet (it calls initialize). */
  admin: string;
  sponsor: string;
  oracle: string;
  trustee: string;
  /** HTS stablecoin (ERC-20 facade address), 6 decimals. */
  stablecoin: string;
  investors: string[];
  /** Testnet only: the relayer that pays for the HCS topic (D16). */
  topicPayer: string;
  /** Testnet only: the account that holds the stablecoin's KYC key. */
  kycKeyHolder: string;
  /** Optional second TRUSTEE_ROLE holder (D17), granted by the trustee itself; "" for none. Absent in launches stored
   *  before 2026-11-03, read as "". */
  backupTrustee?: string;
  bondName: string;
  bondSymbol: string;
};

export type IssuerInputs = { terms: TermsDraft; schedule: ScheduleDraft; parties: Parties };

export type StepRecord = { status: "done" | "skipped"; at: string; txs?: string[]; note?: string };

export type Outputs = {
  topicId?: string;
  bond?: string;
  bondIsin?: string;
  bondStartingDate?: number;
  bondMaturityDate?: number;
  pool?: string;
  trigger?: string;
  /** Block of the trigger deployment: where event scans start (Hashio limits log ranges). */
  fromBlock?: number;
  termsHash?: string;
  /** keccak256 of the creation code each deployment carried, read back from its transaction. */
  initcodeKeccak?: { pool?: string; trigger?: string; bond?: string };
  auditPassed?: boolean;
};

export type WizardState = {
  v: 1;
  chainId: number;
  mode: IssuerMode;
  createdAt: string;
  inputs: IssuerInputs;
  steps: Partial<Record<StepId, StepRecord>>;
  out: Outputs;
};

const LOCAL_PLAN: StepDef[] = [
  { id: "topic", title: "HCS topic", kind: "check", requires: [], detail: "The local chain has no HCS; the oracle's mock topic is a local file. Nothing to create." },
  { id: "bond", title: "Deploy the bond (MockBond)", kind: "wallet", requires: [], detail: "MockBond(admin = your wallet, maxSupply = cap, controllable = true). Local stand-in for the ATS v8 bond; its name and symbol are fixed (Mock Faultline Bond, mFLB)." },
  { id: "issuerRole", title: "KYC role for the issuer", kind: "wallet", requires: ["bond"], detail: "grantRole(ROLE_KYC, your wallet). On ATS this is ROLE_SSI_MANAGER plus addIssuer; MockBond only checks ROLE_KYC." },
  { id: "bondKyc", title: "Bond KYC for the investors", kind: "wallet", requires: ["issuerRole"], detail: "grantKyc(investor, opaque vcId, now, now + 100 years, your wallet), one transaction per investor." },
  { id: "pool", title: "Deploy FaultlinePool", kind: "wallet", requires: ["bond"], detail: "The repo build of FaultlinePool with the schedule and economics above (D5: pool first)." },
  { id: "trigger", title: "Deploy FaultlineTrigger", kind: "wallet", requires: ["pool"], detail: "FaultlineTrigger(pool, termsHash, challengeWindow, oracle, admin, trustee); it copies the schedule from the pool." },
  { id: "backupTrustee", title: "Backup trustee (optional)", kind: "wallet", optional: true, requires: ["trigger"], detail: "trigger.grantRole(TRUSTEE_ROLE, backup), signed by the TRUSTEE wallet: TRUSTEE_ROLE administers itself, so the admin cannot grant it (D17). Losing every trustee key removes veto and pause." },
  { id: "initialize", title: "pool.initialize(trigger)", kind: "wallet", requires: ["trigger"], detail: "Links the pool to the trigger once and associates the pool with the stablecoin (HIP-719)." },
  { id: "poolHtsKyc", title: "Stablecoin KYC for the pool", kind: "wallet", requires: ["initialize"], detail: "MockUSD.grantKyc(pool), signed by the MockUSD admin (on Hedera: TokenGrantKyc with the token's KYC key, D11)." },
  { id: "roles", title: "Bond roles to the pool", kind: "wallet", requires: ["pool"], detail: "grantRole(ROLE_ISSUER, pool) and grantRole(ROLE_CONTROLLER, pool): only the pool mints and burns (D4)." },
  { id: "investorHtsKyc", title: "Stablecoin KYC for the investors", kind: "wallet", requires: [], detail: "MockUSD.grantKyc(investor) for every listed investor that does not have it yet." },
  { id: "audit", title: "Role audit and D4 checks", kind: "check", requires: ["topic", "bond", "issuerRole", "bondKyc", "pool", "trigger", "backupTrustee", "initialize", "poolHtsKyc", "roles", "investorHtsKyc"], detail: "Bond role audit (SEC-20), wiring, supply guard, solvency and the bytecode each deployment carried." },
];

const TESTNET_PLAN: StepDef[] = [
  { id: "topic", title: "HCS topic", kind: "ops", requires: [], detail: "TopicCreate with submit key = oracle signer and admin key = trustee, paid by a relayer (D16). Hedera has no HCS system contract, so a browser wallet cannot sign it." },
  { id: "bond", title: "Deploy the ATS v8 bond", kind: "wallet", requires: [], detail: "Factory 0.0.9213391 deployBond: Luhn-valid ISIN, 6 decimals, nominal 1 USD, maxSupply = cap, controllable, internal KYC; DEFAULT_ADMIN, SSI_MANAGER and KYC to your wallet, nobody gets ISSUER (D4)." },
  { id: "issuerRole", title: "Register your wallet as SSI issuer", kind: "wallet", requires: ["bond"], detail: "addIssuer(your wallet): ATS v8 needs a registered issuer before grantKyc (ATS issue 1390)." },
  { id: "bondKyc", title: "Bond KYC for the investors", kind: "wallet", requires: ["issuerRole"], detail: "grantKyc(investor, opaque vcId, now, now + 100 years, your wallet). No personal data on chain: the vcId is an opaque id." },
  { id: "pool", title: "Deploy FaultlinePool", kind: "wallet", requires: ["bond"], detail: "The repo build of FaultlinePool with the schedule and economics above (D5: pool first)." },
  { id: "trigger", title: "Deploy FaultlineTrigger", kind: "wallet", requires: ["pool"], detail: "FaultlineTrigger(pool, termsHash, challengeWindow, oracle, admin, trustee); it copies the schedule from the pool." },
  { id: "backupTrustee", title: "Backup trustee (optional)", kind: "wallet", optional: true, requires: ["trigger"], detail: "trigger.grantRole(TRUSTEE_ROLE, backup), signed by the TRUSTEE wallet: TRUSTEE_ROLE administers itself, so the admin cannot grant it (D17). Losing every trustee key removes veto and pause." },
  { id: "initialize", title: "pool.initialize(trigger)", kind: "wallet", requires: ["trigger"], detail: "Links the pool to the trigger once and associates the pool with the stablecoin through the token's associate() (HIP-719)." },
  { id: "poolHtsKyc", title: "Stablecoin KYC for the pool", kind: "ops", requires: ["initialize"], detail: "TokenGrantKyc(stablecoin, pool) signed by the token's KYC key (D11)." },
  { id: "roles", title: "Bond roles to the pool", kind: "wallet", requires: ["pool"], detail: "applyRoles([ROLE_ISSUER, ROLE_CONTROLLER], [true, true], pool): only the pool mints and burns (D4)." },
  { id: "investorHtsKyc", title: "Stablecoin KYC for the investors", kind: "ops", requires: [], detail: "Each investor associates with the stablecoin (its own wallet, the token's associate()), then TokenGrantKyc by the KYC key." },
  { id: "audit", title: "Role audit and D4 checks", kind: "check", requires: ["topic", "bond", "issuerRole", "bondKyc", "pool", "trigger", "backupTrustee", "initialize", "poolHtsKyc", "roles", "investorHtsKyc"], detail: "Bond role audit (SEC-20), wiring, supply guard, solvency and the bytecode each deployment carried." },
];

export function planFor(mode: IssuerMode): StepDef[] {
  return mode === "local" ? LOCAL_PLAN : TESTNET_PLAN;
}

/** Which issuer mode a chain supports; null for any other chain (the page refuses to launch there). */
export function modeForChain(chainId: number): IssuerMode | null {
  return chainId === 31337 ? "local" : chainId === 296 ? "testnet" : null;
}

export type StepStatus = "done" | "skipped" | "ready" | "blocked";

export function stepStatus(state: WizardState, id: StepId): StepStatus {
  const rec = state.steps[id];
  if (rec) return rec.status;
  const def = planFor(state.mode).find((s) => s.id === id);
  if (!def) throw new Error(`unknown step ${id}`);
  return def.requires.every((r) => state.steps[r]) ? "ready" : "blocked";
}

/** The first step in plan order that is ready; null when every step is done or skipped. */
export function nextStep(state: WizardState): StepDef | null {
  return planFor(state.mode).find((s) => stepStatus(state, s.id) === "ready") ?? null;
}

export const isFinished = (state: WizardState) => planFor(state.mode).every((s) => state.steps[s.id]);
/** Inputs are frozen once anything was sent: a later edit would no longer describe what is on chain. */
export const isLocked = (state: WizardState) => Object.values(state.steps).some((r) => r?.status === "done" && (r.txs?.length ?? 0) > 0) || Boolean(state.out.bond);

export function createWizard(inputs: IssuerInputs, chainId: number, now = new Date()): WizardState {
  const mode = modeForChain(chainId);
  if (!mode) throw new Error(`The issuer page launches bonds only on the local chain (31337) or Hedera testnet (296), not on chain ${chainId}.`);
  const state: WizardState = { v: 1, chainId, mode, createdAt: now.toISOString(), inputs, steps: {}, out: {} };
  return autoSkip(state, now);
}

/** Steps with nothing to do are marked skipped up front: the local topic, and investor KYC when no investor is listed. */
function autoSkip(state: WizardState, now: Date): WizardState {
  const at = now.toISOString();
  const steps = { ...state.steps };
  if (state.mode === "local" && !steps.topic) steps.topic = { status: "skipped", at, note: "local chain: mock HCS file, no topic" };
  if (!state.inputs.parties.backupTrustee && !steps.backupTrustee) steps.backupTrustee = { status: "skipped", at, note: "no backup trustee listed" };
  if (state.inputs.parties.investors.length === 0) {
    if (!steps.bondKyc) steps.bondKyc = { status: "skipped", at, note: "no investor listed" };
    if (!steps.investorHtsKyc) steps.investorHtsKyc = { status: "skipped", at, note: "no investor listed" };
  }
  return { ...state, steps };
}

/** Records a finished step. Refuses a step that is not ready, so the order of the plan always holds. */
export function completeStep(state: WizardState, id: StepId, patch: { out?: Partial<Outputs>; txs?: string[]; note?: string } = {}, now = new Date()): WizardState {
  const status = stepStatus(state, id);
  if (status !== "ready") throw new Error(`step ${id} is ${status}`);
  const rec: StepRecord = { status: "done", at: now.toISOString(), ...(patch.txs?.length ? { txs: patch.txs } : {}), ...(patch.note ? { note: patch.note } : {}) };
  return { ...state, steps: { ...state.steps, [id]: rec }, out: { ...state.out, ...patch.out, initcodeKeccak: { ...state.out.initcodeKeccak, ...patch.out?.initcodeKeccak } } };
}

/** Skips an optional step that is ready (the "Skip" button). */
export function skipStep(state: WizardState, id: StepId, note: string, now = new Date()): WizardState {
  const def = planFor(state.mode).find((s) => s.id === id);
  if (!def?.optional) throw new Error(`step ${id} is not optional`);
  const status = stepStatus(state, id);
  if (status !== "ready") throw new Error(`step ${id} is ${status}`);
  return { ...state, steps: { ...state.steps, [id]: { status: "skipped", at: now.toISOString(), note } } };
}

/** Why `wallet` may not sign the backup-trustee grant; null when it is the trustee (D17: TRUSTEE_ROLE administers itself). */
export function trusteeSignerProblem(wallet: string, trustee: string): string | null {
  if (isAddress(wallet) && isAddress(trustee) && getAddress(wallet) === getAddress(trustee)) return null;
  return `Only the trustee ${isAddress(trustee) ? getAddress(trustee) : trustee} can grant TRUSTEE_ROLE (D17: the role administers itself; the admin cannot). Connect the trustee wallet for this step, or skip it.`;
}

/** Keeps outputs learned before a step finished (e.g. a bond address from a mined deploy whose follow-up read failed). */
export function recordOutputs(state: WizardState, out: Partial<Outputs>): WizardState {
  return { ...state, out: { ...state.out, ...out, initcodeKeccak: { ...state.out.initcodeKeccak, ...out.initcodeKeccak } } };
}

// ---------------------------------------------------------------- inputs

/** Problems with the parties before the wizard starts (addresses, the admin = the wallet, bond name). */
export function validateParties(p: Parties, wallet: string | null, mode: IssuerMode): string[] {
  const out: string[] = [];
  const addr = (label: string, v: string) => {
    if (!isAddress(v)) out.push(`${label}: not an EVM address.`);
  };
  // With no wallet yet the page asks to sign in instead; an empty admin is not reported twice.
  if (p.admin || wallet) addr("Admin", p.admin);
  addr("Sponsor", p.sponsor);
  addr("Oracle signer", p.oracle);
  addr("Trustee", p.trustee);
  addr("Stablecoin", p.stablecoin);
  p.investors.forEach((v, i) => addr(`Investor ${i + 1}`, v));
  if (mode === "testnet") {
    addr("Topic payer (relayer)", p.topicPayer);
    addr("Stablecoin KYC key holder", p.kycKeyHolder);
  }
  if (p.backupTrustee) {
    addr("Backup trustee", p.backupTrustee);
    if (isAddress(p.backupTrustee) && isAddress(p.trustee) && getAddress(p.backupTrustee) === getAddress(p.trustee)) out.push("Backup trustee: must differ from the trustee.");
  }
  if (wallet && isAddress(p.admin) && getAddress(p.admin) !== getAddress(wallet)) out.push("Admin must be the connected wallet: it deploys, calls initialize and grants the bond roles.");
  const uniq = new Set(p.investors.filter(isAddress).map((a) => getAddress(a)));
  if (uniq.size !== p.investors.filter(isAddress).length) out.push("An investor is listed twice.");
  if (p.investors.length > 20) out.push("At most 20 investors per launch (one transaction each).");
  if (!/^[\w .-]{3,64}$/.test(p.bondName)) out.push("Bond name: 3 to 64 letters, digits, spaces, dots or dashes.");
  if (!/^[A-Z0-9]{2,10}$/.test(p.bondSymbol)) out.push("Bond symbol: 2 to 10 capital letters or digits.");
  return out;
}

// ---------------------------------------------------------------- persistence

const KEY = (chainId: number) => `faultline.issuer.wizard.${chainId}`;

/** Parses stored JSON; null for anything that is not a version-1 wizard of this chain. */
export function parseWizard(raw: string | null, chainId: number): WizardState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WizardState>;
    if (s.v !== 1 || s.chainId !== chainId || (s.mode !== "local" && s.mode !== "testnet") || s.mode !== modeForChain(chainId)) return null;
    if (!s.inputs?.terms || !s.inputs.schedule || !s.inputs.parties || !Array.isArray(s.inputs.parties.investors)) return null;
    if (typeof s.steps !== "object" || s.steps === null || typeof s.out !== "object" || s.out === null) return null;
    const ids = new Set(planFor(s.mode).map((d) => d.id));
    for (const [k, r] of Object.entries(s.steps)) if (!ids.has(k as StepId) || !r || (r.status !== "done" && r.status !== "skipped")) return null;
    return s as WizardState;
  } catch {
    return null;
  }
}

export function loadWizard(store: SessionStore | null, chainId: number): WizardState | null {
  try {
    return parseWizard(store?.getItem(KEY(chainId)) ?? null, chainId);
  } catch {
    return null;
  }
}

export function saveWizard(store: SessionStore | null, state: WizardState): boolean {
  try {
    store?.setItem(KEY(state.chainId), JSON.stringify(state));
    return Boolean(store);
  } catch {
    return false;
  }
}

export function clearWizard(store: SessionStore | null, chainId: number): void {
  try {
    store?.removeItem(KEY(chainId));
  } catch {
    // The page still holds the state in memory; a reload would show it again.
  }
}
