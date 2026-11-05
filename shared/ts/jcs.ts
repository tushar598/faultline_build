// RFC 8785 JSON Canonicalization Scheme (JCS) for the plain JSON values Faultline hashes (trigger terms, USGS subsets).
//
// Why: a hash covers bytes, not meaning. `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same JSON object but different
// bytes, so they hash differently. JCS fixes one byte form per value, so the same terms always give the same termsHash
// in the oracle, the tests, the deploy scripts and the dashboard.
//
// Why our own code: shared/ts may depend only on ethers. For I-JSON data, JCS is ECMAScript's JSON serialisation of
// primitives plus object keys sorted by UTF-16 code units (RFC 8785 §3.2). `JSON.stringify` already gives the required
// string escaping (§3.2.2.2: \b \t \n \f \r, other control characters as lowercase \u00xx, nothing else escaped) and
// number format (§3.2.2.3: ECMAScript Number.prototype.toString; -0 becomes 0). Tested against the RFC examples in
// test/shared.jcs.test.ts.

/** Canonical JSON text of `value` (RFC 8785). Throws on values JSON cannot represent (NaN, Infinity, bigint, ...). */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`JCS: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Array.prototype.sort without a comparator compares UTF-16 code units: exactly what RFC 8785 §3.2.3 requires.
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      if (obj[k] === undefined) throw new Error(`JCS: undefined value for key ${JSON.stringify(k)}`);
      parts.push(`${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}
