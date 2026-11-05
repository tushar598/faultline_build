// Issuer page step a: terms builder, canonical JSON, termsHash (shared/ts), the D14 replay guard and the curve preview.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BHUJ_ORIGIN_SEC, bhujReplayOffset, buildTerms, curvePoints, defaultTermsDraft, parseMagX100 } from "@/lib/issuer/terms";
import { canonicalize, kutchTerms, termsHash } from "@/lib/shared";

const draft = defaultTermsDraft();

describe("issuer terms builder", () => {
  it("the default draft rebuilds exactly the D13 live terms and their termsHash", () => {
    const r = buildTerms(draft, 31337);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.terms).toEqual(kutchTerms("live", 0));
    expect(r.value.hash).toBe(termsHash(kutchTerms("live", 0)));
    expect(r.value.json).toBe(canonicalize(kutchTerms("live", 0)));
  });

  it("replay terms with an offset hash like shared/ts kutchTerms(replay, offset) (the testnet demo's offset)", () => {
    const r = buildTerms({ ...draft, mode: "replay", timeOffsetSec: "812648662" }, 296);
    expect(r.ok && r.value.hash).toBe(termsHash(kutchTerms("replay", 812_648_662)));
  });

  it("D14: replay terms are refused outside 31337 and 296; live terms are allowed anywhere", () => {
    for (const chain of [295, 297, 1]) {
      const r = buildTerms({ ...draft, mode: "replay", timeOffsetSec: "100" }, chain);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.mode).toMatch(/31337.*296/);
    }
    expect(buildTerms(draft, 295).ok).toBe(true);
  });

  it("live terms always carry offset 0 whatever the offset field says", () => {
    const r = buildTerms({ ...draft, timeOffsetSec: "999" }, 31337);
    expect(r.ok && r.value.terms.timeOffsetSec).toBe(0);
  });

  it("rejects an inverted box, out-of-range coordinates and too many decimals, field by field", () => {
    const r = buildTerms({ ...draft, minLat: "24.5", maxLat: "22.5", minLon: "200", maxLon: "71.12345" }, 31337);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.maxLat).toMatch(/above the minimum/);
    expect(r.errors.minLon).toMatch(/between -180 and 180/);
    expect(r.errors.maxLon).toMatch(/4 decimals/);
  });

  it("rejects a ceiling at or below the floor, a depth of 0 and no magnitude type", () => {
    const r = buildTerms({ ...draft, floorMag: "7.5", ceilMag: "7.5", maxDepthKm: "0", magTypes: [] }, 31337);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.ceilMag).toBeDefined();
    expect(r.errors.maxDepthKm).toBeDefined();
    expect(r.errors.magTypes).toBeDefined();
  });

  it("refuses a magnitude type outside the D10 list and keeps the canonical order of the accepted ones", () => {
    expect(buildTerms({ ...draft, magTypes: ["mww", "ml"] }, 31337).ok).toBe(false);
    const r = buildTerms({ ...draft, magTypes: ["mw", "mww"] }, 31337);
    expect(r.ok && r.value.terms.magTypes).toEqual(["mww", "mw"]);
  });

  it("parses magnitudes and cooling hours without floating-point error", () => {
    expect(parseMagX100("8.2")).toBe(820);
    expect(parseMagX100("7.05")).toBe(705);
    expect(parseMagX100("7.123")).toMatch(/magnitude/);
    expect(parseMagX100("11")).toMatch(/10.00/);
    const r = buildTerms({ ...draft, coolingHours: "0.01" }, 31337);
    expect(r.ok && r.value.terms.coolingPeriodSec).toBe(36);
  });

  it("the Bhuj origin constant equals the saved USGS record, and the helper offset puts it 60 s after riskStart", () => {
    const f = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../oracle/fixtures/real-usgs-usp000a8ds-detail.geojson"), "utf8"));
    expect(Math.floor(f.properties.time / 1000)).toBe(BHUJ_ORIGIN_SEC);
    expect(BHUJ_ORIGIN_SEC + bhujReplayOffset(2_000_000_000)).toBe(2_000_000_060);
  });

  it("the curve preview uses lossBpsFor: 0 at the floor, 7000 at M7.7 on 7.0 to 8.0, capped at 10000", () => {
    const pts = curvePoints({ floorMagX100: 700, ceilMagX100: 800 });
    const at = (m: number) => pts.find((p) => p.magX100 === m)?.lossBps;
    expect(at(650)).toBe(0);
    expect(at(700)).toBe(0);
    expect(at(770)).toBe(7000);
    expect(at(800)).toBe(10_000);
    expect(at(850)).toBe(10_000);
    expect(pts[0]!.magX100).toBe(650);
  });
});
