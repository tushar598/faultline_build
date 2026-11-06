// Issuer page, step a: the trigger terms of a new bond (ARCHITECTURE §6.3). The form holds strings; buildTerms turns them
// into the canonical terms object, its RFC 8785 JSON and termsHash with the repo's shared/ts (the same code the oracle
// and the deploy scripts use), and rejects anything the oracle's TermsSchema (oracle/src/config.ts) would refuse.
// Pure: unit-tested in test/issuer.terms.test.ts.
import { assertReplayAllowed, canonicalize, kutchTerms, lossBpsFor, termsHash, type Terms } from "@/lib/shared";

/** Moment-magnitude types the oracle accepts (D10). A bond may narrow the list, never widen it. */
export const ACCEPTED_MAG_TYPES = ["mww", "mwc", "mwb", "mwr", "mw"] as const;

/** Origin time of the 2001 Bhuj record usp000a8ds in seconds (oracle/fixtures/real-usgs-usp000a8ds-detail.geojson,
 *  `time` 980479000500 ms). Used only to place a replayed Bhuj inside the risk period (D10). */
export const BHUJ_ORIGIN_SEC = 980_479_000;

export type TermsDraft = {
  minLat: string;
  maxLat: string;
  minLon: string;
  maxLon: string;
  maxDepthKm: string;
  magTypes: string[];
  floorMag: string;
  ceilMag: string;
  coolingHours: string;
  mode: Terms["mode"];
  timeOffsetSec: string;
};

export type TermsField = keyof TermsDraft;
export type TermsErrors = Partial<Record<TermsField, string>>;
export type BuiltTerms = { terms: Terms; json: string; hash: string };

/** The D13 Kutch terms as a draft (live mode). */
export function defaultTermsDraft(): TermsDraft {
  const t = kutchTerms("live", 0);
  return {
    minLat: String(t.box.minLat),
    maxLat: String(t.box.maxLat),
    minLon: String(t.box.minLon),
    maxLon: String(t.box.maxLon),
    maxDepthKm: String(t.maxDepthKm),
    magTypes: [...t.magTypes],
    floorMag: (t.floorMagX100 / 100).toFixed(2),
    ceilMag: (t.ceilMagX100 / 100).toFixed(2),
    coolingHours: String(t.coolingPeriodSec / 3600),
    mode: "live",
    timeOffsetSec: "0",
  };
}

/** Testnet starting terms: replay, with Bhuj (usp000a8ds) 60 s after riskStart. A live bond on the demo's 30-minute risk
 *  period would almost surely see no qualifying quake, so the lifecycle could not be shown (owner's browser run,
 *  2026-11-06). Replay is allowed on 296 (D14) and every view marks the bond REPLAY. */
export function testnetDemoTermsDraft(riskStart: number): TermsDraft {
  return { ...defaultTermsDraft(), mode: "replay", timeOffsetSec: String(bhujReplayOffset(riskStart)) };
}

/** When riskStart moves, a Bhuj placement moves with it; any other offset (typed by hand) stays as it is. */
export function followRiskStart(terms: TermsDraft, oldRiskStart: number, newRiskStart: number): TermsDraft {
  if (terms.mode !== "replay" || oldRiskStart === newRiskStart || terms.timeOffsetSec !== String(bhujReplayOffset(oldRiskStart))) return terms;
  return { ...terms, timeOffsetSec: String(bhujReplayOffset(newRiskStart)) };
}

const DECIMAL = (places: number) => new RegExp(`^-?\\d{1,4}(?:\\.\\d{1,${places}})?$`);

function parseCoord(v: string, min: number, max: number): number | string {
  const s = v.trim();
  if (!DECIMAL(4).test(s)) return "Use a number with at most 4 decimals.";
  const n = Number(s);
  if (n < min || n > max) return `Must be between ${min} and ${max}.`;
  return n;
}

/** "7.05" → 705 without floating-point maths; a string is an error message. */
export function parseMagX100(v: string): number | string {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return "Use a magnitude like 7.0 or 7.25.";
  const x = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (x > 1000) return "Must be 10.00 or less.";
  return x;
}

/** Hours with at most 2 decimals → whole seconds (0.01 h = 36 s). */
function parseHours(v: string): number | string {
  const m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return "Use hours with at most 2 decimals.";
  return Number(m[1]) * 3600 + Number((m[2] ?? "").padEnd(2, "0")) * 36;
}

/**
 * The canonical terms for `draft` on `chainId`, or the field errors. Replay terms are refused outside chainIds 31337 and
 * 296 by shared/ts `assertReplayAllowed` (D14, an off-chain guard: on chain the mode shows only through termsHash).
 */
export function buildTerms(draft: TermsDraft, chainId: number): { ok: true; value: BuiltTerms } | { ok: false; errors: TermsErrors } {
  const errors: TermsErrors = {};
  const num = (field: TermsField, r: number | string): number => {
    if (typeof r === "string") {
      errors[field] = r;
      return 0;
    }
    return r;
  };
  const minLat = num("minLat", parseCoord(draft.minLat, -90, 90));
  const maxLat = num("maxLat", parseCoord(draft.maxLat, -90, 90));
  const minLon = num("minLon", parseCoord(draft.minLon, -180, 180));
  const maxLon = num("maxLon", parseCoord(draft.maxLon, -180, 180));
  if (!errors.minLat && !errors.maxLat && minLat >= maxLat) errors.maxLat = "Must be above the minimum latitude.";
  if (!errors.minLon && !errors.maxLon && minLon >= maxLon) errors.maxLon = "Must be east of the minimum longitude (a box across the 180th meridian is not supported).";

  const depthStr = draft.maxDepthKm.trim();
  let maxDepthKm = 0;
  if (!/^\d{1,3}(?:\.\d)?$/.test(depthStr)) errors.maxDepthKm = "Use kilometres with at most 1 decimal.";
  else {
    maxDepthKm = Number(depthStr);
    if (maxDepthKm <= 0 || maxDepthKm > 800) errors.maxDepthKm = "Must be above 0 and at most 800 km.";
  }

  const magTypes = ACCEPTED_MAG_TYPES.filter((m) => draft.magTypes.includes(m));
  if (magTypes.length === 0) errors.magTypes = "Choose at least one moment-magnitude type.";
  if (draft.magTypes.some((m) => !(ACCEPTED_MAG_TYPES as readonly string[]).includes(m))) errors.magTypes = "Only mww, mwc, mwb, mwr and mw are accepted (D10).";

  const floorMagX100 = num("floorMag", parseMagX100(draft.floorMag));
  const ceilMagX100 = num("ceilMag", parseMagX100(draft.ceilMag));
  if (!errors.floorMag && !errors.ceilMag && ceilMagX100 <= floorMagX100) errors.ceilMag = "Must be above the floor magnitude.";
  const coolingPeriodSec = num("coolingHours", parseHours(draft.coolingHours));

  let timeOffsetSec = 0;
  if (draft.mode === "replay") {
    const s = draft.timeOffsetSec.trim();
    if (!/^-?\d{1,13}$/.test(s) || !Number.isSafeInteger(Number(s))) errors.timeOffsetSec = "Use a whole number of seconds.";
    else timeOffsetSec = Number(s);
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  const terms: Terms = {
    version: 1,
    box: { minLat, maxLat, minLon, maxLon },
    maxDepthKm,
    magTypes: [...magTypes],
    floorMagX100,
    ceilMagX100,
    coolingPeriodSec,
    aggregation: "sum-capped-10000",
    mode: draft.mode,
    timeOffsetSec,
    source: "USGS ComCat",
  };
  try {
    assertReplayAllowed(terms, BigInt(chainId));
  } catch {
    return { ok: false, errors: { mode: `Replay terms are allowed only on the local chain (31337) and Hedera testnet (296), not on chain ${chainId} (D14).` } };
  }
  return { ok: true, value: { terms, json: canonicalize(terms), hash: termsHash(terms) } };
}

/** Replay offset that puts the Bhuj origin time `afterRiskStartSec` seconds after `riskStart` (D10). */
export const bhujReplayOffset = (riskStart: number, afterRiskStartSec = 60) => riskStart + afterRiskStartSec - BHUJ_ORIGIN_SEC;

/** Points of the payout curve for the preview: loss in bps from half a magnitude below the floor to half above the
 *  ceiling, every 0.05, computed with the oracle's own `lossBpsFor`. */
export function curvePoints(terms: Pick<Terms, "floorMagX100" | "ceilMagX100">): { magX100: number; lossBps: number }[] {
  const t = terms as Terms;
  const from = Math.max(0, terms.floorMagX100 - 50);
  const to = Math.min(1000, terms.ceilMagX100 + 50);
  const out: { magX100: number; lossBps: number }[] = [];
  for (let m = from; m <= to; m += 5) out.push({ magX100: m, lossBps: lossBpsFor(m, t) });
  if (out[out.length - 1]?.magX100 !== to) out.push({ magX100: to, lossBps: lossBpsFor(to, t) });
  return out;
}
