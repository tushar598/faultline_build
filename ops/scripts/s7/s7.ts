// Spike S7 — HCS topic keys for the oracle (faultline ARCHITECTURE D16):
//   submit key = oracle signer key (the oracle signs only and pays nothing),
//   admin key  = TRUSTEE key (can change the submit key and delete the topic),
//   payer      = the separate relayer account (FLH_RELAYER_PRIVATE_KEY, docs/ACCOUNTS.md), also the auto-renew account.
// Shared bits: accounts, keys from the keystore (EXECUTE only), state in out/s7-state.json, fee estimates, the sample
// message (the REAL smoke-run attestation, already accepted on chain, re-published with its in-payload signature).
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { PrivateKey } from "@hashgraph/sdk";
import { ROOT, type SignerNetwork } from "../lib/common.js";
import { operatorClient } from "../lib/hedera.js";
import { ACCOUNTS, FAULTLINE, requireShared } from "../smoke/lib.js";

export const RELAYER = { id: ACCOUNTS.relayer.id!, evm: ACCOUNTS.relayer.evm, network: "flhRelayer" as const, keyName: "FLH_RELAYER_PRIVATE_KEY" };
export const TRUSTEE = { id: ACCOUNTS.trustee.id!, evm: ACCOUNTS.trustee.evm, network: "flhTrustee" as const, keyName: "FLH_TRUSTEE_PRIVATE_KEY" };
export const ORACLE = { evm: ACCOUNTS.oracle.evm, network: "flhOracle" as const, keyName: "FLH_ORACLE_PRIVATE_KEY" };
export const TOPIC_MEMO = "faultline-spike-s7";

// Official fee table (https://docs.hedera.com/hedera/networks/mainnet/fees, read 2026-10-27): base fees; extra
// signatures add $0.00001 each above an included count the page does not state. S5 measured TopicCreate at $0.02.
export const FEE_USD = { ConsensusCreateTopic: 0.01, ConsensusUpdateTopic: 0.00022, ConsensusSubmitMessage: 0.0008 } as const;

export type HcsMsg = typeof import("../../../shared/ts/hcsMessage.js");
export const hcsMessage = () => requireShared<HcsMsg>("hcsMessage");

/** SDK client paid by the relayer (hollow until its first payment completes it). EXECUTE only. */
export const relayerClient = () => operatorClient(RELAYER.network, RELAYER.id, RELAYER.keyName, true);

/** An SDK private key from the keystore, checked to derive to `evm`. EXECUTE only; never printed. */
export async function sdkKey(network: SignerNetwork, evm: string, keyName: string): Promise<PrivateKey> {
  const net = hre.config.networks[network] as unknown as { accounts: { get(): Promise<string> }[] };
  const raw = await net.accounts[0].get();
  const key = PrivateKey.fromStringECDSA(raw.startsWith("0x") ? raw.slice(2) : raw);
  if (("0x" + key.publicKey.toEvmAddress()).toLowerCase() !== evm.toLowerCase()) throw new Error(`${keyName} does not derive to ${evm}; nothing sent`);
  return key;
}

// ---- state (topic id, sequence numbers; no secrets) ----
const STATE = path.join(ROOT, "out", "s7-state.json");
export const loadS7 = (): Record<string, unknown> => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
export function saveS7(patch: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ ...loadS7(), ...patch }, null, 2) + "\n");
}

/** The sample: the smoke run's real Bhuj attestation + oracle signature (ops/out/smoke-state.json). */
export function sampleMessage() {
  const smoke = JSON.parse(fs.readFileSync(path.join(ROOT, "out", "smoke-state.json"), "utf8"));
  const h = hcsMessage();
  const a = smoke.attestation as Record<string, string>;
  const att = { eventId: a.eventId, lossBps: BigInt(a.lossBps), magnitudeX100: BigInt(a.magnitudeX100), observedAt: BigInt(a.observedAt), usgsUpdatedAt: BigInt(a.usgsUpdatedAt), nonce: BigInt(a.nonce), termsHash: a.termsHash, dataHash: a.dataHash, deadline: BigInt(a.deadline) };
  const msg = h.attestationMessage({ chainId: 296n, trigger: smoke.trigger, terms: smoke.terms, att, signature: smoke.signature, usgsId: "usp000a8ds" });
  return { msg, bytes: h.encodeMessage(msg), trigger: smoke.trigger as string };
}
export { FAULTLINE };
