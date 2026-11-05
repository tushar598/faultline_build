// shared/ts/jcs.ts against the RFC 8785 examples (§3.2.2 sample, §3.2.3 sorting, Appendix B numbers).
import { expect } from "chai";
import { canonicalize } from "../shared/ts/jcs";

/** IEEE-754 double from its 16-hex-digit bit pattern (RFC 8785 Appendix B notation). */
const fromBits = (hex: string) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, BigInt("0x" + hex));
  return v.getFloat64(0);
};

describe("shared/ts JCS (RFC 8785)", () => {
  it("§3.2.2 sample: sorted keys, ES number format, minimal string escaping", () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
        ' "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    );
    expect(canonicalize(input)).to.equal(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("§3.2.3 sorting: property names in UTF-16 code-unit order", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    const keys = Object.keys(JSON.parse(canonicalize(input)) as object);
    // JSON.parse keeps "1" first (integer-like keys), so compare the text order instead.
    const text = canonicalize(input);
    const order = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"].map((k) => text.indexOf(JSON.stringify(k) + ":"));
    expect(order.every((pos, i) => pos >= 0 && (i === 0 || pos > order[i - 1]))).to.equal(true);
    expect(keys.length).to.equal(7);
    expect(text.startsWith('{"\\r":"Carriage Return","1":"One","\u0080":"Control"')).to.equal(true);
  });

  it("Appendix B numbers: ECMAScript serialisation of IEEE-754 doubles", () => {
    const cases: [string, string][] = [
      ["0000000000000000", "0"],
      ["8000000000000000", "0"], // -0
      ["0000000000000001", "5e-324"],
      ["8000000000000001", "-5e-324"],
      ["7fefffffffffffff", "1.7976931348623157e+308"],
      ["ffefffffffffffff", "-1.7976931348623157e+308"],
      ["4340000000000000", "9007199254740992"],
      ["c340000000000000", "-9007199254740992"],
      ["4430000000000000", "295147905179352830000"],
      ["44b52d02c7e14af6", "1e+23"],
      ["444b1ae4d6e2ef50", "1e+21"],
      ["3eb0c6f7a0b5ed8d", "0.000001"],
      ["41b3de4355555555", "333333333.3333333"],
    ];
    for (const [bits, want] of cases) expect(canonicalize(fromBits(bits)), bits).to.equal(want);
  });

  it("rejects NaN, Infinity, undefined values, bigint and functions", () => {
    for (const bad of [NaN, Infinity, -Infinity, 1n, () => 1, { a: undefined }]) {
      expect(() => canonicalize(bad), String(bad)).to.throw(/JCS/);
    }
  });

  it("nested objects and arrays canonicalise recursively; array order is kept", () => {
    expect(canonicalize({ b: [3, { z: 1, a: [true, null] }], a: "x" })).to.equal('{"a":"x","b":[3,{"a":[true,null],"z":1}]}');
  });
});
