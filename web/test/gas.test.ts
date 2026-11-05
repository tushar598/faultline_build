// The wallet gas limit is the estimate plus 30 % (rounded up), the same buffer the scripts and the oracle use.
import { describe, expect, it } from "vitest";
import { gasLimitFor } from "@/lib/gas";

describe("gasLimitFor", () => {
  it("adds 30 % and rounds up", () => {
    expect(gasLimitFor(291_164n)).toBe(378_514n); // smoke-run redeem estimate
    expect(gasLimitFor(10n)).toBe(13n);
    expect(gasLimitFor(1n)).toBe(2n);
  });
  it("clears the peak of the step 9 redeem that ran out of gas at its estimate", () => {
    const estimate = 311_684n; // MetaMask's limit: the transaction failed with this
    const peak = 317_337n; // gas the transaction needed at its peak (docs/LESSONS.md)
    expect(estimate).toBeLessThan(peak);
    expect(gasLimitFor(estimate)).toBe(405_190n);
    expect(gasLimitFor(estimate)).toBeGreaterThanOrEqual(peak);
  });
});
