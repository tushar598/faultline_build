// Thin wrapper over shared/ts (the single implementation of the §6.2 rule, the D13 curve, the D10/D14 replay times and
// the §6.4 dataHash). It only adds what the oracle needs on top: null-safe handling of ComCat records whose `mag` or
// `magType` is null, and one object with every value the trigger stores, for the revision decision (§6.6).
import { checkAcceptance, dataHash, eventIdOf, lossBpsFor, magnitudeX100, observedAtOf, usgsUpdatedAtOf, type Rejection, type Terms, type UsgsFeature } from "../../shared/ts/attestation.js";
import { asUsgsFeature, type Feature } from "./usgs.js";

/** What the trigger would store for this record (computed even when the rule fails, for the advisory). */
export type Values = { lossBps: number; magnitudeX100: number; observedAt: number; usgsUpdatedAt: number; dataHash: string };
export type Evaluation = { ok: true; values: Values } | { ok: false; reason: Rejection; values: Values | null };

/** §6.2 at `nowSec` (chain time). A null `mag` counts as "belowFloor", a null `magType` as "magType". */
export function evaluate(f: Feature, terms: Terms, nowSec: number): Evaluation {
  const u = asUsgsFeature(f);
  if (!u) return { ok: false, reason: f.properties.magType === null ? "magType" : "belowFloor", values: null };
  const values = valuesOf(u, terms);
  const verdict = checkAcceptance(u, terms, nowSec);
  return verdict.ok ? { ok: true, values } : { ok: false, reason: verdict.reason, values };
}

export function valuesOf(u: UsgsFeature, terms: Terms): Values {
  const m = magnitudeX100(u.properties.mag);
  return {
    lossBps: lossBpsFor(m, terms),
    magnitudeX100: m,
    observedAt: observedAtOf(u, terms),
    usgsUpdatedAt: usgsUpdatedAtOf(u, terms),
    dataHash: dataHash(u),
  };
}

export { eventIdOf };
