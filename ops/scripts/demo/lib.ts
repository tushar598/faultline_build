// Shared bits for the Faultline FULL TESTNET DEMO (faultline HANDOVER §10 step 9): one deployment of the D17 build that
// carries Flow A (a SYNTHETIC event: oracle attests, trustee pauses and vetoes, admin unpauses, the same signature is
// rejected) and Flow B (the real Bhuj record usp000a8ds fetched live from USGS by the oracle, executed by its keeper).
//
// Same safety model as the smoke run (scripts/smoke/lib.ts, scripts/lib/common.ts): dry run by default, real
// transactions only with EXECUTE=1 run by the owner, keys only from the Hardhat keystore, never printed or written.
// The oracle runs as the REAL main-repo CLI (oracle/src) in a child process; its two keys are handed to it in memory as
// environment variables of that child only (runOracle). State: out/demo-state.json; oracle config, terms and ledger:
// out/demo/ (public data only). Evidence: out/evidence.jsonl, phases "demo-N".
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Transaction as EthTx, type Contract } from "ethers";
import { ROOT, privateKeyFor, record, rpcUrl, signerFor } from "../lib/common.js";
import { mirror } from "../lib/hedera.js";
import { ACCOUNTS, BHUJ_ID, FAULTLINE, USD, bhujFixture, configureRun, feeOf, loadSmoke, provider, requireShared, sharedTs, type Role, type UsgsFeature } from "../smoke/lib.js";

configureRun({ stateFile: "demo-state.json", payingRoles: ["deployer", "trustee", "trusteeBackup", "sponsor", "investorA", "investorB", "relayer"] });

export * from "../smoke/lib.js";
export const loadDemo = loadSmoke;

// ---------------------------------------------------------------- owner decisions for this step (2026-10-27)

/** fUSD from this repo's smoke run (smoke-1, 2026-11-05; deployer = treasury + admin/supply/KYC key; docs/DEPLOYMENTS.md);
 *  reused, no new token. */
export const FUSD: { readonly id: string; readonly evm: string } = { id: "0.0.11329874", evm: "0x0000000000000000000000000000000000aCe152" };
/** Investments (within the fUSD the smoke run leaves: about A 580, B 720) and the coupon reserve the sponsor funds. */
export const TICKET = { investorA: USD(300n), investorB: USD(200n) } as const;
export const TOTAL_UNITS = TICKET.investorA + TICKET.investorB;
export const RESERVE = USD(1n);
/** Bhuj and the synthetic Flow A event are 7.7 and 7.5 on the 7.0 → 8.0 curve. */
export const LOSS = { bhuj: 7000n, synthetic: 5000n } as const;

export const BOND = { name: "Faultline Demo Bond", symbol: "FLDMO", info: "Faultline full testnet demo (testnet only)", maturityMin: Number(process.env.BOND_MATURITY_MIN ?? "45") };
export const TOPIC_MEMO = "faultline-demo-testnet";

// Testnet demo profile (ARCHITECTURE §12.1, demo-only): 120 s window (owner 2026-10-27; the smoke run used 60 s),
// 13 min issuance, >= 20 min risk, 3 min grace. Production stays 48–72 h.
export const MIN = 60;
export const P = {
  issuanceStartDelay: 2 * MIN,
  issuance: 13 * MIN,
  riskMin: 20 * MIN,
  riskMax: 95 * MIN,
  grace: 3 * MIN,
  margin: 60,
  bhujAfterRiskStart: 60,
  challengeWindow: 120n,
  couponBps: 600n,
  cap: 10_000_000_000n, // 10,000 USD
  minTicket: 100_000_000n, // 100 USD
};

/** Flow A's SYNTHETIC record (main repo oracle/fixtures; time = Bhuj + 60 s). Never presented as real. */
export const SYNTHETIC_FIXTURE = "synthetic-kutch-testnet-a.geojson";
export const SYNTHETIC_ID = "synthetic-kutch-testnet-a";
export function syntheticFixture(): UsgsFeature {
  const f = JSON.parse(fs.readFileSync(path.join(FAULTLINE, "oracle", "fixtures", SYNTHETIC_FIXTURE), "utf8")) as UsgsFeature & { synthetic?: string };
  if (f.id !== SYNTHETIC_ID || !f.synthetic || !/SYNTHETIC/.test(String((f.properties as { title?: unknown }).title ?? ""))) throw new Error(`${SYNTHETIC_FIXTURE} is not labelled SYNTHETIC`);
  return f;
}
export { BHUJ_ID, bhujFixture };

// ---------------------------------------------------------------- schedule + terms

export type Schedule = { issuanceStart: number; issuanceEnd: number; riskStart: number; maturity: number; grace: number };

/** The pool schedule for a pool deployed at block time `t` on a bond with these dates (rule: smoke-2-bond.ts). */
export function scheduleFor(t: number, bondStart: number, bondMaturity: number): { s: Schedule; problems: string[] } {
  const issuanceStart = t + P.issuanceStartDelay;
  const issuanceEnd = issuanceStart + P.issuance;
  const riskStart = issuanceEnd;
  const maturity = Math.max(riskStart + P.riskMin, bondMaturity - P.grace + P.margin);
  const s = { issuanceStart, issuanceEnd, riskStart, maturity, grace: P.grace };
  const problems: string[] = [];
  if (bondStart > issuanceStart) problems.push(`bond startingDate ${bondStart} is after issuanceStart ${issuanceStart}`);
  if (bondMaturity < issuanceEnd + P.margin) problems.push(`bond maturity ${bondMaturity} is before issuanceEnd + 60 s (${issuanceEnd + P.margin}): phase 2 started too late, a new bond is needed`);
  if (bondMaturity > maturity + P.grace - P.margin) problems.push("internal: bond maturity after pool maturity + grace - 60 s");
  if (maturity - riskStart > P.riskMax) problems.push(`risk period would be ${(maturity - riskStart) / MIN} min (> ${P.riskMax / MIN}): bond maturity too far ahead`);
  return { s, problems };
}

/** Replay terms that put Bhuj at riskStart + 60 s (so the synthetic record, Bhuj + 60 s, lands at riskStart + 120 s). */
export function termsFor(s: Schedule, chainId: bigint) {
  const shared = sharedTs();
  const bhujSec = Math.floor(bhujFixture().properties.time / 1000);
  const offset = s.riskStart + P.bhujAfterRiskStart - bhujSec;
  const terms = shared.kutchTerms("replay", offset);
  shared.assertReplayAllowed(terms, chainId); // D14
  return {
    terms,
    offset,
    termsHash: shared.termsHash(terms),
    observedAt: { bhuj: Number(shared.observedAtOf(bhujFixture(), terms)), synthetic: Number(shared.observedAtOf(syntheticFixture(), terms)) },
  };
}

export const iso = (s: number) => new Date(s * 1000).toISOString().slice(11, 19) + "Z";

/** The demo timeline for a pool deployed at `t`: every boundary, and which phase must run when. */
export function printTimeline(t: number, s: Schedule, observedAt: { bhuj: number; synthetic: number }, bond?: { start: number; maturity: number }) {
  const rel = (x: number) => `t${x >= t ? "+" : "-"}${(Math.abs(x - t) / MIN).toFixed(1).padStart(4)} min`;
  const rows: [number, string][] = [
    [t, "phase 2: pool deployed (the schedule clock starts here); trigger, initialize, KYC, roles, backup trustee follow"],
    [s.issuanceStart, "issuanceStart: phase 3 (subscribe) may run from here"],
    [s.issuanceEnd, "issuanceEnd = riskStart: phase 3 must be finished before this (it refuses with < 3 min left)"],
    [observedAt.bhuj, "Bhuj usp000a8ds replayed observedAt (Flow B can be attested from here)"],
    [observedAt.synthetic, "SYNTHETIC record observedAt: phase 4 (Flow A) runs from here, then phase 5 (Flow B)"],
    [s.maturity, "pool maturity: last observedAt the trigger accepts"],
    [s.maturity + s.grace, "submissionDeadline (moves later by every paused second): last submit; phase 6 (settle) after it"],
  ];
  if (bond) rows.push([bond.start, "bond startingDate"], [bond.maturity, "bond maturityDate (<= maturity + grace - 60 s)"]);
  for (const [x, what] of rows.sort((a, b) => a[0] - b[0])) console.log(`  ${iso(x)}  ${rel(x)}  ${what}`);
  console.log(`  risk period ${((s.maturity - s.riskStart) / MIN).toFixed(1)} min, grace ${s.grace / MIN} min, challenge window ${P.challengeWindow} s`);
}

// ---------------------------------------------------------------- the oracle (real main-repo CLI, child process)

export const DEMO_DIR = path.join(ROOT, "out", "demo");
export const ORACLE_CONFIG = path.join(DEMO_DIR, "oracle.testnet.json");
export const ORACLE_STATE_DIR = path.join(DEMO_DIR, "oracle-state");

/** Writes the oracle's testnet config and the bond's terms file (public data). */
export function writeOracleConfig(args: { trigger: string; topicId: string; terms: unknown; fromBlock: number }): void {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEMO_DIR, "terms.json"), JSON.stringify(args.terms, null, 2) + "\n");
  const cfg = {
    rpcUrl: rpcUrl(), // overridden per run with ORACLE_RPC_URL = the relay this process chose
    chainId: 296,
    trigger: args.trigger,
    termsFile: "terms.json",
    hcs: { mode: "real", topicId: args.topicId, network: "testnet", payerAccountId: ACCOUNTS.relayer.id },
    pollIntervalSec: 60,
    pendingPollSec: 10,
    attestationTtlSec: 3600,
    stateDir: "oracle-state",
    // eth_getLogs ranges are limited (Hashio 7 days, thirdweb 1000 blocks): the keeper scans from the trigger deploy.
    fromBlock: args.fromBlock,
    // The relay, as in the smoke run and S7 (owner 2026-10-27: the oracle's "hedera-sdk" transport is not
    // testnet-verified and stays off for the demo).
    evm: { transport: "relay" },
  };
  fs.writeFileSync(ORACLE_CONFIG, JSON.stringify(cfg, null, 2) + "\n");
}

export type OracleKeys = { oracle?: string; relayer?: string };
/** The oracle signer and/or relayer keys from the keystore, checked against their addresses. EXECUTE only. The
 *  keeper needs only the relayer (it executes; it signs nothing). */
export async function oracleKeys(which: { oracle: boolean; relayer: boolean } = { oracle: true, relayer: true }): Promise<OracleKeys> {
  return {
    ...(which.oracle ? { oracle: await privateKeyFor("flhOracle", ACCOUNTS.oracle.evm) } : {}),
    ...(which.relayer ? { relayer: await privateKeyFor("flhRelayer", ACCOUNTS.relayer.evm) } : {}),
  };
}

/**
 * Runs `npx tsx src/cli.ts <args> --config out/demo/oracle.testnet.json` in faultline/oracle with ORACLE_RPC_URL = the
 * relay this process uses. With `keys`, ORACLE_PRIVATE_KEY / RELAYER_PRIVATE_KEY are set in the CHILD's environment
 * only (never in a file, never printed); without, both are removed from the child's environment. Output is streamed
 * and returned.
 */
export async function runOracle(args: string[], keys?: OracleKeys, onOutput?: (all: string) => void): Promise<{ code: number; out: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ORACLE_RPC_URL: rpcUrl() };
  delete env.ORACLE_PRIVATE_KEY;
  delete env.RELAYER_PRIVATE_KEY;
  delete env.HARDHAT_ACCOUNT_ORACLE;
  delete env.HARDHAT_ACCOUNT_RELAYER;
  if (keys?.oracle) env.ORACLE_PRIVATE_KEY = keys.oracle;
  if (keys?.relayer) env.RELAYER_PRIVATE_KEY = keys.relayer;
  const held = [keys?.oracle && "oracle", keys?.relayer && "relayer"].filter(Boolean);
  const full = ["tsx", "src/cli.ts", ...args, "--config", ORACLE_CONFIG];
  console.log(`\n  oracle$ npx ${full.join(" ")}   (${held.length ? `${held.join(" + ")} key(s) in the child's environment only` : "no keys"})`);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", full, { cwd: path.join(FAULTLINE, "oracle"), env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const tee = (buf: Buffer, to: NodeJS.WriteStream) => {
      const s = buf.toString();
      out += s;
      to.write(s.replace(/^/gm, "  │ "));
      onOutput?.(out);
    };
    child.stdout.on("data", (b: Buffer) => tee(b, process.stdout));
    child.stderr.on("data", (b: Buffer) => tee(b, process.stderr));
    child.on("error", reject);
    child.on("close", (code) => {
      if (out && !out.endsWith("\n")) process.stdout.write("\n");
      resolve({ code: code ?? 1, out });
    });
  });
}

type LedgerPublication = { nonce: number; att: Record<string, string>; signature: string; hcs?: { topicId: string; sequenceNumber: string }; tx?: { hash: string; status: string } };
type LedgerEntry = { eventId: string; lastPreferredId: string; chainStatus: string; publications: LedgerPublication[] };
/** The oracle's D8 ledger entry for `eventId` (public data: attestation, signature, HCS ref, tx hash). */
export function ledgerEntry(trigger: string, eventId: string): LedgerEntry | undefined {
  const file = path.join(ORACLE_STATE_DIR, `ledger-296-${trigger.toLowerCase()}.json`);
  if (!fs.existsSync(file)) return undefined;
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { events: Record<string, LedgerEntry> }).events[eventId];
}

// ---------------------------------------------------------------- HCS read-back (mirror node)

type HcsMsg = typeof import("../../../shared/ts/hcsMessage.js");
export const hcsMessage = () => requireShared<HcsMsg>("hcsMessage");

/**
 * Reads HCS message `seq` of `topicId` from the mirror node (polls while it catches up) and checks: the bytes equal
 * utf8(JCS(message rebuilt from the ledger)), the payer is the relayer, the in-payload signature recovers to the
 * oracle, and the message names `usgsId`. Returns the checks and the consensus timestamp.
 */
export async function verifyHcsAttestation(args: { topicId: string; seq: string; trigger: string; terms: unknown; publication: LedgerPublication; usgsId: string }) {
  const h = hcsMessage();
  type MirrorMsg = { message: string; payer_account_id: string; consensus_timestamp: string; sequence_number: number; chunk_info: { number: number; total: number } | null };
  let m: MirrorMsg | undefined;
  for (let i = 0; i < 12 && !m; i++) {
    m = await mirror<MirrorMsg>(`/api/v1/topics/${args.topicId}/messages/${args.seq}`);
    if (!m) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!m) throw new Error(`HCS ${args.topicId} seq ${args.seq} not on the mirror node after ~30 s`);
  const bytes = Buffer.from(m.message, "base64");
  const a = args.publication.att;
  const att = { eventId: a.eventId, lossBps: BigInt(a.lossBps), magnitudeX100: BigInt(a.magnitudeX100), observedAt: BigInt(a.observedAt), usgsUpdatedAt: BigInt(a.usgsUpdatedAt), nonce: BigInt(a.nonce), termsHash: a.termsHash, dataHash: a.dataHash, deadline: BigInt(a.deadline) };
  const expected = h.encodeMessage(h.attestationMessage({ chainId: 296n, trigger: args.trigger, terms: args.terms as never, att, signature: args.publication.signature, usgsId: args.usgsId }));
  const decoded = h.decodeMessage(bytes);
  const checks: [string, boolean][] = [
    [`HCS bytes (${bytes.length}) == utf8(JCS(message rebuilt from the oracle ledger))`, Buffer.compare(bytes, Buffer.from(expected)) === 0],
    [`payer_account_id ${m.payer_account_id} == relayer ${ACCOUNTS.relayer.id}`, m.payer_account_id === ACCOUNTS.relayer.id],
    [`in-payload EIP-712 signature recovers to the oracle ${ACCOUNTS.oracle.evm}`, h.verifyMessageSigner(decoded, ACCOUNTS.oracle.evm)],
    [`message usgsId == ${args.usgsId}`, decoded.kind === "faultline.attestation" && decoded.usgsId === args.usgsId],
    ["one chunk", !m.chunk_info || m.chunk_info.total === 1],
  ];
  return { checks, consensusTimestamp: m.consensus_timestamp, bytes: bytes.length };
}

/** Prints ✓/✖ lines; returns true when all passed. */
export function report(title: string, checks: [string, boolean][]): boolean {
  console.log(`\n${title}:`);
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  return checks.every(([, ok]) => ok);
}

// ---------------------------------------------------------------- presigned EVM transactions (relay)

/** A signed EVM transaction, ready to broadcast (Flow A's pause is signed BEFORE the oracle runs). */
export type Presigned = { role: Role; what: string; raw: string; hash: string; nonce: number; gasLimit: bigint };

/**
 * Signs `method(args)` on `contract` as `role`: nonce and gas price from the relay (read before anything time-critical),
 * fee cap = gas price × 1.2, the given gas limit. EXECUTE only; the key stays in memory.
 */
export async function presignEvm(role: Role, what: string, contract: Contract, method: string, args: unknown[], gasLimit: bigint): Promise<Presigned> {
  const p = await provider();
  const nonce = await p.getTransactionCount(ACCOUNTS[role].evm, "latest");
  const price = (await p.getFeeData()).gasPrice;
  if (!price) throw new Error("the RPC returned no gas price");
  const wallet = await signerFor(ACCOUNTS[role].network);
  const raw = await wallet.signTransaction({ type: 2, chainId: 296n, nonce, to: await contract.getAddress(), data: contract.interface.encodeFunctionData(method, args), value: 0n, gasLimit, maxFeePerGas: (price * 12n) / 10n, maxPriorityFeePerGas: 0n });
  return { role, what, raw, hash: EthTx.from(raw).hash!, nonce, gasLimit };
}

/** Sends a presigned transaction through the relay (eth_sendRawTransaction) at once: no read before it. Returns the hash. */
export async function broadcastPresigned(phase: string, t: Presigned): Promise<string> {
  const sentAt = Date.now();
  const r = await (await provider()).broadcastTransaction(t.raw);
  console.log(`\n[${phase}] ${t.what}\n  sent through the relay ${((Date.now() - sentAt) / 1000).toFixed(1)} s after the call: ${r.hash} (nonce ${t.nonce}, gas limit ${t.gasLimit})`);
  return r.hash;
}

/** Waits for a broadcast transaction's receipt (relay, mirror-backed) and records evidence. Throws unless it succeeded. */
export async function settlePresigned(phase: string, t: Presigned): Promise<{ gasUsed?: string; blockTimestamp?: number }> {
  const p = await provider();
  const rcpt = await p.waitForTransaction(t.hash, 1, 120_000);
  const ok = rcpt?.status === 1;
  const block = rcpt ? await p.getBlock(rcpt.blockNumber) : null;
  console.log(`  status: ${ok ? "SUCCESS" : "FAILED"}  gasUsed: ${rcpt?.gasUsed}`);
  record(phase, ok ? t.what : `FAILED: ${t.what}`, t.hash, { status: ok ? "SUCCESS" : "FAILED", via: "presigned, eth_sendRawTransaction", from: ACCOUNTS[t.role].evm, gasLimit: t.gasLimit.toString(), gasUsed: rcpt?.gasUsed?.toString(), ...(await feeOf(t.hash)) });
  if (!ok) throw new Error(`${t.what}: ${rcpt ? "reverted" : "no receipt after 120 s"} — stopped`);
  return { gasUsed: rcpt?.gasUsed?.toString(), blockTimestamp: block?.timestamp };
}
