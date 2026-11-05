import { describe, expect, it } from "vitest";
import { consensusSeconds, formatAmount, formatBps, formatClock, formatDuration, formatHbar, formatMagnitude, formatUnits, formatUsd, formatUtc, parseUsd, shortHex } from "@/lib/format";

describe("amounts (6 decimals, truncated, never rounded up)", () => {
  it("formats base units with grouping and units", () => {
    expect(formatAmount(1_234_567_890n)).toBe("1,234.567890");
    expect(formatUsd(180_000_664n)).toBe("180.000664 USD");
    expect(formatUnits(5_000_000_000n)).toBe("5,000.000000 units");
    expect(formatAmount(0n)).toBe("0.000000");
    expect(formatAmount(-1n)).toBe("-0.000001");
    expect(formatAmount(1_999_999n, 2)).toBe("1.99");
    expect(formatAmount(7n, 0)).toBe("0");
  });
  it("parses typed amounts into base units", () => {
    expect(parseUsd("1,000.5")).toBe(1_000_500_000n);
    expect(parseUsd("100")).toBe(100_000_000n);
    expect(parseUsd("0.000001")).toBe(1n);
    expect(parseUsd(" 2. ")).toBe(2_000_000n);
    for (const bad of ["", "abc", "1.0000001", "-5", "1e6", "1.2.3"]) expect(parseUsd(bad)).toBeNull();
  });
  it("tinybar to HBAR", () => {
    expect(formatHbar(3_514_000_000n)).toBe("35.14000000 HBAR");
  });
});

describe("bps, magnitude, durations, time", () => {
  it("bps and magnitude", () => {
    expect(formatBps(7000)).toBe("7,000 bps");
    expect(formatBps(7000n, true)).toBe("7,000 bps (70.00%)");
    expect(formatMagnitude(770)).toBe("M7.70");
  });
  it("durations drop zero units; the clock folds days into hours", () => {
    expect(formatDuration(172_800)).toBe("2d");
    expect(formatDuration(21_600)).toBe("6h");
    expect(formatDuration(3_725)).toBe("1h 2m 5s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatClock(59)).toBe("00:00:59");
    expect(formatClock(172_800)).toBe("48:00:00");
  });
  it("UTC timestamps and HCS consensus times", () => {
    expect(formatUtc(980_478_999)).toBe("2001-01-26 03:16:39 UTC");
    expect(formatUtc(Number.NaN)).toBe("Invalid time");
    expect(consensusSeconds("1793046713.785000000")).toBe(1_793_046_713);
    expect(shortHex("0xA4C8f56FA4De893dA948952223a0783923647cCc")).toBe("0xA4C8…7cCc");
  });
});
