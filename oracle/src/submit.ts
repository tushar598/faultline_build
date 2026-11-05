// Relayer transactions (submit, execute): simulate with staticCall from the relayer, decode custom errors with the
// trigger ABI, send with gasLimit = estimate × 1.3 (Hedera lesson S1: the bare estimate can run out of gas), wait
// for the receipt. EventFinalised / StaleRevision mean someone already did the job: "already-handled", no retry.
// The send itself goes through the relay (default) or, with config evm.transport "hedera-sdk", straight to the consensus
// nodes (src/hederaEvm.ts; mock-tested only, not testnet-verified).
import type { Contract } from "ethers";
import { decodeRevert, errorText, type DecodedError } from "./chain.js";
import type { EvmSender } from "./hederaEvm.js";

export const ALREADY_HANDLED = new Set(["EventFinalised", "StaleRevision"]);
const GAS_BUFFER_NUM = 13n;
const GAS_BUFFER_DEN = 10n;

export type Simulation = { ok: true } | { ok: false; error: DecodedError; alreadyHandled: boolean };
export type SendResult =
  | { kind: "mined"; hash: string; gasUsed: bigint; gasLimit: bigint }
  | { kind: "not-sent"; error: DecodedError; alreadyHandled: boolean }
  | { kind: "reverted"; hash: string; error: DecodedError };

export function classify(error: DecodedError): { alreadyHandled: boolean } {
  return { alreadyHandled: ALREADY_HANDLED.has(error.name) };
}

/** `contract` must be connected to the relayer wallet. */
export async function simulate(contract: Contract, method: string, args: unknown[]): Promise<Simulation> {
  try {
    await contract.getFunction(method).staticCall(...args);
    return { ok: true };
  } catch (e) {
    const error = decodeRevert(e);
    return { ok: false, error, ...classify(error) };
  }
}

/** `contract` must be connected to the relayer wallet; `via` defaults to the relay (`contract`'s provider). */
export async function send(contract: Contract, method: string, args: unknown[], via?: EvmSender): Promise<SendResult> {
  const sim = await simulate(contract, method, args);
  if (!sim.ok) return { kind: "not-sent", error: sim.error, alreadyHandled: sim.alreadyHandled };
  const fn = contract.getFunction(method);
  const gasLimit = ((await fn.estimateGas(...args)) * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  if (via) return via.send(contract, method, args, gasLimit);
  const tx = await fn.send(...args, { gasLimit });
  try {
    const receipt = await tx.wait();
    return { kind: "mined", hash: tx.hash, gasUsed: receipt?.gasUsed ?? 0n, gasLimit };
  } catch (e) {
    return { kind: "reverted", hash: tx.hash, error: decodeRevert(e) };
  }
}

export const describe = (r: SendResult) =>
  r.kind === "mined" ? `mined ${r.hash} (gas ${r.gasUsed} of ${r.gasLimit})` : r.kind === "reverted" ? `reverted ${r.hash}: ${errorText(r.error)}` : `not sent: ${errorText(r.error)}${r.alreadyHandled ? " (already handled)" : ""}`;
