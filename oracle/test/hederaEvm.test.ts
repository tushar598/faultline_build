// The Hedera consensus-node EVM sender (src/hederaEvm.ts) against stubbed SDK calls: the signed bytes are the usual
// EIP-1559 transaction (relayer, chainId, consensus nonce, gas limit, fee cap), the receipt line is logged before the
// record query, and failure statuses become decoded reverts.
import { Contract, Transaction, Wallet, keccak256, type Provider } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIGGER_ABI } from "../src/abi.js";
import { TRIGGER_IFACE } from "../src/chain.js";
import { HederaEvmSender, type HederaEvmDeps } from "../src/hederaEvm.js";

const TRIGGER = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const ID = "0x" + "ab".repeat(32);
const relayer = new Wallet(Wallet.createRandom().privateKey);
const provider = { getFeeData: async () => ({ gasPrice: 1_170_000_000_000n }) } as unknown as Provider;
const trigger = new Contract(TRIGGER, TRIGGER_ABI);

function deps(over: Partial<HederaEvmDeps> = {}) {
  const calls: string[] = [];
  const sent: Uint8Array[] = [];
  const d: HederaEvmDeps = {
    nonce: async () => (calls.push("nonce"), 7),
    submit: async (raw) => (calls.push("submit"), sent.push(raw), { status: "SUCCESS", transactionId: "0.0.11183040@1793120000.000000001" }),
    record: async () => (calls.push("record"), { gasUsed: 52_000n, consensusTimestamp: "1793120003.000000002", errorMessage: null }),
    ...over,
  };
  return { d, calls, sent };
}
afterEach(() => vi.restoreAllMocks());

describe("HederaEvmSender", () => {
  it("submits the relayer's signed EIP-1559 transaction with the consensus nonce; the hash is keccak256(raw)", async () => {
    const { d, sent } = deps();
    const r = await new HederaEvmSender(relayer, provider, 296n, d).send(trigger, "execute", [ID], 190_000n);
    expect(sent).toHaveLength(1);
    const raw = "0x" + Buffer.from(sent[0]!).toString("hex");
    const tx = Transaction.from(raw);
    expect(tx.type).toBe(2);
    expect(tx.from).toBe(relayer.address);
    expect([tx.to, tx.chainId, tx.nonce, tx.gasLimit, tx.value]).toEqual([TRIGGER, 296n, 7, 190_000n, 0n]);
    expect(tx.data).toBe(TRIGGER_IFACE.encodeFunctionData("execute", [ID]));
    expect([tx.maxFeePerGas, tx.maxPriorityFeePerGas]).toEqual([1_404_000_000_000n, 0n]); // gas price × 1.2, no tip
    expect(r).toEqual({ kind: "mined", hash: keccak256(raw), gasUsed: 52_000n, gasLimit: 190_000n });
  });
  it("logs the consensus receipt line BEFORE it queries the record (a supervisor acts on that line)", async () => {
    const { d, calls } = deps();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => void (lines.push(l), calls.push("log")));
    await new HederaEvmSender(relayer, provider, 296n, d).send(trigger, "submit", [{ eventId: ID, lossBps: 1, magnitudeX100: 700, observedAt: 1, usgsUpdatedAt: 1, nonce: 1, termsHash: ID, dataHash: ID, deadline: 1 }, "0x"], 200_000n);
    expect(calls).toEqual(["nonce", "submit", "log", "record"]);
    expect(lines[0]).toMatch(/INFO  submit: consensus receipt SUCCESS .*"via":"hedera-sdk"/);
  });
  it("a reverted status decodes the record's revert data", async () => {
    const data = TRIGGER_IFACE.encodeErrorResult("EventFinalised", [ID, 2]);
    const { d } = deps({ submit: async () => ({ status: "CONTRACT_REVERT_EXECUTED", transactionId: "0.0.1@1.2" }), record: async () => ({ errorMessage: data }) });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await new HederaEvmSender(relayer, provider, 296n, d).send(trigger, "execute", [ID], 100_000n);
    expect(r).toMatchObject({ kind: "reverted", error: { name: "EventFinalised", args: [ID, "2"] } });
  });
  it("a failed status without revert data keeps the status text; a failed record query does not hide a SUCCESS", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gas = deps({ submit: async () => ({ status: "INSUFFICIENT_GAS", transactionId: "0.0.1@1.2" }), record: async () => ({ errorMessage: null }) });
    expect(await new HederaEvmSender(relayer, provider, 296n, gas.d).send(trigger, "execute", [ID], 1n)).toMatchObject({ kind: "reverted", error: { name: "unknown", message: "INSUFFICIENT_GAS" } });
    const noRecord = deps({ record: async () => Promise.reject(new Error("BUSY")) });
    expect(await new HederaEvmSender(relayer, provider, 296n, noRecord.d).send(trigger, "execute", [ID], 1n)).toMatchObject({ kind: "mined", gasUsed: 0n });
  });
  it("refuses to sign without a gas price", async () => {
    const none = { getFeeData: async () => ({ gasPrice: null }) } as unknown as Provider;
    await expect(new HederaEvmSender(relayer, none, 296n, deps().d).send(trigger, "execute", [ID], 1n)).rejects.toThrow(/no gas price/);
  });
});
