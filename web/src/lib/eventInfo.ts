// Joins what the chain and HCS say about each event: the on-chain record, its logs, the oracle's HCS attestation
// messages (which carry the USGS id, mode and replay offset) and any D15 advisories.
import type { AdvisoryMessage, AttestationMessage } from "./shared";
import type { ChainEventRecord, HcsEntry, LogEntry } from "./types";

export type EventInfo = {
  record: ChainEventRecord;
  /** USGS id from the newest oracle-signed attestation message (a D8 merge keeps the original eventId). */
  usgsId: string | null;
  synthetic: boolean;
  mode: "live" | "replay" | null;
  timeOffsetSec: number | null;
  attestations: (HcsEntry & { message: AttestationMessage })[];
  advisories: (HcsEntry & { message: AdvisoryMessage })[];
  logs: LogEntry[];
};

const isAttestation = (h: HcsEntry): h is HcsEntry & { message: AttestationMessage } => h.message?.kind === "faultline.attestation";
const isAdvisory = (h: HcsEntry): h is HcsEntry & { message: AdvisoryMessage } => h.message?.kind === "faultline.advisory";

export function eventInfos(records: ChainEventRecord[], logs: LogEntry[], hcs: HcsEntry[]): EventInfo[] {
  return records.map((record) => {
    const id = record.eventId.toLowerCase();
    const attestations = hcs.filter(isAttestation).filter((h) => h.message.attestation.eventId.toLowerCase() === id);
    const advisories = hcs.filter(isAdvisory).filter((h) => h.message.eventId.toLowerCase() === id);
    // Only messages whose signature recovers to the oracle may name the event.
    const signed = attestations.filter((h) => h.signedByOracle);
    const newest = signed.at(-1)?.message;
    const usgsId = newest?.usgsId ?? null;
    return {
      record,
      usgsId,
      synthetic: usgsId?.startsWith("synthetic-") ?? false,
      mode: newest?.mode ?? null,
      timeOffsetSec: newest ? newest.timeOffsetSec : null,
      attestations,
      advisories,
      logs: logs.filter((l) => l.contract === "trigger" && String(l.args.eventId ?? "").toLowerCase() === id),
    };
  });
}

/** eventId → display name ("usp000a8ds", "synthetic-kutch-3 (SYNTHETIC)") for activity descriptions. */
export function eventNames(infos: EventInfo[]): Map<string, string> {
  return new Map(infos.filter((i) => i.usgsId).map((i) => [i.record.eventId, i.synthetic ? `${i.usgsId} (SYNTHETIC)` : i.usgsId!]));
}

/** The real-world time behind a replayed chain time (D10): chain value minus the replay offset. Live: unchanged. */
export function realTimeOf(chainSec: number, info: Pick<EventInfo, "mode" | "timeOffsetSec">): number | null {
  if (info.mode === "live") return chainSec;
  if (info.mode === "replay" && info.timeOffsetSec !== null) return chainSec - info.timeOffsetSec;
  return null;
}
