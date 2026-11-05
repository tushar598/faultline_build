// What the oracle does with one USGS record, given the chain and the ledger (ARCHITECTURE §6.6, D8, D15). Pure, so
// the whole decision table is unit-tested.
//
//   chain status          record                                   → action
//   Vetoed/Executed/Sup.  anything                                 → finalised (never touch it again)
//   None                  gone, or fails the rule (incl. cooling)  → skip
//   None                  passes                                   → submit-new (or resubmit an unsent publication)
//   Pending               gone, fails the rule, or observedAt left the risk period → advisory (D15), once per
//                                                                  (reason, dataHash)
//   Pending               passes, SAME lossBps, other values changed → note (ledger only: no HCS, no tx, the
//                                                                  challenge window is not restarted)
//   Pending               passes, same lossBps, nothing changed     → none
//   Pending               passes, lossBps changed, newer updated    → revise with nonce + 1 (§6.6)
//   Pending               passes, lossBps changed, not newer        → none (the trigger would revert StaleRevision)
//
// §6.6 (owner, 2026-10-27): a revision is sent ONLY when lossBps changes. magnitudeX100, observedAt, usgsUpdatedAt and
// dataHash may then lag on chain; the ledger keeps the latest values.
// A publication that reached HCS but whose submit never landed is re-sent as is (same nonce, same signature) while its
// deadline is valid, so one (eventId, nonce) is never published twice.
import type { AdvisoryReason } from "../../shared/ts/hcsMessage.js";
import type { Status } from "./abi.js";
import type { LedgerEntry, Publication } from "./ledger.js";
import type { Evaluation, Values } from "./rule.js";

export type ChainRecord = { status: Status; nonce: number; lossBps: number; magnitudeX100: number; observedAt: number; usgsUpdatedAt: number; dataHash?: string };
/** The bond's risk period; an attestation's observedAt must lie inside it (the trigger checks it at submit). */
export type RiskPeriod = { riskStart: number; maturity: number };
export type RecordState = { kind: "found"; evaluation: Evaluation } | { kind: "deleted" } | { kind: "not-found" };

export type Decision =
  | { action: "finalised"; status: Status }
  | { action: "skip"; reason: string }
  | { action: "submit-new"; nonce: number; values: Values }
  | { action: "resubmit"; publication: Publication }
  | { action: "revise"; nonce: number; values: Values }
  | { action: "none"; reason: string }
  | { action: "note"; values: Values }
  | { action: "advisory"; reason: AdvisoryReason; dataHash: string | null };

/** The rule's verdict, plus the one check only the decision can make: observedAt inside the bond's risk period. */
type Verdict = Evaluation | { ok: false; reason: "outsideRiskPeriod"; values: Values };

/** Seconds a re-sent attestation must still be valid for. */
export const RESUBMIT_MARGIN_SEC = 120;

export function decide(rec: RecordState, chain: ChainRecord, entry: LedgerEntry | undefined, nowSec: number, risk?: RiskPeriod): Decision {
  if (chain.status === "Vetoed" || chain.status === "Executed" || chain.status === "Superseded") return { action: "finalised", status: chain.status };
  let ev: Verdict | undefined = rec.kind === "found" ? rec.evaluation : undefined;
  if (ev?.ok && risk && (ev.values.observedAt < risk.riskStart || ev.values.observedAt > risk.maturity)) {
    ev = { ok: false, reason: "outsideRiskPeriod", values: ev.values };
  }

  if (chain.status === "None") {
    if (!ev) return { action: "skip", reason: `record ${rec.kind}; nothing on chain` };
    if (!ev.ok) return { action: "skip", reason: ev.reason === "cooling" ? "waiting for the cooling period" : ev.reason === "outsideRiskPeriod" ? "observedAt is outside the risk period" : `rule rejects it (${ev.reason})` };
    const unsent = unsentPublication(entry, chain, ev.values, nowSec);
    if (unsent) return { action: "resubmit", publication: unsent };
    return { action: "submit-new", nonce: nextNonce(entry, chain), values: ev.values };
  }

  // Pending
  if (!ev || !ev.ok) {
    if (ev && !ev.ok && ev.reason === "cooling") return { action: "none", reason: "cooling (cannot happen for a pending event)" };
    const reason: AdvisoryReason = !ev ? (rec.kind === "deleted" ? "deleted" : "not-found") : (ev as { reason: AdvisoryReason }).reason;
    const dataHash = ev && !ev.ok ? (ev.values?.dataHash ?? null) : null;
    if (entry?.advisories.some((a) => a.reason === reason && a.dataHash === dataHash && a.hcs)) return { action: "none", reason: `advisory already published (${reason})` };
    return { action: "advisory", reason, dataHash };
  }
  const v = ev.values;
  if (v.lossBps === chain.lossBps) {
    // §6.6: no revision; keep the newer record in the ledger only (once per distinct set of values).
    const seen = entry?.last ?? { magnitudeX100: chain.magnitudeX100, observedAt: chain.observedAt, usgsUpdatedAt: chain.usgsUpdatedAt, dataHash: chain.dataHash ?? "" };
    const changed = v.magnitudeX100 !== seen.magnitudeX100 || v.observedAt !== seen.observedAt || v.usgsUpdatedAt !== seen.usgsUpdatedAt || v.dataHash !== seen.dataHash;
    return changed ? { action: "note", values: v } : { action: "none", reason: "no change" };
  }
  if (v.usgsUpdatedAt <= chain.usgsUpdatedAt) return { action: "none", reason: "lossBps changed but usgsUpdatedAt is not newer than the chain's; cannot revise" };
  const unsent = unsentPublication(entry, chain, v, nowSec);
  if (unsent) return { action: "resubmit", publication: unsent };
  return { action: "revise", nonce: nextNonce(entry, chain), values: v };
}

function nextNonce(entry: LedgerEntry | undefined, chain: ChainRecord): number {
  const ledgerMax = Math.max(0, ...(entry?.publications ?? []).map((p) => p.nonce));
  return Math.max(ledgerMax, chain.nonce) + 1;
}

/** The newest publication above the chain's nonce that reached HCS but did not land, for the same values, still valid. */
function unsentPublication(entry: LedgerEntry | undefined, chain: ChainRecord, v: Values, nowSec: number): Publication | undefined {
  const p = [...(entry?.publications ?? [])].sort((a, b) => b.nonce - a.nonce)[0];
  if (!p || p.nonce <= chain.nonce || !p.hcs) return undefined;
  if (p.tx && p.tx.status !== "sent") return undefined;
  const a = p.att;
  const same = Number(a.lossBps) === v.lossBps && Number(a.magnitudeX100) === v.magnitudeX100 && Number(a.observedAt) === v.observedAt && Number(a.usgsUpdatedAt) === v.usgsUpdatedAt && a.dataHash === v.dataHash;
  return same && Number(a.deadline) > nowSec + RESUBMIT_MARGIN_SEC ? p : undefined;
}
