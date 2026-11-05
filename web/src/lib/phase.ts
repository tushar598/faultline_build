// Bond status from the schedule and the trigger state (ARCHITECTURE §2 lifecycle table), at chain time.
import type { BondSnapshot } from "./types";

export type Phase = "before-issuance" | "issuance" | "awaiting-risk" | "risk" | "grace" | "redemption-blocked" | "redemption" | "closed";

export const PHASE_LABEL: Record<Phase, string> = {
  "before-issuance": "Before issuance",
  issuance: "Issuance open",
  "awaiting-risk": "Issuance closed",
  risk: "Risk period",
  grace: "Grace period",
  "redemption-blocked": "Redemption on hold",
  redemption: "Redemption open",
  closed: "Closed",
};

type PhaseInput = Pick<BondSnapshot, "schedule" | "trigger"> & { books: Pick<BondSnapshot["books"], "unitsIssued" | "bondSupply"> };

/** Phase at `now` (unix seconds, chain clock). */
export function phaseAt(s: PhaseInput, now: number): Phase {
  const { issuanceStart, issuanceEnd, riskStart, maturity, submissionDeadline } = s.schedule;
  if (now < issuanceStart) return "before-issuance";
  if (now < issuanceEnd) return "issuance";
  if (now < riskStart) return "awaiting-risk";
  if (now <= maturity) return "risk";
  // submissionDeadline moves with the clock while paused (D2), so a pause keeps the bond in grace.
  if (s.trigger.paused || now <= submissionDeadline) return "grace";
  if (s.trigger.pendingCount > 0) return "redemption-blocked";
  if (s.books.unitsIssued > 0n && s.books.bondSupply === 0n) return "closed";
  return "redemption";
}

/** The schedule as ordered milestones for the timeline. */
export function milestones(s: Pick<BondSnapshot, "schedule">) {
  const { issuanceStart, issuanceEnd, riskStart, maturity, submissionDeadline } = s.schedule;
  const list = [
    { key: "issuanceStart", label: "Issuance opens", at: issuanceStart },
    { key: "issuanceEnd", label: "Issuance closes", at: issuanceEnd },
    { key: "riskStart", label: "Risk period starts", at: riskStart },
    { key: "maturity", label: "Maturity", at: maturity },
    { key: "submissionDeadline", label: "Redemption opens", at: submissionDeadline },
  ];
  // Locally issuanceEnd == riskStart: show one milestone for both.
  return list.filter((m, i) => !(m.key === "riskStart" && list[i - 1]!.at === m.at)).map((m) => (m.key === "issuanceEnd" && issuanceEnd === riskStart ? { ...m, label: "Issuance closes, risk starts" } : m));
}
