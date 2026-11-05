// EVM transactions sent straight to Hedera consensus nodes (SDK EthereumTransaction) instead of through a JSON-RPC
// relay. A relay answers eth_getTransactionReceipt from the mirror node, which lags consensus by seconds, and its
// eth_sendRawTransaction itself polls the mirror node for the result. This sender takes the receipt from a consensus
// node, so the caller knows the transaction is final the moment it is (testnet demo, step 9: the trustee's pause must
// follow the oracle's submit inside the challenge window).
//
// The bytes are the same signed EIP-1559 transaction the RPC path sends (signed by the relayer wallet; chainId, nonce,
// gas limit, fee cap), so the Ethereum hash is keccak256(raw) as usual. The relayer's Hedera account is also the payer
// of the EthereumTransaction (D16: the relayer pays; the oracle key never pays). The nonce comes from the consensus
// node's account info, not from the relay. Written and unit-tested with stubbed SDK calls (test/hederaEvm.test.ts).
// STATUS: mock-tested only, NOT testnet-verified, OFF by default (evm.transport "relay"). Not used in the testnet demo:
// the owner kept the proven relay path there (2026-10-27).
import { Transaction as EthTx, type Contract, type Provider, type Wallet } from "ethers";
import { decodeRevert } from "./chain.js";
import { log } from "./log.js";
import type { SendResult } from "./submit.js";

/** What send() needs from an EVM sender once the call has simulated and its gas is known. */
export interface EvmSender {
  readonly kind: "relay" | "hedera-sdk";
  send(contract: Contract, method: string, args: unknown[], gasLimit: bigint): Promise<SendResult>;
}

/** The SDK calls the Hedera sender makes (stubbed in the tests). */
export type HederaEvmDeps = {
  /** The relayer's ethereum nonce from a consensus node (AccountInfoQuery). */
  nonce(): Promise<number>;
  /** EthereumTransaction(raw) paid by the relayer; the receipt status from a consensus node (no exception on failure). */
  submit(raw: Uint8Array): Promise<{ status: string; transactionId: string }>;
  /** The transaction record from a consensus node: gas used, consensus time, revert data. */
  record(transactionId: string): Promise<{ gasUsed?: bigint; consensusTimestamp?: string; errorMessage?: string | null }>;
};

/** Fee cap = gas price × 1.2: the network charges its current price; the cap only absorbs a price move. */
const FEE_CAP_NUM = 12n;
const FEE_CAP_DEN = 10n;

export class HederaEvmSender implements EvmSender {
  readonly kind = "hedera-sdk" as const;
  constructor(
    private readonly wallet: Wallet,
    private readonly provider: Provider,
    private readonly chainId: bigint,
    private readonly d: HederaEvmDeps,
  ) {}

  async send(contract: Contract, method: string, args: unknown[], gasLimit: bigint): Promise<SendResult> {
    const to = await contract.getAddress();
    const data = contract.interface.encodeFunctionData(method, args);
    const price = (await this.provider.getFeeData()).gasPrice;
    if (!price) throw new Error("the RPC returned no gas price");
    const raw = await this.wallet.signTransaction({
      type: 2,
      chainId: this.chainId,
      nonce: await this.d.nonce(),
      to,
      data,
      value: 0n,
      gasLimit,
      maxFeePerGas: (price * FEE_CAP_NUM) / FEE_CAP_DEN,
      maxPriorityFeePerGas: 0n,
    });
    const hash = EthTx.from(raw).hash!;
    const r = await this.d.submit(Uint8Array.from(Buffer.from(raw.slice(2), "hex")));
    // Logged BEFORE the record query, so a supervisor watching this line can act at once (the line is the signal).
    log.info(`${method}: consensus receipt ${r.status}`, { hash, transactionId: r.transactionId, via: "hedera-sdk" });
    const rec = await this.d.record(r.transactionId).catch((e: Error) => {
      log.warn(`${method}: record query failed (${e.message}); gas used unknown`, { hash });
      return {} as Awaited<ReturnType<HederaEvmDeps["record"]>>;
    });
    if (r.status === "SUCCESS") return { kind: "mined", hash, gasUsed: rec.gasUsed ?? 0n, gasLimit };
    const revert = rec.errorMessage && /^0x[0-9a-fA-F]{8}/.test(rec.errorMessage) ? decodeRevert({ data: rec.errorMessage }) : { name: "unknown" as const, message: `${r.status}${rec.errorMessage ? `: ${rec.errorMessage}` : ""}` };
    return { kind: "reverted", hash, error: revert };
  }
}

/** The real sender: SDK client with the relayer as operator (payer) on `network`. */
export async function hederaEvmSender(args: { network: "testnet" | "mainnet"; payerAccountId: string; wallet: Wallet; provider: Provider; chainId: bigint }): Promise<HederaEvmSender> {
  const sdk = await import("@hashgraph/sdk");
  const key = sdk.PrivateKey.fromStringECDSA(args.wallet.privateKey.replace(/^0x/, ""));
  const payer = sdk.AccountId.fromString(args.payerAccountId);
  const client = (args.network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet()).setOperator(payer, key);
  return new HederaEvmSender(args.wallet, args.provider, args.chainId, {
    nonce: async () => Number((await new sdk.AccountInfoQuery().setAccountId(payer).execute(client)).ethereumNonce ?? 0),
    submit: async (raw) => {
      const resp = await new sdk.EthereumTransaction().setEthereumData(raw).execute(client);
      const receipt = await new sdk.TransactionReceiptQuery().setTransactionId(resp.transactionId).setValidateStatus(false).execute(client);
      return { status: receipt.status.toString(), transactionId: resp.transactionId.toString() };
    },
    record: async (id) => {
      const rec = await new sdk.TransactionRecordQuery().setTransactionId(sdk.TransactionId.fromString(id)).setValidateReceiptStatus(false).execute(client);
      const fr = rec.contractFunctionResult;
      return {
        gasUsed: fr ? BigInt(fr.gasUsed.toString()) : undefined,
        consensusTimestamp: rec.consensusTimestamp.toString(),
        errorMessage: fr?.errorMessage ?? null,
      };
    },
  });
}
