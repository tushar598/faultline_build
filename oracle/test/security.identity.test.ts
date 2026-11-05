// Security review SEC-08 (fixed): D8 must not depend on the local ledger file alone. If the ledger is lost (fresh
// machine, deleted out/) and USGS has meanwhile changed the preferred id of a quake the trigger already knows, the
// oracle must still use the ORIGINAL eventId, never attest the same quake a second time (D1 would add both losses).
import { describe, expect, it } from "vitest";
import { eventIdOf } from "../../shared/ts/attestation.js";
import type { Status } from "../src/abi.js";
import { resolveIdentity } from "../src/identity.js";

const chain = (known: Record<string, Status>) => async (eventId: string): Promise<Status> => known[eventId] ?? "None";
const MERGED_IDS = ["synthetic-kutch-2b", "synthetic-kutch-2"]; // preferred id changed after a merge

describe("SEC-08: event identity survives a lost ledger", () => {
  it("PoC: with an empty ledger the merged record resolves to the ORIGINAL on-chain eventId, not eventIdOf(new preferred id)", async () => {
    const original = eventIdOf("synthetic-kutch-2");
    const r = await resolveIdentity(MERGED_IDS, { kind: "new" }, chain({ [original]: "Vetoed" }));
    expect(r).toEqual({ kind: "known", eventId: original, newIds: MERGED_IDS, recoveredFromChain: true });
    expect(r.kind === "known" && r.eventId).not.toBe(eventIdOf("synthetic-kutch-2b"));
  });
  it("a record none of whose ids is on chain is new", async () => {
    expect(await resolveIdentity(["usp000a8ds", "iscgem1763683"], { kind: "new" }, chain({}))).toEqual({ kind: "new" });
  });
  it("ids that are two different on-chain events are a conflict (refuse, as D8)", async () => {
    const r = await resolveIdentity(MERGED_IDS, { kind: "new" }, chain({ [eventIdOf("synthetic-kutch-2")]: "Pending", [eventIdOf("synthetic-kutch-2b")]: "Executed" }));
    expect(r.kind).toBe("conflict");
  });
  it("the ledger's answer wins when it knows the record (no chain reads)", async () => {
    let reads = 0;
    const r = await resolveIdentity(MERGED_IDS, { kind: "known", eventId: "0xabc", newIds: [] }, async () => (reads++, "None"));
    expect(r).toEqual({ kind: "known", eventId: "0xabc", newIds: [] });
    expect(reads).toBe(0);
  });
});
