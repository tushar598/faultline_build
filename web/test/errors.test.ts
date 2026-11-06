import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { POOL_ABI, TRIGGER_ABI } from "@/lib/abi";
import { decodeError, findRevertData, plainError } from "@/lib/errors";

const pool = new Interface(POOL_ABI);
const trigger = new Interface(TRIGGER_ABI);

describe("revert data is found wherever the provider put it", () => {
  const data = pool.encodeErrorResult("EventPending", []);
  it("ethers CALL_EXCEPTION shape", () => expect(findRevertData({ code: "CALL_EXCEPTION", data })).toBe(data));
  it("nested JSON-RPC error (Hardhat over HTTP, MetaMask)", () => expect(findRevertData({ info: { error: { data: { data } } } })).toBe(data));
  it("only in the message text", () => expect(findRevertData(new Error(`execution reverted, return data: ${data}`))).toBe(data));
  it("nothing to find", () => expect(findRevertData(new Error("timeout"))).toBeUndefined());
});

describe("custom errors become plain sentences", () => {
  it("pool errors with arguments", () => {
    expect(plainError({ data: pool.encodeErrorResult("BelowMinTicket", [50_000_000n, 100_000_000n]) })).toBe("The minimum ticket is 100.000000 USD.");
    expect(plainError({ data: pool.encodeErrorResult("CapExceeded", [1n, 2_000_000n]) })).toBe("The bond cap would be exceeded: only 2.000000 USD of units are left.");
    expect(plainError({ data: pool.encodeErrorResult("NotKycForToken", ["0x0000000000000000000000000000000000000001"]) })).toBe("This wallet does not have KYC for the stablecoin.");
    expect(plainError({ data: pool.encodeErrorResult("RedemptionNotOpen", []) })).toMatch(/^Redemption is not open/);
  });
  it("trigger errors, including the shared selectors", () => {
    expect(plainError({ data: trigger.encodeErrorResult("WindowClosed", []) })).toBe("The challenge window has ended, so a veto is no longer possible.");
    expect(plainError({ data: trigger.encodeErrorResult("IsPaused", []) })).toBe("The trigger is paused.");
    expect(plainError({ data: trigger.encodeErrorResult("EventFinalised", ["0x" + "00".repeat(32), 2]) })).toBe("This event is already final (Vetoed) and cannot be submitted again.");
    expect(plainError({ data: trigger.encodeErrorResult("AccessControlUnauthorizedAccount", ["0x0000000000000000000000000000000000000001", "0x" + "00".repeat(32)]) })).toBe("This wallet does not have the role this action needs.");
  });
  it("the ATS bond's KYC error", () => {
    expect(plainError({ data: new Interface(["error InvalidKycStatus()"]).encodeErrorResult("InvalidKycStatus", []) })).toBe("This wallet does not have KYC on the bond.");
  });
  it("Hardhat's text form names the error", () => {
    expect(decodeError(new Error("VM Exception while processing transaction: reverted with custom error 'WindowOpen(123)'"))).toEqual({ kind: "contract", name: "WindowOpen", args: [] });
  });
  it("wallet rejection, unknown selector and plain failures", () => {
    expect(plainError({ code: "ACTION_REJECTED" })).toBe("You rejected the request in your wallet.");
    expect(plainError({ info: { error: { code: 4001 } } })).toBe("You rejected the request in your wallet.");
    expect(plainError({ data: "0xdeadbeef" })).toBe("The contract rejected the call (unknown error 0xdeadbeef).");
    expect(plainError(new Error("insufficient funds for gas * price + value"))).toBe("The wallet does not have enough native currency for the fee.");
    expect(plainError(new TypeError("Failed to fetch"))).toBe("The RPC endpoint did not answer.");
  });
});

describe("issuer RPC failures name the RPC (viaRpc)", () => {
  it("a wallet fetch failure says the wallet's RPC and that nothing was sent", async () => {
    const { viaRpc } = await import("../src/lib/issuer/tx");
    await expect(viaRpc("wallet", () => Promise.reject(Object.assign(new Error("could not coalesce error"), { error: { message: "Failed to fetch" } })))).rejects.toThrow(/wallet's RPC did not answer.*nothing was sent/);
    const err = await viaRpc("wallet", () => Promise.reject(new Error("Failed to fetch"))).catch((e) => e);
    expect(plainError(err)).toMatch(/wallet's RPC did not answer/);
  });
  it("a dashboard fetch failure says the dashboard's read RPC", async () => {
    const { viaRpc } = await import("../src/lib/issuer/tx");
    await expect(viaRpc("dashboard", () => Promise.reject(Object.assign(new Error("x"), { code: "NETWORK_ERROR" })))).rejects.toThrow(/dashboard's read RPC/);
  });
  it("a revert passes through unchanged", async () => {
    const { viaRpc } = await import("../src/lib/issuer/tx");
    const revert = Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION", data: "0x1234" });
    await expect(viaRpc("wallet", () => Promise.reject(revert))).rejects.toBe(revert);
  });
});

describe("viaRpc never hides a revert or a rejection", () => {
  it("a revert whose text mentions fetch stays a revert; a user rejection stays a rejection", async () => {
    const { viaRpc } = await import("../src/lib/issuer/tx");
    const revert = Object.assign(new Error("execution reverted: failed to fetch price"), { code: "CALL_EXCEPTION" });
    await expect(viaRpc("wallet", () => Promise.reject(revert))).rejects.toBe(revert);
    const rejected = Object.assign(new Error("user rejected action"), { code: "ACTION_REJECTED" });
    await expect(viaRpc("wallet", () => Promise.reject(rejected))).rejects.toBe(rejected);
  });
});

describe("simulate retries a revert without data", () => {
  const empty = () => Object.assign(new Error("missing revert data (action=\"call\", data=null)"), { code: "CALL_EXCEPTION", data: null });
  it("passes when a later try succeeds", async () => {
    const { simulate } = await import("../src/lib/issuer/tx");
    let n = 0;
    await expect(simulate(async () => (++n < 3 ? Promise.reject(empty()) : "ok"), "wallet", 3, 1)).resolves.toBe("ok");
    expect(n).toBe(3);
  });
  it("explains after the last try; nothing was sent", async () => {
    const { simulate } = await import("../src/lib/issuer/tx");
    const err = await simulate(() => Promise.reject(empty()), "wallet", 2, 1).catch((e) => e);
    expect(plainError(err)).toMatch(/failed 2 times without a reason.*nothing was sent/);
  });
  it("a revert with data is not retried", async () => {
    const { simulate } = await import("../src/lib/issuer/tx");
    let n = 0;
    const revert = Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION", data: "0x8bcdf5dc" });
    await expect(simulate(() => (n++, Promise.reject(revert)), "wallet", 3, 1)).rejects.toBe(revert);
    expect(n).toBe(1);
  });
});
