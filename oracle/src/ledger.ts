// D8 ledger: everything the oracle has done, per eventId, persisted as one JSON file per (chainId, trigger) in
// stateDir with atomic writes (temp file + fsync + rename). Every USGS id ever seen for an event (`properties.ids` and
// the preferred id) maps to the ORIGINAL eventId, so a preferred-id change after a merge never creates a second
// eventId. The chain stays the source of truth: callers reconcile with trigger.getEventRecord before acting.
import fs from "node:fs";
import path from "node:path";
import type { Attestation } from "../../shared/ts/attestation.js";
import type { AdvisoryReason } from "../../shared/ts/hcsMessage.js";
import type { Status } from "./abi.js";

export type HcsRef = { sequenceNumber: string; consensusTimestamp?: string; topicId: string };
export type Publication = {
  nonce: number;
  /** The signed attestation exactly as published (bigints as decimal strings). */
  att: Record<keyof Attestation, string>;
  signature: string;
  hcs?: HcsRef;
  tx?: { hash: string; status: "sent" | "mined" | "reverted" | "already-handled"; note?: string };
};
export type Advisory = { reason: AdvisoryReason; dataHash: string | null; hcs?: HcsRef; at: string };
export type LedgerEntry = {
  eventId: string;
  /** The preferred id when the event was first seen, then every id seen since. */
  firstUsgsId: string;
  usgsIds: string[];
  lastPreferredId: string;
  chainStatus: Status;
  chainNonce: number;
  last?: { dataHash: string; usgsUpdatedAt: number; lossBps: number; magnitudeX100: number; observedAt: number };
  publications: Publication[];
  advisories: Advisory[];
  /** §6.6: newer records with an UNCHANGED lossBps (no revision sent); the chain may show older values. */
  notes?: { seenAt: string; usgsId: string; lossBps: number; magnitudeX100: number; observedAt: number; usgsUpdatedAt: number; dataHash: string }[];
};
type LedgerFile = { version: 1; chainId: string; trigger: string; events: Record<string, LedgerEntry>; idIndex: Record<string, string> };

export type Lookup = { kind: "known"; eventId: string; newIds: string[] } | { kind: "new" } | { kind: "conflict"; eventIds: string[] };

export class Ledger {
  private data: LedgerFile;
  readonly file: string;

  constructor(stateDir: string, chainId: bigint, trigger: string) {
    this.file = path.join(stateDir, `ledger-${chainId}-${trigger.toLowerCase()}.json`);
    this.data = fs.existsSync(this.file)
      ? (JSON.parse(fs.readFileSync(this.file, "utf8")) as LedgerFile)
      : { version: 1, chainId: chainId.toString(), trigger: trigger.toLowerCase(), events: {}, idIndex: {} };
    if (this.data.chainId !== chainId.toString() || this.data.trigger !== trigger.toLowerCase()) throw new Error(`ledger ${this.file} belongs to another chain or trigger`);
  }

  /** Maps a record's ids to a known eventId (D8). Ids that point at two different events are a conflict. */
  lookup(ids: string[]): Lookup {
    const hits = new Set(ids.map((i) => this.data.idIndex[i]).filter((x): x is string => Boolean(x)));
    if (hits.size === 0) return { kind: "new" };
    if (hits.size > 1) return { kind: "conflict", eventIds: [...hits] };
    const eventId = [...hits][0]!;
    return { kind: "known", eventId, newIds: ids.filter((i) => !this.data.idIndex[i]) };
  }

  get(eventId: string): LedgerEntry | undefined {
    return this.data.events[eventId];
  }
  entries(): LedgerEntry[] {
    return Object.values(this.data.events);
  }

  /** Creates the entry on first sight, or adds newly seen ids (merge) to it. Saves. */
  upsert(eventId: string, preferredId: string, ids: string[]): LedgerEntry {
    let e = this.data.events[eventId];
    if (!e) {
      e = { eventId, firstUsgsId: preferredId, usgsIds: [], lastPreferredId: preferredId, chainStatus: "None", chainNonce: 0, publications: [], advisories: [] };
      this.data.events[eventId] = e;
    }
    e.lastPreferredId = preferredId;
    for (const i of ids) {
      if (!e.usgsIds.includes(i)) e.usgsIds.push(i);
      this.data.idIndex[i] = eventId;
    }
    this.save();
    return e;
  }

  update(eventId: string, fn: (e: LedgerEntry) => void): LedgerEntry {
    const e = this.data.events[eventId];
    if (!e) throw new Error(`ledger has no event ${eventId}`);
    fn(e);
    this.save();
    return e;
  }

  /** Atomic replace: write a temp file in the same directory, fsync it, then rename over the ledger. */
  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, JSON.stringify(this.data, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}

/** Attestation with bigints → decimal strings for JSON. */
export function attToJson(a: Attestation): Record<keyof Attestation, string> {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) as Record<keyof Attestation, string>;
}
export function attFromJson(j: Record<keyof Attestation, string>): Attestation {
  return {
    eventId: j.eventId,
    lossBps: BigInt(j.lossBps),
    magnitudeX100: BigInt(j.magnitudeX100),
    observedAt: BigInt(j.observedAt),
    usgsUpdatedAt: BigInt(j.usgsUpdatedAt),
    nonce: BigInt(j.nonce),
    termsHash: j.termsHash,
    dataHash: j.dataHash,
    deadline: BigInt(j.deadline),
  };
}
