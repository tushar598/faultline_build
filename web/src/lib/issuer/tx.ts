// Wallet transactions of the issuer page: contract calls and contract creations through src/lib/send.ts. Reads
// (simulation, gas estimate, receipt) go to the dashboard's RPC when a reader is given; the wallet only signs and sends.
import { ContractFactory, Interface, type InterfaceAbi } from "ethers";
import { sendTx, type Eip1193, type Mined, type Reader, type TxPhase } from "@/lib/send";

export { afterSend, simulate, viaRpc, type Eip1193, type Mined, type Reader, type TxPhase } from "@/lib/send";

/** Simulates, estimates, sends and waits for one contract call. Throws on a revert, a rejection or a failed receipt. */
export async function sendCall(eth: Eip1193, chainId: number, call: { address: string; abi: InterfaceAbi; method: string; args: readonly unknown[] }, onPhase?: (p: TxPhase) => void, reader?: Reader): Promise<Mined> {
  const data = new Interface(call.abi).encodeFunctionData(call.method, call.args);
  try {
    return await sendTx(eth, chainId, { to: call.address, data }, { reader, onPhase });
  } catch (e) {
    if (e instanceof Error && e.message === "The transaction failed on chain.") throw new Error(`${call.method}: the transaction failed on chain.`);
    throw e;
  }
}

/** Simulates, estimates, sends and waits for one contract creation; returns the new address with the receipt. */
export async function sendDeploy(eth: Eip1193, chainId: number, d: { abi: InterfaceAbi; bytecode: string; args: readonly unknown[] }, onPhase?: (p: TxPhase) => void, reader?: Reader): Promise<Mined & { address: string }> {
  const req = await new ContractFactory(d.abi, d.bytecode).getDeployTransaction(...d.args);
  const r = await sendTx(eth, chainId, { data: req.data }, { reader, onPhase });
  if (!r.receipt.contractAddress) throw new Error("The contract creation failed on chain.");
  return { ...r, address: r.receipt.contractAddress };
}
