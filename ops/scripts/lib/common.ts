// Ported from the reference repo's ops/scripts/lib/common.ts (2026-11-06): FLH_* keystore names, no spike-era accounts.
// Shared helpers for the Faultline testnet scripts (ops/).
//
// Safety model:
// - Every state-changing step runs in DRY-RUN mode by default: it only simulates the call
//   (eth_call + eth_estimateGas from the expected signer's address) on the key-less `testnetRead`
//   network and prints what would happen and what it would cost. No key, no password, no transaction.
// - A real transaction is sent only when the owner runs the script with EXECUTE=1 (key from the keystore).
// - Keys are never read, printed or written by these scripts; Hardhat's keystore plugin signs.

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { Contract, Interface, JsonRpcProvider, Wallet, formatUnits, type Provider } from "ethers";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "out");

// ---- Testnet facts (sources: docs/reference/ats.md, mirror node 2026-10-25). Hashgraph's public ATS v8 infrastructure,
// not part of any Faultline deployment. ----
export const FACTORY = "0xd1F118A40f3b02883D35909eF2517e7EDd78379d"; // ATS v8 factory proxy 0.0.9213391
export const BLR = "0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a"; // ATS v8 BLR proxy 0.0.9212226
export const BOND_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

export const ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  CONTROLLER: "0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e",
  AGENT: "0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b",
  KYC: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  SSI_MANAGER: "0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1",
  PAUSER: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
  ADJUSTMENT_BALANCE: "0xb246506a8ded65dd6360e8ce033fd9462936d1be64fb9f85c5f60d28cd3ca6da",
} as const;

const abi = (name: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "abi", `${name}.json`), "utf8"));
export const FACTORY_ABI = abi("AtsFactory");
export const BOND_ABI = abi("AtsBond");
let ERRORS = new Interface(abi("AtsErrors"));
/** Adds more custom errors (e.g. Faultline's) to what `explain` can decode; duplicates by selector are skipped. */
export function extendErrors(fragments: readonly unknown[]): void {
  const known = new Set<string>();
  ERRORS.forEachError((e) => known.add(e.selector));
  const extra = new Interface(fragments as never).fragments.filter((f) => f.type === "error" && !known.has((f as unknown as { selector: string }).selector));
  ERRORS = new Interface([...ERRORS.fragments, ...extra]);
}

export const EXECUTE = process.env.EXECUTE === "1";

// ---- State shared between steps (addresses only, never secrets) ----
type State = Record<string, string | number>;
const STATE_FILE = path.join(OUT, "state.json");
export function loadState(): State {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}
export function saveState(patch: State): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...patch }, null, 2) + "\n");
}
export function need(key: string): string {
  const v = loadState()[key];
  if (v === undefined) throw new Error(`out/state.json has no "${key}" yet — run the earlier step first.`);
  return String(v);
}

// ---- Evidence log (one JSON line per real transaction) ----
export function record(spike: string, what: string, txHash: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(OUT, { recursive: true });
  const line = { date: new Date().toISOString(), spike, what, txHash, hashscan: `https://hashscan.io/testnet/transaction/${txHash}`, ...extra };
  fs.appendFileSync(path.join(OUT, "evidence.jsonl"), JSON.stringify(line) + "\n");
  console.log(`  evidence: ${line.hashscan}`);
}

/**
 * A send that was rejected before consensus (relay or node precheck): no transaction hash came back, so nothing was
 * executed. Whether a fee was charged is not known from the error alone; the payer's mirror-node balance decides.
 */
export function recordRejected(spike: string, what: string, err: unknown, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(OUT, { recursive: true });
  const line = { date: new Date().toISOString(), spike, what: `REJECTED before consensus: ${what}`, txHash: null, status: "REJECTED_PRECHECK", error: explain(err), note: "no tx hash returned; check the payer's mirror balance for any fee", ...extra };
  fs.appendFileSync(path.join(OUT, "evidence.jsonl"), JSON.stringify(line) + "\n");
  console.log(`  status: REJECTED before consensus (no tx hash) → ${line.error}`);
}

// ---- Connections ----
// Hardhat 3's HTTP provider gets "unexpected status code" from Hashio on large eth_call/eth_estimateGas
// requests (deployBond, ~2.3 KB calldata), while plain ethers works (checked 2026-10-25). So both reads and
// writes go through a plain ethers JsonRpcProvider; Hardhat is used only for compiling and the keystore.
//
// RPC choice (Hashio returned 502 on 2026-10-27): the hosted testnet relays listed in the Hedera docs
// (docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay, read 2026-10-27) that need no API key are
// Hashio and thirdweb. FL_RPC_URL (one URL, or several comma-separated in order of preference) overrides the list.
// The first candidate that answers eth_chainId == 296 and eth_blockNumber is used for the whole process and printed,
// so every log says which relay carried it. Known limits (checked 2026-10-27): Hashio eth_getLogs spans <= 7 days,
// thirdweb eth_getLogs <= 1000 blocks; both answer browser CORS preflights with `*`.
export const RPC_CANDIDATES = (process.env.FL_RPC_URL ?? "https://testnet.hashio.io/api,https://296.rpc.thirdweb.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export type RpcHealth = { url: string; ok: boolean; ms: number; block?: number; error?: string };
/** eth_chainId + eth_blockNumber against one relay (plain fetch, 15 s timeout). */
export async function rpcHealth(url: string): Promise<RpcHealth> {
  const t0 = Date.now();
  const call = async (method: string) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message: string } };
    if (!body.result) throw new Error(body.error?.message ?? "no result");
    return body.result;
  };
  try {
    const chainId = await call("eth_chainId");
    if (BigInt(chainId) !== 296n) throw new Error(`chainId ${BigInt(chainId)}, expected 296`);
    const block = Number(BigInt(await call("eth_blockNumber")));
    return { url, ok: true, ms: Date.now() - t0, block };
  } catch (e) {
    return { url, ok: false, ms: Date.now() - t0, error: (e as Error).message };
  }
}
let _provider: JsonRpcProvider | undefined;
let _rpcUrl: string | undefined;
export async function readProvider(): Promise<JsonRpcProvider> {
  if (!_provider) {
    for (const url of RPC_CANDIDATES) {
      const h = await rpcHealth(url);
      if (h.ok) {
        _rpcUrl = url;
        break;
      }
      console.log(`  RPC ${url} unhealthy (${h.error}); trying the next one`);
    }
    if (!_rpcUrl) throw new Error(`no healthy testnet RPC among ${RPC_CANDIDATES.join(", ")} — nothing sent`);
    console.log(`RPC: ${_rpcUrl}`);
    _provider = new JsonRpcProvider(_rpcUrl, 296, { staticNetwork: true });
  }
  return _provider;
}
/** The relay readProvider() chose (after its first call). */
export function rpcUrl(): string {
  if (!_rpcUrl) throw new Error("readProvider() has not chosen an RPC yet");
  return _rpcUrl;
}

export const KEY_FOR = {
  flhDeployer: "FLH_DEPLOYER_PRIVATE_KEY",
  flhTrustee: "FLH_TRUSTEE_PRIVATE_KEY",
  flhOracle: "FLH_ORACLE_PRIVATE_KEY",
  flhSponsor: "FLH_SPONSOR_PRIVATE_KEY",
  flhInvestorA: "FLH_INVESTOR_A_PRIVATE_KEY",
  flhInvestorB: "FLH_INVESTOR_B_PRIVATE_KEY",
  flhRelayer: "FLH_RELAYER_PRIVATE_KEY",
  flhTrusteeBackup: "FLH_TRUSTEE_BACKUP_PRIVATE_KEY",
} as const;
export type SignerNetwork = keyof typeof KEY_FOR;
/**
 * Signer for real transactions. Only called when EXECUTE=1 (or by the smoke preflight's key check). The key is
 * resolved from the Hardhat keystore (prompts the owner for the keystore password), held in memory only, and never
 * printed or written.
 */
export async function signerFor(networkName: SignerNetwork): Promise<Wallet> {
  const net = hre.config.networks[networkName] as { accounts: { get(): Promise<string> }[] };
  const key = await net.accounts[0].get();
  const wallet = new Wallet(key, await readProvider());
  console.log(`  signer (${KEY_FOR[networkName]}): ${wallet.address}`);
  return wallet;
}

/**
 * The raw key behind `networkName`, for handing to a child process in memory (the full demo's oracle wrapper passes it
 * as an environment variable of the spawned oracle CLI). EXECUTE only; checked to derive to `expected`; never printed
 * or written.
 */
export async function privateKeyFor(networkName: SignerNetwork, expected: string): Promise<string> {
  const net = hre.config.networks[networkName] as { accounts: { get(): Promise<string> }[] };
  const key = await net.accounts[0].get();
  if (new Wallet(key).address.toLowerCase() !== expected.toLowerCase()) throw new Error(`${KEY_FOR[networkName]} does not derive to ${expected}; nothing sent`);
  return key;
}

/** Decode ATS / OZ custom errors out of an ethers error. */
export function explain(err: unknown): string {
  const e = err as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
  const data = e.data ?? e.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = ERRORS.parseError(data);
      if (parsed) return `${parsed.name}(${parsed.args.map(String).join(", ")})  [selector ${data.slice(0, 10)}]`;
    } catch { /* fall through */ }
    return `unknown revert data ${data}`;
  }
  return e.shortMessage ?? e.message ?? String(err);
}

export async function gasPriceWei(p: Provider): Promise<bigint> {
  const fee = await p.getFeeData();
  return fee.gasPrice ?? 0n;
}

// Hashio's eth_estimateGas can sit right at the edge: revokeKyc with gasLimit == estimate (112,375) ran out of gas
// on testnet (CONTRACT_REVERT_EXECUTED, empty revert data) while 135,000 passed (2026-10-25). The retry with this
// buffer used 93,646 of 146,087 and was charged for the gas used only (mirror node), so the buffer costs nothing.
const GAS_BUFFER_PCT = 130n;

/**
 * Run one state-changing call.
 * DRY-RUN: simulates from `from` and prints gas + HBAR estimate. EXECUTE=1: sends it with the signer.
 * `expectRevert` marks negative checks: in dry-run a revert is the expected answer and nothing is ever sent.
 */
export async function step(opts: {
  spike: string;
  what: string;
  from: string;
  contract: Contract; // connected to the read provider
  method: string;
  args: unknown[];
  signerNetwork?: SignerNetwork;
  expectRevert?: boolean;
  /** Never send, even with EXECUTE=1 (used for checks that only need a simulation). */
  simulateOnly?: boolean;
  /** Print the staticCall return values (e.g. SpikeVault pullRaw/pushRaw → ok, returnData, balanceDelta). */
  showResult?: boolean;
  /** Extra evidence fields looked up after the tx is mined (e.g. the mirror-node fee); also for failed txs. */
  evidence?: (txHash: string) => Promise<Record<string, unknown>>;
}): Promise<{ hash?: string; receipt?: unknown; gasEstimate?: bigint }> {
  const p = opts.contract.runner!.provider!;
  const fn = opts.contract.getFunction(opts.method);
  console.log(`\n[${opts.spike}] ${opts.what}`);
  console.log(`  call: ${opts.method}(${opts.args.map((a) => JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).join(", ").slice(0, 300)})`);
  console.log(`  from: ${opts.from}`);
  console.log(`  to: ${String(opts.contract.target)}`);
  let gasLimit: bigint;
  let gasEstimate: bigint;
  try {
    const result = await fn.staticCall(...opts.args, { from: opts.from });
    if (opts.showResult) console.log(`  result: ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    const gas = await fn.estimateGas(...opts.args, { from: opts.from });
    gasEstimate = gas;
    gasLimit = (gas * GAS_BUFFER_PCT) / 100n;
    const price = await gasPriceWei(p);
    console.log(`  simulation: OK, gas ≈ ${gas}, cost ≈ ${formatUnits(gas * price, 18)} HBAR (at ${formatUnits(price, 9)} gwei-equivalent); gas limit ${gasLimit}`);
    if (opts.expectRevert) console.log("  ⚠ expected a revert but the simulation succeeded — report this.");
  } catch (err) {
    console.log(`  simulation: REVERT → ${explain(err)}`);
    if (!opts.expectRevert) console.log("  ✖ unexpected revert; do not execute this step.");
    return {};
  }
  if (opts.expectRevert || opts.simulateOnly || !EXECUTE) {
    if (!opts.expectRevert && !opts.simulateOnly) console.log("  (dry run — nothing sent; rerun with EXECUTE=1 after the owner's OK)");
    return { gasEstimate };
  }
  const signer = await signerFor(opts.signerNetwork ?? "flhDeployer");
  let tx;
  try {
    tx = await (opts.contract.connect(signer) as Contract).getFunction(opts.method)(...opts.args, { gasLimit });
  } catch (err) {
    recordRejected(opts.spike, opts.what, err, { from: opts.from, to: String(opts.contract.target), gasEstimate: gasEstimate.toString(), gasLimit: gasLimit.toString() });
    throw err;
  }
  console.log(`  sent: ${tx.hash}`);
  try {
    const receipt = await tx.wait();
    console.log(`  status: SUCCESS  gasUsed: ${receipt?.gasUsed}`);
    const extra = opts.evidence ? await opts.evidence(tx.hash) : {};
    record(opts.spike, opts.what, tx.hash, { status: "SUCCESS", from: opts.from, to: String(opts.contract.target), gasEstimate: gasEstimate.toString(), gasLimit: gasLimit.toString(), gasUsed: receipt?.gasUsed?.toString(), ...extra });
    return { hash: tx.hash, receipt, gasEstimate };
  } catch (err) {
    // A mined-but-reverted tx still costs fees: log it as evidence, then stop the script.
    console.log(`  status: FAILED → ${explain(err)}`);
    const extra = opts.evidence ? await opts.evidence(tx.hash).catch(() => ({})) : {};
    record(opts.spike, `FAILED: ${opts.what}`, tx.hash, { status: "FAILED", error: explain(err), from: opts.from, to: String(opts.contract.target), gasEstimate: gasEstimate.toString(), gasLimit: gasLimit.toString(), ...extra });
    throw err;
  }
}

/** Same ISIN check as ATS contracts/factory/isinValidator.sol (Luhn over letter→number expansion). */
export function isinChecksum(body11: string): number {
  const digits = body11
    .toUpperCase()
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // Double every second digit counted from the right end of the expanded string.
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) d *= 2;
    sum += d > 9 ? Math.floor(d / 10) + (d % 10) : d;
  }
  return (10 - (sum % 10)) % 10;
}
export function makeIsin(country: string, nsin9: string): string {
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{9}$/.test(nsin9)) throw new Error("bad ISIN parts");
  const body = country + nsin9;
  return body + isinChecksum(body);
}

export function bond(p: Provider): Contract {
  return new Contract(need("bond"), BOND_ABI, p);
}
