// Revision decision table (decision.ts): §6.6, D8 resubmits, D15 advisories.
import { describe, expect, it } from "vitest";
import { decide, type ChainRecord, type RecordState } from "../src/decision.js";
import type { LedgerEntry, Publication } from "../src/ledger.js";
import type { Values } from "../src/rule.js";

const V: Values = { lossBps: 7000, magnitudeX100: 770, observedAt: 1000, usgsUpdatedAt: 2000, dataHash: "0xaa" };
const ok = (v: Partial<Values> = {}): RecordState => ({ kind: "found", evaluation: { ok: true, values: { ...V, ...v } } });
const fails = (reason: "box" | "belowFloor" | "status" | "cooling", v: Partial<Values> | null = {}): RecordState => ({ kind: "found", evaluation: { ok: false, reason, values: v === null ? null : { ...V, ...v } } });
const chain = (c: Partial<ChainRecord> = {}): ChainRecord => ({ status: "Pending", nonce: 1, lossBps: 7000, magnitudeX100: 770, observedAt: 1000, usgsUpdatedAt: 2000, ...c });
const NONE = chain({ status: "None", nonce: 0, lossBps: 0, magnitudeX100: 0, observedAt: 0, usgsUpdatedAt: 0 });
const pub = (nonce: number, over: Partial<Publication> = {}, att: Partial<Record<string, string>> = {}): Publication => ({
  nonce,
  att: { eventId: "0xE", lossBps: "7000", magnitudeX100: "770", observedAt: "1000", usgsUpdatedAt: "2000", nonce: String(nonce), termsHash: "0xt", dataHash: "0xaa", deadline: "99999", ...att } as Publication["att"],
  signature: "0xsig",
  hcs: { topicId: "t", sequenceNumber: String(nonce) },
  ...over,
});
const entry = (publications: Publication[] = [], advisories: LedgerEntry["advisories"] = []): LedgerEntry => ({ eventId: "0xE", firstUsgsId: "x", usgsIds: ["x"], lastPreferredId: "x", chainStatus: "Pending", chainNonce: 1, publications, advisories });
const NOW = 5000;

describe("decision table", () => {
  it.each(["Vetoed", "Executed", "Superseded"] as const)("%s on chain → finalised, whatever the record says", (s) => {
    expect(decide(fails("box"), chain({ status: s }), undefined, NOW)).toEqual({ action: "finalised", status: s });
  });
  it("None + passes → submit-new nonce 1; None + fails / cooling / deleted → skip", () => {
    expect(decide(ok(), NONE, undefined, NOW)).toEqual({ action: "submit-new", nonce: 1, values: V });
    expect(decide(fails("belowFloor"), NONE, undefined, NOW).action).toBe("skip");
    expect(decide(fails("cooling"), NONE, undefined, NOW)).toEqual({ action: "skip", reason: "waiting for the cooling period" });
    expect(decide({ kind: "deleted" }, NONE, undefined, NOW).action).toBe("skip");
  });
  const mined = () => entry([pub(1, { tx: { hash: "h", status: "mined" } })]);
  it("§6.6: Pending + identical record → none", () => {
    expect(decide(ok(), chain({ dataHash: "0xaa" }), undefined, NOW)).toEqual({ action: "none", reason: "no change" });
  });
  it("§6.6: same lossBps with a new dataHash / updated → ledger note only (no HCS, no tx, window not restarted)", () => {
    expect(decide(ok({ usgsUpdatedAt: 3000, dataHash: "0xbb" }), chain(), mined(), NOW)).toEqual({ action: "note", values: { ...V, usgsUpdatedAt: 3000, dataHash: "0xbb" } });
  });
  it("§6.6: magnitude 8.1 → 8.2, both above the ceiling (10000 bps) → note, no revision", () => {
    const top = chain({ lossBps: 10000, magnitudeX100: 810 });
    expect(decide(ok({ lossBps: 10000, magnitudeX100: 820, usgsUpdatedAt: 3000, dataHash: "0xbb" }), top, undefined, NOW).action).toBe("note");
  });
  it("§6.6: observedAt moved (still inside the risk period), same lossBps → note, no revision", () => {
    expect(decide(ok({ observedAt: 1500, usgsUpdatedAt: 3000, dataHash: "0xbb" }), chain(), mined(), NOW, { riskStart: 900, maturity: 2000 }).action).toBe("note");
  });
  it("§6.6: a note is taken once per distinct record (compared with the ledger's latest values)", () => {
    const e = { ...mined(), last: { lossBps: 7000, magnitudeX100: 770, observedAt: 1000, usgsUpdatedAt: 3000, dataHash: "0xbb" } };
    expect(decide(ok({ usgsUpdatedAt: 3000, dataHash: "0xbb" }), chain(), e, NOW)).toEqual({ action: "none", reason: "no change" });
  });
  it("§6.6: lossBps changed + newer updated → revise with nonce + 1", () => {
    expect(decide(ok({ lossBps: 6000, magnitudeX100: 760, usgsUpdatedAt: 3000 }), chain(), mined(), NOW)).toMatchObject({ action: "revise", nonce: 2 });
    expect(decide(ok({ lossBps: 7100, magnitudeX100: 771, usgsUpdatedAt: 3000 }), chain({ nonce: 4 }), undefined, NOW)).toMatchObject({ action: "revise", nonce: 5 });
  });
  it("lossBps changed but updated NOT newer → none (the trigger would revert StaleRevision)", () => {
    expect(decide(ok({ lossBps: 6000 }), chain(), undefined, NOW).action).toBe("none");
  });
  it("D15: observedAt moved OUTSIDE the risk period → advisory; for a new event → skip", () => {
    const risk = { riskStart: 900, maturity: 2000 };
    expect(decide(ok({ observedAt: 2500, usgsUpdatedAt: 3000, dataHash: "0xee" }), chain(), mined(), NOW, risk)).toEqual({ action: "advisory", reason: "outsideRiskPeriod", dataHash: "0xee" });
    expect(decide(ok({ observedAt: 800 }), NONE, undefined, NOW, risk)).toEqual({ action: "skip", reason: "observedAt is outside the risk period" });
  });
  it.each(["box", "belowFloor", "status"] as const)("D15: Pending + fails the rule (%s) → advisory with the new dataHash", (reason) => {
    expect(decide(fails(reason, { dataHash: "0xcc" }), chain(), entry(), NOW)).toEqual({ action: "advisory", reason, dataHash: "0xcc" });
  });
  it("D15: Pending + deleted / not found → advisory with dataHash null; null-magnitude record → dataHash null", () => {
    expect(decide({ kind: "deleted" }, chain(), entry(), NOW)).toEqual({ action: "advisory", reason: "deleted", dataHash: null });
    expect(decide({ kind: "not-found" }, chain(), entry(), NOW)).toEqual({ action: "advisory", reason: "not-found", dataHash: null });
    expect(decide(fails("belowFloor", null), chain(), entry(), NOW)).toEqual({ action: "advisory", reason: "belowFloor", dataHash: null });
  });
  it("D15: the same (reason, dataHash) advisory is published only once; a different record advises again", () => {
    const e = entry([], [{ reason: "box", dataHash: "0xcc", hcs: { topicId: "t", sequenceNumber: "3" }, at: "t" }]);
    expect(decide(fails("box", { dataHash: "0xcc" }), chain(), e, NOW).action).toBe("none");
    expect(decide(fails("box", { dataHash: "0xdd" }), chain(), e, NOW).action).toBe("advisory");
  });
  it("a publication that reached HCS but never landed is re-sent as is (no second message for that nonce)", () => {
    const p = pub(1, { tx: { hash: "h", status: "sent" } });
    expect(decide(ok(), NONE, entry([p]), NOW)).toEqual({ action: "resubmit", publication: p });
    const rev = pub(2, {}, { lossBps: "6000", magnitudeX100: "760", usgsUpdatedAt: "3000" });
    expect(decide(ok({ lossBps: 6000, magnitudeX100: 760, usgsUpdatedAt: 3000 }), chain(), entry([pub(1, { tx: { hash: "h", status: "mined" } }), rev]), NOW)).toEqual({ action: "resubmit", publication: rev });
  });
  it("…but not when its deadline has (nearly) passed, it reverted, or the record changed → a NEW nonce", () => {
    expect(decide(ok(), NONE, entry([pub(1, {}, { deadline: String(NOW + 60) })]), NOW)).toMatchObject({ action: "submit-new", nonce: 2 });
    expect(decide(ok(), NONE, entry([pub(1, { tx: { hash: "h", status: "reverted" } })]), NOW)).toMatchObject({ action: "submit-new", nonce: 2 });
    expect(decide(ok({ dataHash: "0xbb" }), NONE, entry([pub(1)]), NOW)).toMatchObject({ action: "submit-new", nonce: 2 });
  });
});
