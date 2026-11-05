// The HCS attestation log (ARCHITECTURE §6.5): the local file mock through /api/local/hcs, or the mirror node on
// testnet. Every message is decoded with shared/ts and its in-payload signature is checked against trigger.oracle()
// (D16). The trigger, not HCS, is the source of truth; HCS is the public, ordered audit trail.
import type { NetworkConfig } from "@/config/networks";
import { decodeMessage, verifyMessageSigner } from "./shared";
import type { HcsEntry } from "./types";

type RawMessage = { sequenceNumber: number; consensusTimestamp: string; payer: string | null; text: string | null; note?: string };

async function localMessages(topicId: string, signal?: AbortSignal): Promise<RawMessage[]> {
  const res = await fetch(`/api/local/hcs?topic=${encodeURIComponent(topicId)}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Local HCS mock: HTTP ${res.status}`);
  const body = (await res.json()) as { lines: { sequenceNumber: number; consensusTimestamp: string; message: string }[] };
  return body.lines.map((l) => ({ sequenceNumber: l.sequenceNumber, consensusTimestamp: l.consensusTimestamp, payer: null, text: l.message }));
}

type MirrorMessage = { sequence_number: number; consensus_timestamp: string; payer_account_id: string; message: string; chunk_info?: { number: number; total: number } | null };

function base64Text(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function mirrorMessages(mirrorUrl: string, topicId: string, signal?: AbortSignal): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  let next: string | null = `/api/v1/topics/${topicId}/messages?order=asc&limit=100`;
  for (let page = 0; next && page < 20; page++) {
    const res = await fetch(`${mirrorUrl}${next}`, { signal });
    if (!res.ok) throw new Error(`Mirror node topic ${topicId}: HTTP ${res.status}`);
    const body = (await res.json()) as { messages: MirrorMessage[]; links?: { next?: string | null } };
    for (const m of body.messages) {
      const chunked = m.chunk_info && m.chunk_info.total > 1;
      out.push({
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        payer: m.payer_account_id,
        text: chunked ? null : base64Text(m.message),
        note: chunked ? `chunk ${m.chunk_info!.number} of ${m.chunk_info!.total} (Faultline messages fit one chunk)` : undefined,
      });
    }
    next = body.links?.next ?? null;
  }
  return out;
}

/** Decodes raw topic messages; keeps only messages for this trigger and chain (a topic may carry other bonds). */
export function toEntries(raw: RawMessage[], ctx: { chainId: number; trigger: string; oracle: string }): HcsEntry[] {
  const out: HcsEntry[] = [];
  for (const r of raw) {
    const base = { sequenceNumber: r.sequenceNumber, consensusTimestamp: r.consensusTimestamp, payer: r.payer };
    if (r.text === null) {
      out.push({ ...base, message: null, parseError: r.note ?? "empty message", signedByOracle: null });
      continue;
    }
    try {
      const m = decodeMessage(r.text);
      if (m.chainId !== ctx.chainId || m.trigger.toLowerCase() !== ctx.trigger.toLowerCase()) continue;
      out.push({ ...base, message: m, parseError: null, signedByOracle: verifyMessageSigner(m, ctx.oracle) });
    } catch (e) {
      out.push({ ...base, message: null, parseError: e instanceof Error ? e.message : String(e), signedByOracle: null });
    }
  }
  return out;
}

export async function readHcs(net: NetworkConfig, ctx: { chainId: number; trigger: string; oracle: string }, signal?: AbortSignal): Promise<HcsEntry[]> {
  if (!net.hcs.topicId) return [];
  const raw = net.hcs.mode === "mock" ? await localMessages(net.hcs.topicId, signal) : await mirrorMessages(net.hcs.mirrorUrl, net.hcs.topicId, signal);
  return toEntries(raw, ctx);
}
