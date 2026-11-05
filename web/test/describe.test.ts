import { describe, expect, it } from "vitest";
import { describeLog } from "@/lib/describe";
import type { LogEntry } from "@/lib/types";

const log = (name: string, args: Record<string, unknown>, contract: LogEntry["contract"] = "pool"): LogEntry => ({ contract, name, args, blockNumber: 1, txHash: "0x", logIndex: 0, timestamp: null });

describe("activity descriptions use the event arguments verbatim", () => {
  it("write-down and payouts", () => {
    expect(describeLog(log("LossApplied", { previousBps: 0n, newBps: 7000n, sponsorCredit: 7_000_000_000n }))).toBe("Loss index raised from 0 bps to 7,000 bps; sponsor credited 7,000.000000 USD");
    expect(describeLog(log("Redeemed", { holder: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", units: 5_000_000_000n, principal: 1_500_000_000n, coupon: 29_589_060n }))).toBe(
      "0x9965…A4dc redeemed 5,000.000000 units: 1,500.000000 USD principal + 29.589060 USD coupon credited",
    );
  });
  it("trigger events name the USGS id when known", () => {
    const names = new Map([["0xabc", "usp000a8ds"]]);
    expect(describeLog(log("EventExecuted", { eventId: "0xabc", lossBps: 7000n, newCumulativeBps: 7000n }, "trigger"), names)).toBe("usp000a8ds executed: 7,000 bps applied, loss index now 7,000 bps");
  });
  it("bond transfers: mint, burn, transfer", () => {
    const z = "0x0000000000000000000000000000000000000000";
    const a = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
    expect(describeLog(log("Transfer", { from: z, to: a, value: 1n }, "bond"))).toBe("Bond mint: 0.000001 units to 0x9965…A4dc");
    expect(describeLog(log("Transfer", { from: a, to: z, value: 1n }, "bond"))).toBe("Bond burn: 0.000001 units from 0x9965…A4dc");
  });
});
