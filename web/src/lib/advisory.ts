// Plain words for the D15 advisory reasons (shared/ts AdvisoryReason).
import type { AdvisoryReason } from "./shared";

export const ADVISORY_TEXT: Record<AdvisoryReason, string> = {
  status: "the USGS record is no longer reviewed",
  type: "the USGS record is no longer an earthquake",
  magType: "the magnitude type is no longer an accepted moment magnitude",
  box: "the epicentre moved outside the insured box",
  depth: "the depth is now beyond the limit",
  belowFloor: "the magnitude fell below the payout floor",
  outsideRiskPeriod: "the origin time is outside the risk period",
  deleted: "USGS deleted the record",
  "not-found": "USGS no longer returns the record",
};
