// Wallet transactions of the issuer page: contract calls and contract creations, each with the dashboard's rules
// (src/state/wallet.tsx): the wallet must be on the page's chain (SEC-11), the exact call is simulated first (staticCall,
// or eth_call of the creation) so a revert is explained and nothing doomed is sent, and the gas limit is the estimate
// x 1.3 (src/lib/gas.ts; Hedera relays estimate at the edge). The key never leaves the wallet.
import { BrowserProvider, Contract, ContractFactory, type InterfaceAbi, type TransactionReceipt } from "ethers";
import { gasLimitFor } from "@/lib/gas";

export type Eip1193 = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };
export type TxPhase = "checking" | "signing" | "pending";
export type Mined = { hash: string; receipt: TransactionReceipt; gasLimit: bigint; estimate: bigint };

const NETWORK_FAILURE = /failed to fetch|fetch failed|networkerror|econnrefused|could not detect network|timed out|socket hang up|bad gateway|service unavailable|gateway timeout/i;

/** Names the RPC behind a network failure: the wallet's own network settings, or the dashboard's read relay. Other
 *  errors (reverts, rejections) pass through unchanged so plainError still decodes them. */
export async function viaRpc<T>(which: "wallet" | "dashboard", run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const err = e as { message?: unknown; code?: unknown; data?: unknown; error?: { message?: unknown } };
    // A revert (CALL_EXCEPTION, revert data) is never a network failure, whatever its text holds.
    if (err?.code === "CALL_EXCEPTION" || err?.code === "ACTION_REJECTED" || typeof err?.data === "string") throw e;
    const text = [err?.message, err?.error?.message].map(String).join(" ");
    if (!NETWORK_FAILURE.test(text) && err?.code !== "NETWORK_ERROR" && err?.code !== "TIMEOUT") throw e;
    throw new Error(
      which === "wallet"
        ? "Your wallet's RPC did not answer. Check the RPC URL of this network in the wallet (Hedera testnet: https://testnet.hashio.io/api) and run the step again; nothing was sent."
        : "The dashboard's read RPC did not answer. Run the step again in a moment; nothing was sent.",
    );
  }
}

/** Once a transaction is out, a failed receipt read must not look like "nothing was sent": running the step again could
 *  send it twice (a second ATS bond costs about 9 HBAR). */
async function afterSend<T>(hash: string, wait: () => Promise<T>): Promise<T> {
  try {
    return await wait();
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    if (/CALL_EXCEPTION|reverted|status/i.test(msg)) throw e;
    throw new Error(`Transaction ${hash} was sent, but its receipt could not be read. Look it up on HashScan before running this step again.`);
  }
}

const isEmptyRevert = (e: unknown) => {
  const err = e as { code?: unknown; data?: unknown; message?: unknown };
  return err?.code === "CALL_EXCEPTION" && (err.data === null || err.data === undefined || err.data === "0x") && /missing revert data/i.test(String(err.message ?? ""));
};

/**
 * Simulation with retries for a failure WITHOUT revert data. Hedera relays sometimes fail a heavy eth_call (an ATS
 * deployBond is about 8M gas) with no data, and the same call passes seconds later (2026-11-06: thirdweb, then both relays
 * OK). Nothing is sent, so a retry is free. An HTS facade failure also reverts with empty data (spike S3): after the
 * retries the message says both causes.
 */
export async function simulate<T>(run: () => Promise<T>, tries = 3, delayMs = 3000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await viaRpc("wallet", run);
    } catch (e) {
      if (!isEmptyRevert(e)) throw e;
      if (i >= tries)
        throw new Error(
          `The simulation failed ${tries} times without a reason (no revert data); nothing was sent. Usually the wallet's RPC: set it to https://testnet.hashio.io/api, check the connected account and its HBAR, then run the step again. If it repeats, a token rule may be failing (HTS reverts carry no data).`,
        );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

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
  await simulate(() => fn.staticCall(...call.args));
  const estimate = await viaRpc("wallet", () => fn.estimateGas(...call.args));
  const gasLimit = gasLimitFor(estimate);
  onPhase?.("signing");
  const sent = await fn(...call.args, { gasLimit });
  onPhase?.("pending");
  const receipt = await afterSend<TransactionReceipt | null>(sent.hash, () => sent.wait());
  if (!receipt || receipt.status !== 1) throw new Error(`${call.method}: the transaction failed on chain.`);
  return { hash: receipt.hash, receipt, gasLimit, estimate };
}

/** Simulates, estimates, sends and waits for one contract creation; returns the new address with the receipt. */
export async function sendDeploy(eth: Eip1193, chainId: number, d: { abi: InterfaceAbi; bytecode: string; args: readonly unknown[] }, onPhase?: (p: TxPhase) => void): Promise<Mined & { address: string }> {
  const signer = await signerOn(eth, chainId);
  const factory = new ContractFactory(d.abi, d.bytecode, signer);
  const req = await factory.getDeployTransaction(...d.args);
  onPhase?.("checking");
  await simulate(() => signer.call(req));
  const estimate = await viaRpc("wallet", () => signer.estimateGas(req));
  const gasLimit = gasLimitFor(estimate);
  onPhase?.("signing");
  const sent = await signer.sendTransaction({ ...req, gasLimit });
  onPhase?.("pending");
  const receipt = await afterSend<TransactionReceipt | null>(sent.hash, () => sent.wait());
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error("The contract creation failed on chain.");
  return { hash: receipt.hash, receipt, gasLimit, estimate, address: receipt.contractAddress };
}
