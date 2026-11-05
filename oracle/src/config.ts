// Oracle configuration: a JSON file (path from --config or ORACLE_CONFIG) validated with zod, plus env overrides
// (ORACLE_RPC_URL). Relative paths in the file are resolved against the file's directory. The terms file
// (oracle/terms/<bond>.json) holds the canonical trigger terms; its termsHash must equal the trigger's immutable.
//
// checkStartup() is the refusal gate every command runs before it signs or sends anything: chainId, termsHash and the
// EIP-712 type hash must match the chain, and replay terms are allowed only on chainIds 31337 / 296 (D14).
import fs from "node:fs";
import path from "node:path";
import { TypedDataEncoder, getAddress, id as keccakUtf8, isAddress } from "ethers";
import { z } from "zod";
import spec from "../../shared/attestation.eip712.json" with { type: "json" };
import { assertReplayAllowed, termsHash, type Terms } from "../../shared/ts/attestation.js";

const address = z.string().refine(isAddress, "not an EVM address").transform((a) => getAddress(a));

export const TermsSchema = z
  .object({
    version: z.literal(1),
    box: z.object({ minLat: z.number(), maxLat: z.number(), minLon: z.number(), maxLon: z.number() }).strict(),
    maxDepthKm: z.number().positive(),
    magTypes: z.array(z.string().min(1)).min(1),
    floorMagX100: z.number().int().nonnegative(),
    ceilMagX100: z.number().int().positive(),
    coolingPeriodSec: z.number().int().nonnegative(),
    aggregation: z.literal("sum-capped-10000"),
    mode: z.enum(["live", "replay"]),
    timeOffsetSec: z.number().int().refine(Number.isSafeInteger),
    source: z.literal("USGS ComCat"),
  })
  .strict()
  .refine((t) => t.ceilMagX100 > t.floorMagX100, "ceilMagX100 must be above floorMagX100")
  .refine((t) => t.mode === "replay" || t.timeOffsetSec === 0, "live terms must have timeOffsetSec 0");

const HcsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("mock"), topicId: z.string().min(1), mockDir: z.string().default(".hcs-mock") }).strict(),
  z
    .object({
      mode: z.literal("real"),
      topicId: z.string().regex(/^0\.0\.\d+$/, "topic id must look like 0.0.N"),
      network: z.enum(["testnet", "mainnet"]),
      /** Relayer's Hedera account id: pays HCS fees (D16). */
      payerAccountId: z.string().regex(/^0\.0\.\d+$/),
    })
    .strict(),
]);

/** How the relayer's EVM transactions (submit, execute) are sent: through the JSON-RPC relay (default, testnet-verified),
 *  or straight to the Hedera consensus nodes with the SDK (src/hederaEvm.ts; mock-tested only, NOT testnet-verified, not
 *  used in the testnet demo — owner decision 2026-10-27). */
const EvmSchema = z.discriminatedUnion("transport", [
  z.object({ transport: z.literal("relay") }).strict(),
  z
    .object({
      transport: z.literal("hedera-sdk"),
      network: z.enum(["testnet", "mainnet"]),
      /** The relayer's Hedera account id: pays the EthereumTransaction (D16). */
      payerAccountId: z.string().regex(/^0\.0\.\d+$/),
    })
    .strict(),
]);

export const ConfigSchema = z
  .object({
    rpcUrl: z.string().url(),
    chainId: z.number().int().positive(),
    trigger: address,
    termsFile: z.string().min(1),
    hcs: HcsSchema,
    evm: EvmSchema.default({ transport: "relay" }),
    pollIntervalSec: z.number().int().positive().default(60),
    /** D15: how often a PENDING event's USGS record is re-checked during its challenge window. */
    pendingPollSec: z.number().int().positive().default(10),
    /** Signed as the attestation `deadline` = chain time + ttl. */
    attestationTtlSec: z.number().int().positive().default(3600),
    stateDir: z.string().min(1),
    /** First block the keeper scans for AttestationSubmitted logs. */
    fromBlock: z.number().int().nonnegative().default(0),
    usgs: z
      .object({
        baseUrl: z.string().url().default("https://earthquake.usgs.gov/fdsnws/event/1/query"),
        timeoutMs: z.number().int().positive().default(20_000),
        retries: z.number().int().nonnegative().default(3),
      })
      .strict()
      .default({ baseUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query", timeoutMs: 20_000, retries: 3 }),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema> & { configDir: string; terms: Terms; termsHash: string };

/** Reads and validates the config and its terms file. Throws with every zod issue listed. */
export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): Config {
  const abs = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
  if (env.ORACLE_RPC_URL) raw.rpcUrl = env.ORACLE_RPC_URL;
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid config ${abs}:\n${z.prettifyError(parsed.error)}`);
  const configDir = path.dirname(abs);
  const terms = parseTerms(JSON.parse(fs.readFileSync(path.resolve(configDir, parsed.data.termsFile), "utf8")));
  return { ...parsed.data, configDir, terms, termsHash: termsHash(terms) };
}

export function parseTerms(json: unknown): Terms {
  const t = TermsSchema.safeParse(json);
  if (!t.success) throw new Error(`invalid terms file:\n${z.prettifyError(t.error)}`);
  return t.data as Terms;
}

/** Absolute path of a config-relative path. */
export const resolveIn = (cfg: Pick<Config, "configDir">, p: string) => path.resolve(cfg.configDir, p);

/** keccak256 of the EIP-712 type string built from shared/attestation.eip712.json (must equal the trigger's constant). */
export function expectedTypehash(): string {
  return keccakUtf8(TypedDataEncoder.from({ Attestation: spec.types.Attestation }).encodeType("Attestation"));
}

/** What the chain reports, read once at startup. */
export type ChainFacts = { chainId: bigint; termsHash: string; typehash: string; oracle: string; hasCode: boolean };

/**
 * Refuses (throws) unless the chain and the files agree. Pure, so every refusal path is unit-tested.
 * `signer` is the oracle signer's address when the command signs; it must be the trigger's current oracle.
 */
export function checkStartup(cfg: Pick<Config, "chainId" | "trigger" | "terms" | "termsHash"> & { evm?: Config["evm"] }, chain: ChainFacts, signer?: string): void {
  const problems: string[] = [];
  if (cfg.evm?.transport === "hedera-sdk") {
    const want = cfg.evm.network === "mainnet" ? 295n : 296n;
    if (chain.chainId !== want) problems.push(`evm.transport hedera-sdk on ${cfg.evm.network} needs chainId ${want}, the RPC reports ${chain.chainId}`);
  }
  if (chain.chainId !== BigInt(cfg.chainId)) problems.push(`chainId: RPC reports ${chain.chainId}, config says ${cfg.chainId}`);
  if (!chain.hasCode) problems.push(`no contract code at trigger ${cfg.trigger}`);
  else {
    if (chain.termsHash.toLowerCase() !== cfg.termsHash.toLowerCase()) problems.push(`termsHash: trigger has ${chain.termsHash}, terms file hashes to ${cfg.termsHash}`);
    if (chain.typehash.toLowerCase() !== expectedTypehash().toLowerCase()) problems.push(`ATTESTATION_TYPEHASH: trigger has ${chain.typehash}, shared/attestation.eip712.json gives ${expectedTypehash()}`);
    if (signer && chain.oracle.toLowerCase() !== signer.toLowerCase()) problems.push(`oracle key ${signer} is not the trigger's oracle ${chain.oracle}`);
  }
  try {
    assertReplayAllowed(cfg.terms, chain.chainId);
  } catch (e) {
    problems.push((e as Error).message);
  }
  if (problems.length) throw new Error(`refusing to run:\n  - ${problems.join("\n  - ")}`);
}
