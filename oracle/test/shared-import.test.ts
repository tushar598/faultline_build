// The oracle (ESM, nodenext) imports the shared attestation helpers from ../shared/ts (CommonJS-format files under
// the root package.json). This test proves the cross-package import works at type-check time and under vitest.
import { describe, expect, it } from "vitest";
import { kutchTerms, lossBpsFor, magnitudeX100, termsHash } from "../../shared/ts/attestation.js";

describe("shared/ts from the oracle package", () => {
  it("Bhuj M7.7 → 770 → 7000 bps under the D13 terms", () => {
    const terms = kutchTerms("live", 0);
    expect(magnitudeX100(7.7)).toBe(770);
    expect(lossBpsFor(770, terms)).toBe(7000);
    expect(termsHash(terms)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
