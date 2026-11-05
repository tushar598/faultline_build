// HCS publishing (ARCHITECTURE §6.5, D16). Both publishers send utf8(JCS(message)) — at most one 1024-byte chunk —
// and return the sequence number (and consensus time when known).
//   MockHcs  appends one JSON line per message to <mockDir>/<topicId>.jsonl with a fake sequence number and consensus
//            time (local runs; the directory is gitignored).
//   RealHcs  TopicMessageSubmitTransaction with the SDK: paid by the relayer (client operator) and signed by the
//            topic's submit key = the oracle signer key (D16). Written and unit-tested with a stubbed transaction;
//            NOT run in step 6 (real HCS comes in step 9 / spike S7).
import fs from "node:fs";
import path from "node:path";
import { encodeMessage, type HcsMessage } from "../../shared/ts/hcsMessage.js";
import type { HcsRef } from "./ledger.js";

export interface HcsPublisher {
  readonly topicId: string;
  publish(m: HcsMessage): Promise<HcsRef>;
}

export type MockLine = { topicId: string; sequenceNumber: number; consensusTimestamp: string; message: string };

export class MockHcs implements HcsPublisher {
  readonly file: string;
  constructor(readonly topicId: string, dir: string) {
    this.file = path.join(dir, `${topicId}.jsonl`);
  }
  lines(): MockLine[] {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as MockLine);
  }
  async publish(m: HcsMessage): Promise<HcsRef> {
    const bytes = encodeMessage(m); // throws above 1024 bytes
    const sequenceNumber = this.lines().length + 1;
    const now = Date.now();
    const consensusTimestamp = `${Math.floor(now / 1000)}.${String((now % 1000) * 1_000_000).padStart(9, "0")}`;
    const line: MockLine = { topicId: this.topicId, sequenceNumber, consensusTimestamp, message: new TextDecoder().decode(bytes) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(line) + "\n");
    return { topicId: this.topicId, sequenceNumber: String(sequenceNumber), consensusTimestamp };
  }
}

/** The subset of the SDK the real publisher uses (lets the tests stub it without a network). */
export type SdkTopicTx = {
  setTopicId(id: string): SdkTopicTx;
  setMessage(bytes: Uint8Array): SdkTopicTx;
  freezeWith(client: unknown): SdkTopicTx;
  sign(key: unknown): Promise<SdkTopicTx>;
  execute(client: unknown): Promise<{ transactionId: { toString(): string }; getReceipt(client: unknown): Promise<{ status: { toString(): string }; topicSequenceNumber: { toString(): string } | null }> }>;
};

export type RealHcsDeps = {
  /** SDK client whose operator is the RELAYER account (pays the fee). */
  client: unknown;
  /** The topic's submit key = the oracle signer's PrivateKey (D16). */
  submitKey: unknown;
  newTx: () => SdkTopicTx;
};

export class RealHcs implements HcsPublisher {
  constructor(readonly topicId: string, private readonly d: RealHcsDeps) {}
  async publish(m: HcsMessage): Promise<HcsRef> {
    const bytes = encodeMessage(m);
    const tx = await this.d.newTx().setTopicId(this.topicId).setMessage(bytes).freezeWith(this.d.client).sign(this.d.submitKey);
    const resp = await tx.execute(this.d.client);
    const receipt = await resp.getReceipt(this.d.client); // throws on a failed status (e.g. INVALID_SIGNATURE, S5)
    if (receipt.status.toString() !== "SUCCESS" || !receipt.topicSequenceNumber) throw new Error(`HCS submit ${resp.transactionId.toString()} status ${receipt.status.toString()}`);
    return { topicId: this.topicId, sequenceNumber: receipt.topicSequenceNumber.toString() };
  }
}

/** Builds the real publisher from the SDK (only for hcs.mode "real"; never used in step 6). */
export async function realHcs(args: { topicId: string; network: "testnet" | "mainnet"; payerAccountId: string; payerKeyHex: string; submitKeyHex: string }): Promise<RealHcs> {
  const sdk = await import("@hashgraph/sdk");
  const strip = (k: string) => (k.startsWith("0x") ? k.slice(2) : k);
  const client = (args.network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet()).setOperator(
    sdk.AccountId.fromString(args.payerAccountId),
    sdk.PrivateKey.fromStringECDSA(strip(args.payerKeyHex)),
  );
  return new RealHcs(args.topicId, {
    client,
    submitKey: sdk.PrivateKey.fromStringECDSA(strip(args.submitKeyHex)),
    newTx: () => new sdk.TopicMessageSubmitTransaction() as unknown as SdkTopicTx,
  });
}
