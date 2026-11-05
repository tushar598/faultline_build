// Ported from the reference repo's ops/scripts/lib/hedera.ts (2026-11-06): no spike-era issuer/investor clients; every
// SDK step names its payer client.
// Hedera SDK + mirror-node helpers for the SDK spikes (S3 HTS token, S5 HCS topic).
//
// Same safety model as common.ts:
// - DRY RUN (default): an SDK step prints the exact planned transaction and stops. SDK transactions cannot be
//   simulated, so nothing is checked on-chain and no key is touched.
// - EXECUTE=1: the payer's key is resolved from the Hardhat keystore (the owner types the password), held in memory
//   only, checked against the account's on-chain public key, and never printed or written.

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { AccountId, Client, PrivateKey, PublicKey, ReceiptStatusError, type Transaction, type TransactionReceipt } from "@hashgraph/sdk";
import { EXECUTE, ROOT, recordRejected, type SignerNetwork } from "./common.js";

export const MIRROR = "https://testnet.mirrornode.hedera.com";

/** GET a mirror-node REST path (e.g. `/api/v1/accounts/0.0.1`). Retries a few times; 404 → undefined. */
export async function mirror<T = Record<string, unknown>>(urlPath: string): Promise<T | undefined> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${MIRROR}${urlPath}`, { headers: { accept: "application/json" } });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`mirror ${urlPath}: HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

/** The account's on-chain public key; throws if the account is hollow (no key) or not ECDSA. */
export async function mirrorPublicKey(accountId: string): Promise<PublicKey> {
  const a = await mirror<{ key: { _type: string; key: string } | null }>(`/api/v1/accounts/${accountId}`);
  if (!a?.key) throw new Error(`${accountId} has no key on the mirror node (hollow account?)`);
  if (a.key._type !== "ECDSA_SECP256K1") throw new Error(`${accountId} key type is ${a.key._type}, expected ECDSA_SECP256K1`);
  return PublicKey.fromStringECDSA(a.key.key);
}

const clients = new Map<string, Client>();
/**
 * SDK client with `accountId` as operator, key from the keystore entry behind `network` (the owner types the
 * password). Only called when EXECUTE=1. The key is checked against the account's on-chain public key first; for a
 * HOLLOW account (no key yet, only with `allowHollow`) it is checked against the account's EVM address alias instead:
 * Hedera completes a hollow account when it pays a transaction signed with the matching ECDSA key
 * (docs.hedera.com/learn/core-concepts/accounts/auto-account-creation).
 */
export async function operatorClient(network: SignerNetwork, accountId: string, keyName: string, allowHollow = false): Promise<Client> {
  const cached = clients.get(accountId);
  if (cached) return cached;
  const net = hre.config.networks[network] as unknown as { accounts: { get(): Promise<string> }[] };
  const raw = await net.accounts[0].get();
  const key = PrivateKey.fromStringECDSA(raw.startsWith("0x") ? raw.slice(2) : raw);
  const acct = await mirror<{ key: unknown; evm_address: string }>(`/api/v1/accounts/${accountId}`);
  if (allowHollow && acct && acct.key === null) {
    if (("0x" + key.publicKey.toEvmAddress()).toLowerCase() !== acct.evm_address.toLowerCase()) {
      throw new Error(`keystore ${keyName} does not derive to the EVM alias of hollow ${accountId}; nothing sent`);
    }
    console.log(`  ${accountId} is hollow: this transaction should complete it (key matches its EVM alias)`);
  } else {
    const onChain = await mirrorPublicKey(accountId);
    if (key.publicKey.toStringRaw().toLowerCase() !== onChain.toStringRaw().toLowerCase()) {
      throw new Error(`keystore ${keyName} does not match the on-chain key of ${accountId}; nothing sent`);
    }
  }
  const client = Client.forTestnet().setOperator(AccountId.fromString(accountId), key);
  clients.set(accountId, client);
  console.log(`  operator (${keyName}): ${accountId}`);
  return client;
}
export function closeClient(): void {
  for (const c of clients.values()) c.close();
  clients.clear();
}

/** "0.0.x@123.456" → "0.0.x-123-456" (mirror-node transaction id format). */
function mirrorTxId(transactionId: string): string {
  const [acct, ts] = transactionId.split("@");
  return `${acct}-${ts.replace(".", "-")}`;
}

export type MirrorTx = { consensus_timestamp: string; charged_tx_fee: number; result: string; name?: string; nonce?: number };

/**
 * Append one SDK transaction to out/evidence.jsonl, with its consensus timestamp and fee from the mirror node.
 * Returns the mirror-node row (undefined if it did not show up within ~16 s).
 */
export async function recordSdk(spike: string, what: string, transactionId: string, extra: Record<string, unknown> = {}): Promise<MirrorTx | undefined> {
  const id = mirrorTxId(transactionId);
  let found: MirrorTx | undefined;
  for (let i = 0; i < 8 && !found; i++) {
    await new Promise((r) => setTimeout(r, 2000)); // the mirror node lags consensus by a few seconds
    // One transaction id can return several rows: completing a HOLLOW payer adds a CRYPTOUPDATEACCOUNT row (nonce 1,
    // fee 0, 1 ns earlier) before the submitted transaction itself, which is always nonce 0 (smoke-1, 2026-10-26).
    const rows = (await mirror<{ transactions: MirrorTx[] }>(`/api/v1/transactions/${id}`))?.transactions ?? [];
    found = rows.find((r) => r.nonce === 0) ?? rows[0];
  }
  const line = {
    date: new Date().toISOString(),
    spike,
    what,
    transactionId,
    hashscan: `https://hashscan.io/testnet/transaction/${found?.consensus_timestamp ?? id}`,
    mirrorResult: found?.result ?? "not on mirror node yet",
    chargedHbar: found ? found.charged_tx_fee / 1e8 : undefined,
    ...extra,
  };
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  fs.appendFileSync(path.join(ROOT, "out", "evidence.jsonl"), JSON.stringify(line) + "\n");
  console.log(`  evidence: ${line.hashscan}  (fee ${line.chargedHbar ?? "?"} HBAR)`);
  return found;
}

/**
 * One SDK transaction, paid and signed by `payer` through `client` (e.g. the deployer, which holds the fUSD keys).
 * DRY RUN: prints `plan` and returns undefined. EXECUTE=1: sends, waits for the receipt, records evidence.
 * A failed receipt is recorded as evidence too, then rethrown.
 */
export async function sdkStep(opts: {
  spike: string;
  what: string;
  plan: Record<string, unknown>;
  /** Builds the transaction; may freeze it with `client` and add signatures (e.g. an admin or submit key). */
  build: (client: Client) => Transaction | Promise<Transaction>;
  /** Payer/signer label and client (required: there is no default payer). */
  payer: string;
  client: () => Promise<Client>;
}): Promise<TransactionReceipt | undefined> {
  console.log(`\n[${opts.spike}] ${opts.what}  (SDK; payer and signer: ${opts.payer})`);
  for (const [k, v] of Object.entries(opts.plan)) console.log(`  ${k}: ${String(v)}`);
  if (!EXECUTE) {
    console.log("  (dry run — SDK transactions cannot be simulated; nothing sent; rerun with EXECUTE=1 after the owner's OK)");
    return undefined;
  }
  const client = await opts.client();
  let resp;
  try {
    resp = await (await opts.build(client)).execute(client);
  } catch (err) {
    recordRejected(opts.spike, opts.what, err, { payer: opts.payer });
    throw err;
  }
  const txId = resp.transactionId.toString();
  console.log(`  sent: ${txId}`);
  try {
    const receipt = await resp.getReceipt(client);
    console.log(`  status: ${receipt.status.toString()}`);
    await recordSdk(opts.spike, opts.what, txId, { status: receipt.status.toString() });
    return receipt;
  } catch (err) {
    const status = err instanceof ReceiptStatusError ? err.status.toString() : (err as Error).message;
    console.log(`  status: FAILED → ${status}`);
    await recordSdk(opts.spike, `FAILED: ${opts.what}`, txId, { status: "FAILED", error: status });
    throw err;
  }
}

/** Current HBAR price from the mirror node's exchange-rate file (for converting USD fees). */
export async function usdPerHbar(): Promise<number> {
  const r = await mirror<{ current_rate: { cent_equivalent: number; hbar_equivalent: number } }>("/api/v1/network/exchangerate");
  return r!.current_rate.cent_equivalent / r!.current_rate.hbar_equivalent / 100;
}
