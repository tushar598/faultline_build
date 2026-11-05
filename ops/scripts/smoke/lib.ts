// Ported from the reference repo (ops/scripts/smoke/lib.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Shared bits for the Faultline testnet smoke run (faultline HANDOVER §10 step 5b): the fresh accounts, resumable
// state (out/smoke-state.json), evidence (out/evidence.jsonl via common.ts), the MAIN repo's compiled artifacts and
// attestation helpers (never copied here), pool invariants and HBAR accounting.
//
// Same safety model as common.ts: dry run by default, real transactions only with EXECUTE=1 run by the owner, keys
// only from the Hardhat keystore, never printed. Nothing here holds or writes a secret.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { register } from "tsx/cjs/api";
import { Contract, ContractFactory, formatUnits, keccak256, type Provider } from "ethers";
import { BOND_ABI, EXECUTE, ROOT, explain, extendErrors, gasPriceWei, readProvider, record, recordRejected, signerFor, step, type SignerNetwork } from "../lib/common.js";
import { mirror, operatorClient } from "../lib/hedera.js";

export { EXECUTE };

// ---------------------------------------------------------------- the main repo (artifacts + shared/ts)

export const FAULTLINE = path.resolve(ROOT, ".."); // ops/ lives inside the faultline repo

// shared/ts is CommonJS-format TypeScript under the main repo's package.json and imports `./jcs` without an
// extension. A plain ESM `import` from this (ESM) repo fails with "Cannot find module './jcs'" (Node's CJS
// translator does not try .ts). tsx's CommonJS hook resolves it, so the REAL module is loaded, not a copy.
// Loaded lazily: only the phases that build terms or attestations need it.
type Shared = typeof import("../../../shared/ts/attestation.js");
let _shared: Shared | undefined;
export function sharedTs(): Shared {
  if (!_shared) {
    register();
    _shared = createRequire(import.meta.url)(path.join(FAULTLINE, "shared", "ts", "attestation.ts")) as Shared;
  }
  return _shared;
}
/** Any other shared/ts module, loaded the same way (e.g. "hcsMessage"). */
export function requireShared<T>(module: string): T {
  register();
  return createRequire(import.meta.url)(path.join(FAULTLINE, "shared", "ts", `${module}.ts`)) as T;
}
/** The main repo's bond role audit (SEC-20), loaded the same way: the check stays in one place. */
type BondAudit = typeof import("../../../scripts/lib/bondAudit.js");
export function bondAudit(): BondAudit {
  register();
  return createRequire(import.meta.url)(path.join(FAULTLINE, "scripts", "lib", "bondAudit.ts")) as BondAudit;
}
export type Attestation = import("../../../shared/ts/attestation.js").Attestation;
export type UsgsFeature = import("../../../shared/ts/attestation.js").UsgsFeature;

/** The saved real USGS record of the 2001 Bhuj earthquake (faultline/oracle/fixtures). */
export const BHUJ_ID = "usp000a8ds";
export function bhujFixture(): UsgsFeature {
  return JSON.parse(fs.readFileSync(path.join(FAULTLINE, "oracle", "fixtures", "real-usgs-usp000a8ds-detail.geojson"), "utf8"));
}

type Artifact = { abi: unknown[]; bytecode: string };
export function artifact(name: "FaultlinePool" | "FaultlineTrigger"): Artifact {
  return JSON.parse(fs.readFileSync(path.join(FAULTLINE, "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8"));
}
/** Main repo commit, whether contracts/ or shared/ have uncommitted changes, and keccak256 of each creation bytecode. */
export function buildInfo() {
  const git = (...a: string[]) => execFileSync("git", ["-C", FAULTLINE, ...a], { encoding: "utf8" }).trim();
  return {
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain", "--", "contracts", "shared") !== "",
    poolInitcodeKeccak: keccak256(artifact("FaultlinePool").bytecode),
    triggerInitcodeKeccak: keccak256(artifact("FaultlineTrigger").bytecode),
  };
}

// ---------------------------------------------------------------- accounts (docs/ACCOUNTS.md)

// The new FLH_* testnet accounts (owner, 2026-11-06). Public ids and EVM addresses only; the keys live in the global
// Hardhat 3 keystore. Nothing from the reference repo's old deployment is reused. All eight were hollow (funded by an
// HBAR transfer to the EVM address) on 2026-11-06; each one is completed by its first signed transaction.
export type Role = "deployer" | "trustee" | "oracle" | "sponsor" | "investorA" | "investorB" | "relayer" | "trusteeBackup";
export const ACCOUNTS: Record<Role, { network: SignerNetwork; keyName: string; id?: string; evm: string }> = {
  deployer: { network: "flhDeployer", keyName: "FLH_DEPLOYER_PRIVATE_KEY", id: "0.0.11329142", evm: "0xbF89BCE061513D4763047D5F5A16846F149Ca248" },
  trustee: { network: "flhTrustee", keyName: "FLH_TRUSTEE_PRIVATE_KEY", id: "0.0.11329263", evm: "0x965eB9d778a912b23e467ba28490927b25E655ee" },
  // Signs only (attestations, HCS submit key). It has a funded Hedera account 0.0.11329557, but no script pays from it.
  oracle: { network: "flhOracle", keyName: "FLH_ORACLE_PRIVATE_KEY", evm: "0x90A59Def9432C863A76F995Cd1eE57a881bb5a76" },
  sponsor: { network: "flhSponsor", keyName: "FLH_SPONSOR_PRIVATE_KEY", id: "0.0.11329411", evm: "0x457DC9004E8e68FFEbed749C18Ed27F94Ca66FE3" },
  investorA: { network: "flhInvestorA", keyName: "FLH_INVESTOR_A_PRIVATE_KEY", id: "0.0.11329421", evm: "0xCE69d905EFc74B2fa4c93D6924EF5903DF8d9bda" },
  investorB: { network: "flhInvestorB", keyName: "FLH_INVESTOR_B_PRIVATE_KEY", id: "0.0.11329470", evm: "0xF9786F3fc700F6ADE804DfC5c2A07c8CaB4C301F" },
  // The oracle's relayer (D16, spike S7) and the backup trustee (D17); used by the full demo.
  relayer: { network: "flhRelayer", keyName: "FLH_RELAYER_PRIVATE_KEY", id: "0.0.11329581", evm: "0x2f9A68d7880c9052A7Dac59aFe5b8223CF2eD5Db" },
  trusteeBackup: { network: "flhTrusteeBackup", keyName: "FLH_TRUSTEE_BACKUP_PRIVATE_KEY", id: "0.0.11329384", evm: "0xD66383855628a46A3E300ad889E9dF2eA9c5A0B0" },
};
/** The six roles the smoke run used (its preflight checks exactly these keystore names). */
export const SMOKE_ROLES = ["deployer", "trustee", "oracle", "sponsor", "investorA", "investorB"] as const satisfies readonly Role[];
type PayingRole = Exclude<Role, "oracle">;
/** Accounts whose HBAR balance printHbar() tracks; the full demo adds the relayer and the backup trustee. */
export let PAYING_ROLES: readonly PayingRole[] = ["deployer", "trustee", "sponsor", "investorA", "investorB"];

/** SDK client paid and signed by `role` (EXECUTE=1 only); a hollow payer is allowed (completed by that tx). */
export const clientOf = (role: Role) => operatorClient(ACCOUNTS[role].network, ACCOUNTS[role].id!, ACCOUNTS[role].keyName, true);

// ---------------------------------------------------------------- state (addresses and numbers only, never secrets)

type State = Record<string, unknown>;
let STATE_FILE = path.join(ROOT, "out", "smoke-state.json");
/**
 * Points this module at another run: its own state file in out/ (addresses and numbers only) and the accounts whose
 * HBAR it tracks. The full demo (scripts/demo) calls it once at import time, before any phase code runs, so the smoke
 * run's out/smoke-state.json is never touched again.
 */
export function configureRun(opts: { stateFile: string; payingRoles: readonly PayingRole[] }): void {
  STATE_FILE = path.join(ROOT, "out", opts.stateFile);
  PAYING_ROLES = opts.payingRoles;
}
export function loadSmoke(): State {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}
export function saveSmoke(patch: State): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const json = JSON.stringify({ ...loadSmoke(), ...patch }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  fs.writeFileSync(STATE_FILE, json + "\n");
}
export function needSmoke(key: string): string {
  const v = loadSmoke()[key];
  if (v === undefined) throw new Error(`out/${path.basename(STATE_FILE)} has no "${key}" yet — run the earlier phase first.`);
  return String(v);
}

// ---------------------------------------------------------------- mirror node

type MirrorAccount = { account: string; evm_address: string; balance: { balance: number }; key: { _type: string; key: string } | null; ethereum_nonce: number; max_automatic_token_associations: number };
export const mirrorAccount = (idOrEvm: string) => mirror<MirrorAccount>(`/api/v1/accounts/${idOrEvm}`);

/** Mirror-node `charged_tx_fee` (tinybar → HBAR) and consensus timestamp of an EVM tx, by hash. */
export async function feeOf(txHash: string): Promise<{ chargedHbar?: number; consensusTimestamp?: string; mirrorResult?: string }> {
  for (let i = 0; i < 8; i++) {
    const r = await mirror<{ timestamp: string }>(`/api/v1/contracts/results/${txHash}`);
    if (r?.timestamp) {
      const t = await mirror<{ transactions: { charged_tx_fee: number; result: string }[] }>(`/api/v1/transactions?timestamp=${r.timestamp}`);
      const tx = t?.transactions?.[0];
      if (tx) return { chargedHbar: tx.charged_tx_fee / 1e8, consensusTimestamp: r.timestamp, mirrorResult: tx.result };
    }
    await new Promise((res) => setTimeout(res, 2000)); // mirror-node lag
  }
  return {};
}

/** common.step() for one smoke phase: sender = `role`, evidence with the mirror-node fee. With EXECUTE=1 a reverted
 *  simulation (common.step returns without a hash) STOPS the run, so later steps never send on a broken state. */
export async function tx(phase: string, role: Role, what: string, contract: Contract, method: string, args: unknown[]) {
  const r = await step({ spike: phase, what, from: ACCOUNTS[role].evm, contract, method, args, signerNetwork: ACCOUNTS[role].network, evidence: feeOf });
  if (EXECUTE && !r.hash) throw new Error(`${what}: simulation reverted — stopped, nothing sent for this step or after it`);
  return r;
}

/**
 * Deploy one of the MAIN repo's contracts (its compiled artifact, never a copy) from `role`.
 * DRY RUN: eth_call + eth_estimateGas of the creation tx from the role's address; prints gas and HBAR. EXECUTE=1:
 * sends with gasLimit = estimate × 1.3, waits, records evidence (with the mirror fee). Returns the new address.
 */
export async function deploy(phase: string, role: Role, what: string, name: "FaultlinePool" | "FaultlineTrigger", args: unknown[]): Promise<{ address?: string; gasEstimate?: bigint; blockNumber?: number; txHash?: string }> {
  const a = artifact(name);
  const factory = new ContractFactory(a.abi as never, a.bytecode);
  const p = await readProvider();
  const req = { ...(await factory.getDeployTransaction(...args)), from: ACCOUNTS[role].evm };
  console.log(`\n[${phase}] ${what}`);
  console.log(`  create: ${name} (${(a.bytecode.length - 2) / 2} bytes init code, keccak ${keccak256(a.bytecode)})`);
  console.log(`  args: ${JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  console.log(`  from: ${ACCOUNTS[role].evm}`);
  let gas: bigint;
  try {
    await p.call(req);
    gas = await p.estimateGas(req);
  } catch (err) {
    console.log(`  simulation: REVERT → ${explain(err)}\n  ✖ unexpected revert; do not execute this step.`);
    throw new Error(`${name} deploy simulation reverted`);
  }
  const gasLimit = (gas * 130n) / 100n;
  console.log(`  simulation: OK, gas ≈ ${gas}, cost ≈ ${formatUnits(gas * (await gasPriceWei(p)), 18)} HBAR; gas limit ${gasLimit}`);
  if (!EXECUTE) {
    console.log("  (dry run — nothing sent; rerun with EXECUTE=1 after the owner's OK)");
    return { gasEstimate: gas };
  }
  let c;
  try {
    c = await factory.connect(await signerFor(ACCOUNTS[role].network)).deploy(...args, { gasLimit });
  } catch (err) {
    recordRejected(phase, what, err, { from: ACCOUNTS[role].evm, initcodeBytes: (a.bytecode.length - 2) / 2, gasEstimate: gas.toString(), gasLimit: gasLimit.toString() });
    throw err;
  }
  const t = c.deploymentTransaction()!;
  console.log(`  sent: ${t.hash}`);
  try {
    const r = await t.wait();
    const address = await c.getAddress();
    console.log(`  status: SUCCESS  gasUsed: ${r?.gasUsed}  address: ${address}`);
    record(phase, what, t.hash, { status: "SUCCESS", from: ACCOUNTS[role].evm, address, initcodeKeccak: keccak256(a.bytecode), gasEstimate: gas.toString(), gasLimit: gasLimit.toString(), gasUsed: r?.gasUsed?.toString(), ...(await feeOf(t.hash)) });
    return { address, gasEstimate: gas, blockNumber: r?.blockNumber, txHash: t.hash };
  } catch (err) {
    console.log(`  status: FAILED → ${explain(err)}`);
    record(phase, `FAILED: ${what}`, t.hash, { status: "FAILED", error: explain(err), from: ACCOUNTS[role].evm, gasEstimate: gas.toString(), gasLimit: gasLimit.toString(), ...(await feeOf(t.hash).catch(() => ({}))) });
    throw err;
  }
}

/** Hedera account id (0.0.x) of a contract, from the mirror node (polls while the mirror catches up). */
export async function contractIdOf(address: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const c = await mirror<{ contract_id: string }>(`/api/v1/contracts/${address}`);
    if (c?.contract_id) return c.contract_id;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${address} not on the mirror node yet; rerun later`);
}

// ---------------------------------------------------------------- contracts

export const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function associate() returns (uint256 responseCode)",
  "function isAssociated() view returns (bool associated)",
];
export const USD = (whole: bigint) => whole * 1_000_000n;
/** 1234567n → "1.234567" (6 decimals). */
export function usd(x: bigint): string {
  const neg = x < 0n;
  const v = neg ? -x : x;
  return `${neg ? "-" : ""}${(v / 1_000_000n).toLocaleString("en-US")}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
}

export const tokenAt = (p: Provider) => new Contract(needSmoke("tokenAddress"), TOKEN_ABI, p);
export const bondAt = (p: Provider) => new Contract(needSmoke("bond"), BOND_ABI, p);
export const poolAt = (p: Provider) => new Contract(needSmoke("pool"), artifact("FaultlinePool").abi as never, p);
export const triggerAt = (p: Provider) => new Contract(needSmoke("trigger"), artifact("FaultlineTrigger").abi as never, p);

/** Lets common.explain decode FaultlinePool / FaultlineTrigger custom errors (call once the artifacts exist). */
export function useFaultlineErrors(): void {
  for (const n of ["FaultlinePool", "FaultlineTrigger"] as const) extendErrors((artifact(n).abi as { type: string }[]).filter((x) => x.type === "error"));
}

// ---------------------------------------------------------------- after every phase

/** Pool invariants (ARCHITECTURE §5): bookkeeping form of invariant 1 (until the first sweepExcess), isSolvent,
 *  supply guard, pendingCount. Returns false if any check fails. */
export async function printInvariants(p: Provider): Promise<boolean> {
  const st = loadSmoke();
  if (!st.pool || !st.trigger) {
    console.log("\ninvariants: pool not deployed yet");
    return true;
  }
  const pool = poolAt(p);
  const [bal, collateralLeft, reserveLeft, totalClaimable, solvent, issued, redeemed, L, supply, pending] = await Promise.all([
    tokenAt(p).balanceOf(needSmoke("pool")),
    pool.collateralLeft(),
    pool.couponReserveLeft(),
    pool.totalClaimable(),
    pool.isSolvent(),
    pool.unitsIssued(),
    pool.unitsRedeemed(),
    pool.appliedLossBps(),
    bondAt(p).totalSupply(),
    triggerAt(p).pendingCount(),
  ]);
  const swept = Boolean(st.sweptExcess);
  const inv1 = bal >= collateralLeft + reserveLeft + totalClaimable;
  const books = BigInt(issued) - BigInt(redeemed);
  const guard = BigInt(supply) <= books; // D18: holders may burn through ATS, only supply above the books is wrong
  // Always-true form of invariant 1 (ARCHITECTURE §5), computed off-chain exactly like FaultlinePool.isSolvent():
  // owed = floor(out*(10000-L)/10000) + floor(out*maxIndex/1e18), maxIndex = index accrued to maturity at the current L.
  const [couponIndex, lastAccrual, couponBps, maturity] = (await Promise.all([pool.couponIndex(), pool.lastAccrual(), pool.couponBps(), pool.maturity()])).map((x) => BigInt(x));
  const BPS = 10_000n;
  const YEAR = 365n * 24n * 3600n;
  const Lb = BigInt(L);
  const maxIndex = maturity > lastAccrual ? couponIndex + ((BPS - Lb) * couponBps * (maturity - lastAccrual) * 10n ** 18n) / (BPS * BPS * YEAR) : couponIndex;
  const out = BigInt(supply) < books ? BigInt(supply) : books; // D18, same as isSolvent()
  const owedPrincipal = (out * (BPS - Lb)) / BPS;
  const owedCoupon = (out * maxIndex) / 10n ** 18n;
  const inv1Always = bal >= totalClaimable + owedPrincipal + owedCoupon;
  console.log(`\ninvariants (pool ${needSmoke("pool")}):`);
  console.log(`  pool balance ${usd(bal)} >= collateralLeft ${usd(collateralLeft)} + couponReserveLeft ${usd(reserveLeft)} + totalClaimable ${usd(totalClaimable)}: ${swept ? `${inv1} (not asserted after sweepExcess, §5)` : inv1}`);
  console.log(`  always-true form: pool balance ${usd(bal)} >= totalClaimable ${usd(totalClaimable)} + owed to ${usd(out)} outstanding units (principal ${usd(owedPrincipal)} + coupon to maturity ${usd(owedCoupon)}): ${inv1Always}`);
  console.log(`  isSolvent(): ${solvent}${solvent === inv1Always ? " (agrees with the off-chain form)" : " ✖ DISAGREES with the off-chain form"}`);
  console.log(`  supply guard: bond.totalSupply ${usd(supply)} <= unitsIssued ${usd(issued)} - unitsRedeemed ${usd(redeemed)}: ${guard}${BigInt(supply) < books ? ` (${usd(books - BigInt(supply))} burned by holders)` : ""}`);
  console.log(`  pendingCount: ${pending}; appliedLossBps: ${L}`);
  const ok = (swept || inv1) && inv1Always && solvent && guard;
  if (!ok) console.log("  ✖ INVARIANT BROKEN — stop and report");
  return ok;
}

/** Balances of every paying account now (tinybar), from the mirror node. */
export async function balances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of PAYING_ROLES) out[r] = (await mirrorAccount(ACCOUNTS[r].id!))!.balance.balance;
  return out;
}

/** HBAR spent per account: since this phase started and since the preflight baseline. No HBAR is transferred
 *  between accounts in the smoke run, so a balance drop is exactly the fees paid. */
export async function printHbar(phaseStart: Record<string, number>): Promise<void> {
  const base = (loadSmoke().baselineTinybar ?? {}) as Record<string, number>;
  const now = await balances();
  console.log("\nHBAR (mirror node; the mirror lags consensus by a few seconds):");
  for (const r of PAYING_ROLES) {
    const phase = (phaseStart[r] - now[r]) / 1e8;
    const total = base[r] !== undefined ? ((base[r] - now[r]) / 1e8).toFixed(4) : "?";
    console.log(`  ${r.padEnd(9)} ${(now[r] / 1e8).toFixed(4)} HBAR now · spent this phase ${phase.toFixed(4)} · since preflight ${total}`);
  }
}

/** EXECUTE only: Hashio answers eth_call from the mirror node, which lags consensus by a few seconds, so a read right
 *  after a mined tx can be stale. Polls `read` (every 3 s, ≤ ~30 s) until `ok`; returns the last value. */
export async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let v = await read().catch(() => undefined as T);
  for (let i = 0; EXECUTE && !ok(v) && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    v = await read().catch(() => undefined as T);
  }
  return v;
}

/**
 * EXECUTE only: polls a staticCall of `method` from `from` (every 3 s, ≤ `maxSec`) until it stops reverting. Covers the
 * mirror-node lag after the previous step and wall-clock conditions (window complete, deadline passed). Returns true
 * when the call simulates; false on timeout (the following `tx()` then simulates once more and stops the run).
 * Dry run: one call, no waiting.
 */
export async function untilSimulates(contract: Contract, method: string, args: unknown[], from: string, maxSec = 90): Promise<boolean> {
  const t0 = Date.now();
  let last = "";
  for (;;) {
    try {
      await contract.getFunction(method).staticCall(...args, { from });
      return true;
    } catch (err) {
      last = explain(err);
    }
    if (!EXECUTE || Date.now() - t0 > maxSec * 1000) {
      if (EXECUTE) console.log(`  ⚠ ${method} still reverts after ${maxSec} s: ${last}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Waits until the latest block time is >= `ts` (prints a countdown every 30 s). Returns false if that would take
 *  longer than `maxSec` (nothing waited then). */
export async function waitForBlockTime(p: Provider, ts: number, label: string, maxSec: number): Promise<boolean> {
  let now = Number((await p.getBlock("latest"))!.timestamp);
  if (now >= ts) return true;
  if (ts - now > maxSec) return false;
  console.log(`  waiting ${ts - now} s for ${label} (block time ${ts})…`);
  let lastPrint = Date.now();
  while (now < ts) {
    await new Promise((r) => setTimeout(r, 5000));
    now = Number((await p.getBlock("latest"))!.timestamp);
    if (Date.now() - lastPrint > 30_000) {
      console.log(`  … ${Math.max(0, ts - now)} s to go`);
      lastPrint = Date.now();
    }
  }
  return true;
}

export async function provider() {
  return readProvider();
}
export async function latestTs(p: Provider): Promise<number> {
  return Number((await p.getBlock("latest"))!.timestamp);
}
