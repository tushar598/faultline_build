// Custom-error decoding from the shapes ethers / Hardhat / Hashio produce, and the "already handled" classification.
import { describe, expect, it } from "vitest";
import { TRIGGER_IFACE, decodeRevert, errorText, txLink } from "../src/chain.js";
import { classify } from "../src/submit.js";

const ID = "0x" + "ab".repeat(32);
const finalised = TRIGGER_IFACE.encodeErrorResult("EventFinalised", [ID, 3]);
const stale = TRIGGER_IFACE.encodeErrorResult("StaleRevision", []);
const outside = TRIGGER_IFACE.encodeErrorResult("ObservedOutsideRiskPeriod", [123n]);

describe("decodeRevert", () => {
  it.each([
    ["ethers CALL_EXCEPTION (err.data)", { code: "CALL_EXCEPTION", data: finalised }],
    ["JSON-RPC error inside info", { info: { error: { code: 3, data: finalised } } }],
    ["nested provider error (Hardhat node over HTTP)", { error: { error: { data: finalised } } }],
    ["only in the message text", { message: `execution reverted, return data: ${finalised}` }],
  ])("%s → EventFinalised(eventId, 3)", (_n, err) => {
    expect(decodeRevert(err)).toEqual({ name: "EventFinalised", args: [ID, "3"] });
  });
  it("Hardhat's 'reverted with custom error' message without data", () => {
    expect(decodeRevert({ message: "VM Exception while processing transaction: reverted with custom error 'StaleRevision()'" }).name).toBe("StaleRevision");
  });
  it("unknown errors keep a short message", () => {
    const d = decodeRevert({ shortMessage: "insufficient funds" });
    expect(d).toEqual({ name: "unknown", message: "insufficient funds" });
    expect(errorText(d)).toBe("unknown error: insufficient funds");
  });
  it("EventFinalised and StaleRevision are 'already handled'; other reverts are real errors", () => {
    expect(classify(decodeRevert({ data: finalised })).alreadyHandled).toBe(true);
    expect(classify(decodeRevert({ data: stale })).alreadyHandled).toBe(true);
    const o = decodeRevert({ data: outside });
    expect(classify(o).alreadyHandled).toBe(false);
    expect(errorText(o)).toBe("ObservedOutsideRiskPeriod(123)");
  });
});

describe("explorer links", () => {
  it("HashScan on 296 / 295, none on the local chain", () => {
    expect(txLink(296n, "0xabc")).toBe("https://hashscan.io/testnet/transaction/0xabc");
    expect(txLink(295, "0xabc")).toBe("https://hashscan.io/mainnet/transaction/0xabc");
    expect(txLink(31337n, "0xabc")).toBeUndefined();
  });
});
