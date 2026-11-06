// One wallet transaction, the dashboard's way: simulate, estimate and wait for the receipt on the dashboard's own read
// RPC (the relay the network state picked, with retries), and use the wallet ONLY to sign and send. On 2026-11-06 the
// issuer page's ATS deployBond (about 8M gas) failed twice through the wallet's RPC on a slow network ("RPC did not
// answer", then "missing revert data") while the same eth_call passed on Hashio every time from the dashboard side.
// Rules kept from before: the wallet must be on the page's chain (SEC-11); the exact call is simulated first so a revert
// is explained and nothing doomed is sent; gas limit = estimate x 1.3 (src/lib/gas.ts). The key never leaves the wallet.
import { BrowserProvider, type JsonRpcProvider, type TransactionReceipt } from "ethers";
import { gasLimitFor } from "@/lib/gas";

export type Eip1193 = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };
export type TxPhase = "checking" | "signing" | "pending";
export type Mined = { hash: string; receipt: TransactionReceipt; gasLimit: bigint; estimate: bigint };
/** The dashboard's read provider; only these three calls are used. */
export type Reader = Pick<JsonRpcProvider, "call" | "estimateGas" | "getTransactionReceipt">;

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

const isEmptyRevert = (e: unknown) => {
  const err = e as { code?: unknown; data?: unknown; message?: unknown };
  return err?.code === "CALL_EXCEPTION" && (err.data === null || err.data === undefined || err.data === "0x") && /missing revert data/i.test(String(err.message ?? ""));
};
const isNetworkMessage = (e: unknown) => /did not answer/.test(String((e as { message?: unknown })?.message ?? ""));

/**
 * The simulation, retried for a network failure or a revert WITHOUT data: Hedera relays sometimes fail a heavy eth_call
 * that passes seconds later. Nothing is sent, so a retry is free. An HTS facade failure also reverts with empty data
 * (spike S3): after the retries the message names both causes. A revert with data is never retried.
 */
export async function simulate<T>(run: () => Promise<T>, which: "wallet" | "dashboard" = "wallet", tries = 3, delayMs = 3000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await viaRpc(which, run);
    } catch (e) {
      if (!isEmptyRevert(e) && !isNetworkMessage(e)) throw e;
      if (i >= tries) {
        if (isNetworkMessage(e)) throw e;
        throw new Error(
          `The simulation failed ${tries} times without a reason (no revert data); nothing was sent. Usually the RPC: check your connection, the connected account and its HBAR, then run the step again. If it repeats, a token rule may be failing (HTS reverts carry no data).`,
        );
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Once a transaction is out, a failed receipt read must not look like "nothing was sent": running the step again could
 *  send it twice (a second ATS bond costs about 9 HBAR). */
export async function afterSend<T>(hash: string, wait: () => Promise<T>): Promise<T> {
  try {
    return await wait();
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    if (/CALL_EXCEPTION|reverted|status/i.test(msg)) throw e;
    throw new Error(`Transaction ${hash} was sent, but its receipt could not be read. Look it up on HashScan before running this step again.`);
  }
}

/** Polls the receipt on the read RPC, tolerating failed polls, for up to `timeoutMs`. */
export async function waitReceipt(reader: Reader, hash: string, timeoutMs = 300_000, everyMs = 2_500): Promise<TransactionReceipt> {
  const until = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < until) {
    try {
      const r = await reader.getTransactionReceipt(hash);
      if (r) return r;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`no receipt after ${Math.round(timeoutMs / 1000)} s${lastError ? ` (last error: ${String((lastError as Error).message ?? lastError).slice(0, 120)})` : ""}`);
}

async function walletSigner(eth: Eip1193, chainId: number) {
  const have = Number(await eth.request({ method: "eth_chainId" }));
  if (have !== chainId) throw new Error(`The wallet is on chain ${have}, not ${chainId}. Switch the wallet to this dashboard's network.`);
  return new BrowserProvider(eth).getSigner();
}

/**
 * Simulates (with `from` = the wallet), estimates, has the wallet sign and send, and waits for the receipt. `to` absent
 * = a contract creation. With `reader` every read goes to the dashboard's RPC; without, to the wallet's.
 */
export async function sendTx(eth: Eip1193, chainId: number, tx: { to?: string; data: string }, opts: { reader?: Reader; onPhase?: (p: TxPhase) => void } = {}): Promise<Mined> {
  const signer = await walletSigner(eth, chainId);
  const from = await signer.getAddress();
  const which = opts.reader ? "dashboard" : "wallet";
  const reads: Reader = opts.reader ?? (signer.provider as unknown as Reader);
  const req = { ...tx, from };
  opts.onPhase?.("checking");
  await simulate(() => reads.call(req), which);
  const estimate = await simulate(() => reads.estimateGas(req), which);
  const gasLimit = gasLimitFor(estimate);
  opts.onPhase?.("signing");
  const sent = await signer.sendTransaction({ ...tx, gasLimit });
  opts.onPhase?.("pending");
  const receipt = await afterSend<TransactionReceipt | null>(sent.hash, () => (opts.reader ? waitReceipt(opts.reader, sent.hash) : sent.wait()));
  if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on chain.");
  return { hash: receipt.hash, receipt, gasLimit, estimate };
}
