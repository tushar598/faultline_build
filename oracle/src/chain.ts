// Chain access for the oracle and the keeper: the trigger contract (subset ABI), startup facts for the refusal gate,
// custom-error decoding, chain time and explorer links.
import { Contract, Interface, JsonRpcProvider, type Provider } from "ethers";
import { POOL_ABI, STATUS, TRIGGER_ABI } from "./abi.js";
import type { ChainFacts } from "./config.js";
import type { ChainRecord } from "./decision.js";

export const TRIGGER_IFACE = new Interface(TRIGGER_ABI);

export function provider(rpcUrl: string, chainId: number): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
}
export const triggerAt = (address: string, runner: Provider | { provider: Provider | null }) => new Contract(address, TRIGGER_ABI, runner as never);
export const poolAt = (address: string, p: Provider) => new Contract(address, POOL_ABI, p);

export async function chainFacts(p: Provider, trigger: string): Promise<ChainFacts> {
  const chainId = (await p.getNetwork()).chainId;
  const hasCode = (await p.getCode(trigger)) !== "0x";
  if (!hasCode) return { chainId, hasCode, termsHash: "", typehash: "", oracle: "" };
  const t = triggerAt(trigger, p);
  const [termsHash, typehash, oracle] = await Promise.all([t.getFunction("termsHash")(), t.getFunction("ATTESTATION_TYPEHASH")(), t.getFunction("oracle")()]);
  return { chainId, hasCode, termsHash, typehash, oracle };
}

/** Latest block time: the oracle's clock for the rule and the deadline (local chains may be time-travelled). */
export async function chainTime(p: Provider): Promise<number> {
  return Number((await p.getBlock("latest"))!.timestamp);
}

export async function eventRecord(t: Contract, eventId: string): Promise<ChainRecord & { windowStart: number; dataHash: string }> {
  const r = await t.getFunction("getEventRecord")(eventId);
  return {
    status: STATUS[Number(r.status)]!,
    nonce: Number(r.nonce),
    lossBps: Number(r.lossBps),
    magnitudeX100: Number(r.magnitudeX100),
    observedAt: Number(r.observedAt),
    usgsUpdatedAt: Number(r.usgsUpdatedAt),
    windowStart: Number(r.windowStart),
    dataHash: r.dataHash,
  };
}

export type DecodedError = { name: string; args: string[] } | { name: "unknown"; message: string };

/** Finds revert data anywhere in an ethers / JSON-RPC error and decodes it with the trigger ABI. */
export function decodeRevert(err: unknown, iface: Interface = TRIGGER_IFACE): DecodedError {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): string | undefined => {
    if (!x || typeof x !== "object" || seen.has(x) || depth > 6) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if (typeof o.data === "string" && /^0x[0-9a-fA-F]{8}/.test(o.data)) return o.data;
    for (const k of ["data", "error", "info", "cause", "parent", "value"]) {
      const f = walk(o[k], depth + 1);
      if (f) return f;
    }
    return undefined;
  };
  const msg = String((err as { message?: string })?.message ?? err);
  const data = walk(err, 0) ?? /return data: (0x[0-9a-fA-F]+)/.exec(msg)?.[1];
  if (data) {
    try {
      const e = iface.parseError(data);
      if (e) return { name: e.name, args: e.args.map((a) => String(a)) };
    } catch {
      /* fall through */
    }
  }
  const named = /custom error '(\w+)\(/.exec(msg);
  if (named) return { name: named[1]!, args: [] };
  return { name: "unknown", message: (err as { shortMessage?: string })?.shortMessage ?? msg.slice(0, 300) };
}

export const errorText = (d: DecodedError) => ("message" in d ? `unknown error: ${d.message}` : `${d.name}(${d.args.join(", ")})`);

/** HashScan link on Hedera; none on a local chain. */
export function txLink(chainId: bigint | number, hash: string): string | undefined {
  const c = BigInt(chainId);
  if (c === 296n) return `https://hashscan.io/testnet/transaction/${hash}`;
  if (c === 295n) return `https://hashscan.io/mainnet/transaction/${hash}`;
  return undefined;
}
export const linkText = (chainId: bigint | number, hash: string) => txLink(chainId, hash) ?? "(local chain, no explorer)";
