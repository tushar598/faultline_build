// Event history of one bond: pool, trigger and bond (Transfer) logs, decoded with the dashboard ABIs. Locally from
// eth_getLogs; on testnet from the mirror node REST API (Hashio limits eth_getLogs ranges, LESSONS step 9 risks).
import { getAddress, type Interface, type JsonRpcProvider, type Log } from "ethers";
import type { NetworkConfig } from "@/config/networks";
import { ERC20_IFACE, POOL_IFACE, TRIGGER_IFACE } from "./abi";
import { consensusSeconds } from "./format";
import type { LogEntry } from "./types";

type Addresses = { pool: string; trigger: string; bond: string };
type RawLog = { address: string; topics: readonly string[]; data: string; blockNumber: number; txHash: string; logIndex: number; timestamp: number | null };

function decode(raw: RawLog, a: Addresses): LogEntry | null {
  const addr = getAddress(raw.address);
  const [contract, iface]: [LogEntry["contract"], Interface] | [null, null] =
    addr === a.pool ? ["pool", POOL_IFACE] : addr === a.trigger ? ["trigger", TRIGGER_IFACE] : addr === a.bond ? ["bond", ERC20_IFACE] : [null, null];
  if (!contract) return null;
  try {
    const parsed = iface.parseLog({ topics: [...raw.topics], data: raw.data });
    if (!parsed) return null;
    const args: Record<string, unknown> = {};
    parsed.fragment.inputs.forEach((input, i) => (args[input.name] = parsed.args[i]));
    return { contract, name: parsed.name, args, blockNumber: raw.blockNumber, txHash: raw.txHash, logIndex: raw.logIndex, timestamp: raw.timestamp };
  } catch {
    return null; // an event this dashboard does not know (the ATS diamond emits many)
  }
}

async function rpcLogs(p: JsonRpcProvider, a: Addresses, fromBlock: number): Promise<RawLog[]> {
  const logs: Log[] = await p.getLogs({ address: [a.pool, a.trigger, a.bond], fromBlock, toBlock: "latest" });
  const times = new Map<number, number>();
  await Promise.all(
    [...new Set(logs.map((l) => l.blockNumber))].map(async (b) => {
      const block = await p.getBlock(b);
      if (block) times.set(b, block.timestamp);
    }),
  );
  return logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, txHash: l.transactionHash, logIndex: l.index, timestamp: times.get(l.blockNumber) ?? null }));
}

type MirrorLog = { address: string; topics: string[]; data: string; block_number: number; transaction_hash: string; index: number; timestamp: string };

async function mirrorLogs(mirrorUrl: string, a: Addresses, signal?: AbortSignal): Promise<RawLog[]> {
  const out: RawLog[] = [];
  for (const address of [a.pool, a.trigger, a.bond]) {
    let next: string | null = `/api/v1/contracts/${address}/results/logs?order=asc&limit=100`;
    for (let page = 0; next && page < 20; page++) {
      const res = await fetch(`${mirrorUrl}${next}`, { signal });
      if (!res.ok) throw new Error(`Mirror node logs for ${address}: HTTP ${res.status}`);
      const body = (await res.json()) as { logs: MirrorLog[]; links?: { next?: string | null } };
      for (const l of body.logs) {
        out.push({ address: l.address, topics: l.topics, data: l.data === "0x" || !l.data ? "0x" : l.data, blockNumber: l.block_number, txHash: l.transaction_hash, logIndex: l.index, timestamp: consensusSeconds(l.timestamp) });
      }
      next = body.links?.next ?? null;
    }
  }
  return out;
}

export async function readLogs(net: NetworkConfig, p: JsonRpcProvider, a: Addresses, signal?: AbortSignal): Promise<LogEntry[]> {
  const raw = net.logs.mode === "rpc" ? await rpcLogs(p, a, net.logs.fromBlock) : await mirrorLogs(net.logs.mirrorUrl, a, signal);
  return raw
    .map((r) => decode(r, a))
    .filter((e): e is LogEntry => e !== null)
    .sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
}

/** Event ids the trigger has seen, in first-seen order. */
export function eventIdsOf(logs: LogEntry[]): string[] {
  return [...new Set(logs.filter((l) => l.name === "AttestationSubmitted").map((l) => String(l.args.eventId)))];
}

/** Every address that ever received bond units: investors and transfer recipients. */
export function holdersOf(logs: LogEntry[]): string[] {
  const set = new Set<string>();
  for (const l of logs) {
    if (l.name === "Invested") set.add(getAddress(String(l.args.investor)));
    if (l.contract === "bond" && l.name === "Transfer") {
      const to = getAddress(String(l.args.to));
      if (to !== "0x0000000000000000000000000000000000000000") set.add(to);
    }
  }
  return [...set];
}
