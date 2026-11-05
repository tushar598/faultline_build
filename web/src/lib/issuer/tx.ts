// Wallet transactions of the issuer page: contract calls and contract creations, each with the dashboard's rules
// (src/state/wallet.tsx): the wallet must be on the page's chain (SEC-11), the exact call is simulated first (staticCall,
// or eth_call of the creation) so a revert is explained and nothing doomed is sent, and the gas limit is the estimate
// x 1.3 (src/lib/gas.ts; Hedera relays estimate at the edge). The key never leaves the wallet.
import { BrowserProvider, Contract, ContractFactory, type InterfaceAbi, type TransactionReceipt } from "ethers";
import { gasLimitFor } from "@/lib/gas";

export type Eip1193 = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };
export type TxPhase = "checking" | "signing" | "pending";
export type Mined = { hash: string; receipt: TransactionReceipt; gasLimit: bigint; estimate: bigint };

async function signerOn(eth: Eip1193, chainId: number) {
  const have = Number(await eth.request({ method: "eth_chainId" }));
  if (have !== chainId) throw new Error(`The wallet is on chain ${have}, not ${chainId}. Switch the wallet to this dashboard's network.`);
  return new BrowserProvider(eth).getSigner();
}

/** Simulates, estimates, sends and waits for one contract call. Throws on a revert, a rejection or a failed receipt. */
export async function sendCall(eth: Eip1193, chainId: number, call: { address: string; abi: InterfaceAbi; method: string; args: readonly unknown[] }, onPhase?: (p: TxPhase) => void): Promise<Mined> {
  const signer = await signerOn(eth, chainId);
  const fn = new Contract(call.address, call.abi, signer).getFunction(call.method);
  onPhase?.("checking");
  await fn.staticCall(...call.args);
  const estimate = await fn.estimateGas(...call.args);
  const gasLimit = gasLimitFor(estimate);
  onPhase?.("signing");
  const sent = await fn(...call.args, { gasLimit });
  onPhase?.("pending");
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${call.method}: the transaction failed on chain.`);
  return { hash: receipt.hash, receipt, gasLimit, estimate };
}

/** Simulates, estimates, sends and waits for one contract creation; returns the new address with the receipt. */
export async function sendDeploy(eth: Eip1193, chainId: number, d: { abi: InterfaceAbi; bytecode: string; args: readonly unknown[] }, onPhase?: (p: TxPhase) => void): Promise<Mined & { address: string }> {
  const signer = await signerOn(eth, chainId);
  const factory = new ContractFactory(d.abi, d.bytecode, signer);
  const req = await factory.getDeployTransaction(...d.args);
  onPhase?.("checking");
  await signer.call(req);
  const estimate = await signer.estimateGas(req);
  const gasLimit = gasLimitFor(estimate);
  onPhase?.("signing");
  const sent = await signer.sendTransaction({ ...req, gasLimit });
  onPhase?.("pending");
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error("The contract creation failed on chain.");
  return { hash: receipt.hash, receipt, gasLimit, estimate, address: receipt.contractAddress };
}
