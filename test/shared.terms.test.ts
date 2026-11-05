// shared/ts/attestation.ts terms part: Kutch terms (D13), termsHash, replay chain guard (D14).
// Extra to the reference repo: pins the termsHash literals so a change to the terms or to JCS is caught at once.
// The values were computed with the reference repo's shared/ts and match it.
import { expect } from "chai";
import { ethers } from "hardhat";
import { REPLAY_CHAIN_IDS, assertReplayAllowed, kutchTerms, termsHash } from "../shared/ts/attestation";
import { canonicalize } from "../shared/ts/jcs";

describe("shared/ts terms and termsHash", () => {
  it("live Kutch terms: JCS text and termsHash equal the reference values", () => {
    const text =
      '{"aggregation":"sum-capped-10000","box":{"maxLat":24.5,"maxLon":71.5,"minLat":22.5,"minLon":68.5},"ceilMagX100":800,' +
      '"coolingPeriodSec":21600,"floorMagX100":700,"magTypes":["mww","mwc","mwb","mwr","mw"],"maxDepthKm":70,"mode":"live",' +
      '"source":"USGS ComCat","timeOffsetSec":0,"version":1}';
    expect(canonicalize(kutchTerms("live", 0))).to.equal(text);
    expect(termsHash(kutchTerms("live", 0))).to.equal(ethers.keccak256(ethers.toUtf8Bytes(text)));
    expect(termsHash(kutchTerms("live", 0))).to.equal("0xa9e12f9506c4f841398afa6c12302f45b8fdd4216c3967fbe812d55e9859101e");
  });

  it("replay terms: the hash changes with mode and offset (D10)", () => {
    expect(termsHash(kutchTerms("replay", 0))).to.equal("0xc6029b8c71db99cc47db00ac6e77bc22e82c9ccc799dd7b042c7ded2af099647");
    expect(termsHash(kutchTerms("replay", 777))).to.equal("0x487f0ee491c4294da197464f3476318f301630d93ed87e7545c22b32bb515d1b");
    const t = kutchTerms("replay", 777);
    const shuffled = Object.fromEntries(Object.entries(t).reverse()) as typeof t;
    expect(termsHash(shuffled)).to.equal(termsHash(t));
  });

  it("live terms refuse a non-zero offset; offsets must be safe integers", () => {
    expect(() => kutchTerms("live", 5)).to.throw(/live/);
    expect(() => kutchTerms("replay", 1.5)).to.throw(/safe integer/);
  });

  it("replay terms are allowed only on 31337 and 296 (D14); live terms anywhere", () => {
    expect(REPLAY_CHAIN_IDS).to.deep.equal([31_337n, 296n]);
    for (const ok of [31_337n, 296n]) expect(() => assertReplayAllowed(kutchTerms("replay", 1), ok)).to.not.throw();
    for (const bad of [295n, 297n, 1n]) {
      expect(() => assertReplayAllowed(kutchTerms("replay", 1), bad)).to.throw(`replay terms are not allowed on chainId ${bad}`);
      expect(() => assertReplayAllowed(kutchTerms("live", 0), bad)).to.not.throw();
    }
  });
});
