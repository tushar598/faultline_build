// HCS message format (ARCHITECTURE §6.5, D15, D16) shared by the oracle (publish), the dashboard and the testnet spikes
// (read back + verify). Every message carries the oracle's signature INSIDE the payload (D16):
//   faultline.attestation — the EIP-712 signature the trigger checks (over the attestation, bound to chainId + trigger)
//   faultline.advisory    — an EIP-191 signature over utf8(JCS(message without "signature"))
// The bytes on HCS are utf8(JCS(message)) and must fit one 1024-byte chunk. No personal data: hashes and USGS ids only.
// Only dependency: ethers.
import { getAddress, verifyMessage, verifyTypedData, type Signer } from "ethers";
import { ATTESTATION_TYPES, attestationDomain, type Attestation, type Terms } from "./attestation";
import { canonicalize } from "./jcs";

/** One HCS chunk (S5: larger messages split into several sequence numbers). */
export const HCS_MAX_BYTES = 1024;
export const ADVISORY_ACTION = "trustee should veto";

/** Attestation fields as JSON numbers (all are safe integers) plus the two hashes. */
export type AttestationJson = {
  eventId: string;
  lossBps: number;
  magnitudeX100: number;
  observedAt: number;
  usgsUpdatedAt: number;
  nonce: number;
  termsHash: string;
  dataHash: string;
  deadline: number;
};

export type AttestationMessage = {
  v: 1;
  kind: "faultline.attestation";
  chainId: number;
  trigger: string;
  mode: Terms["mode"];
  timeOffsetSec: number;
  attestation: AttestationJson;
  signature: string;
  usgsId: string;
};

/** Why a pending event no longer passes the rule (shared/ts Rejection reasons, cooling excluded; or its observedAt left the
 *  bond's risk period) or vanished. */
export type AdvisoryReason = "status" | "type" | "magType" | "box" | "depth" | "belowFloor" | "outsideRiskPeriod" | "deleted" | "not-found";

export type AdvisoryMessage = {
  v: 1;
  kind: "faultline.advisory";
  chainId: number;
  trigger: string;
  eventId: string;
  usgsId: string;
  reason: AdvisoryReason;
  /** dataHash of the new USGS record; null when the record is gone (deleted / not found). */
  dataHash: string | null;
  action: typeof ADVISORY_ACTION;
  signature: string;
};

export type HcsMessage = AttestationMessage | AdvisoryMessage;

function safe(x: bigint, field: string): number {
  const n = Number(x);
  if (!Number.isSafeInteger(n) || BigInt(n) !== x) throw new Error(`${field} ${x} is not a safe integer`);
  return n;
}

/** The §6.5 attestation message for a signed attestation. */
export function attestationMessage(args: { chainId: bigint; trigger: string; terms: Terms; att: Attestation; signature: string; usgsId: string }): AttestationMessage {
  const a = args.att;
  return {
    v: 1,
    kind: "faultline.attestation",
    chainId: safe(args.chainId, "chainId"),
    trigger: getAddress(args.trigger),
    mode: args.terms.mode,
    timeOffsetSec: args.terms.timeOffsetSec,
    attestation: {
      eventId: a.eventId,
      lossBps: safe(a.lossBps, "lossBps"),
      magnitudeX100: safe(a.magnitudeX100, "magnitudeX100"),
      observedAt: safe(a.observedAt, "observedAt"),
      usgsUpdatedAt: safe(a.usgsUpdatedAt, "usgsUpdatedAt"),
      nonce: safe(a.nonce, "nonce"),
      termsHash: a.termsHash,
      dataHash: a.dataHash,
      deadline: safe(a.deadline, "deadline"),
    },
    signature: args.signature,
    usgsId: args.usgsId,
  };
}

/** The attestation struct (bigints) carried by an attestation message. */
export function attestationOf(m: AttestationMessage): Attestation {
  const a = m.attestation;
  return {
    eventId: a.eventId,
    lossBps: BigInt(a.lossBps),
    magnitudeX100: BigInt(a.magnitudeX100),
    observedAt: BigInt(a.observedAt),
    usgsUpdatedAt: BigInt(a.usgsUpdatedAt),
    nonce: BigInt(a.nonce),
    termsHash: a.termsHash,
    dataHash: a.dataHash,
    deadline: BigInt(a.deadline),
  };
}

/** The exact bytes an advisory signature covers: utf8(JCS(message without "signature")). */
export function advisorySigningBytes(m: Omit<AdvisoryMessage, "signature">): Uint8Array {
  const { signature: _ignored, ...payload } = m as AdvisoryMessage;
  return new TextEncoder().encode(canonicalize(payload));
}

/** Builds and signs (EIP-191, oracle key) an advisory message (D15). */
export async function signedAdvisory(
  signer: Signer,
  args: { chainId: bigint; trigger: string; eventId: string; usgsId: string; reason: AdvisoryReason; dataHash: string | null },
): Promise<AdvisoryMessage> {
  const payload: Omit<AdvisoryMessage, "signature"> = {
    v: 1,
    kind: "faultline.advisory",
    chainId: safe(args.chainId, "chainId"),
    trigger: getAddress(args.trigger),
    eventId: args.eventId,
    usgsId: args.usgsId,
    reason: args.reason,
    dataHash: args.dataHash,
    action: ADVISORY_ACTION,
  };
  return { ...payload, signature: await signer.signMessage(advisorySigningBytes(payload)) };
}

/** utf8(JCS(message)); throws if it does not fit one HCS chunk. */
export function encodeMessage(m: HcsMessage): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalize(m));
  if (bytes.length > HCS_MAX_BYTES) throw new Error(`HCS message is ${bytes.length} bytes (> ${HCS_MAX_BYTES})`);
  return bytes;
}

/** Parses HCS bytes or text back into a message (shape-checked by kind; callers verify the signature). */
export function decodeMessage(data: Uint8Array | string): HcsMessage {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  const m = JSON.parse(text) as HcsMessage;
  if (m?.v !== 1 || (m.kind !== "faultline.attestation" && m.kind !== "faultline.advisory")) throw new Error("not a Faultline HCS message");
  return m;
}

/** Address that signed the message's in-payload signature (EIP-712 for attestations, EIP-191 for advisories).
 *  Compare it with trigger.oracle(); the on-chain trigger, not HCS, is the source of truth. */
export function recoverMessageSigner(m: HcsMessage): string {
  if (m.kind === "faultline.attestation") {
    return verifyTypedData(attestationDomain(BigInt(m.chainId), m.trigger), ATTESTATION_TYPES, attestationOf(m), m.signature);
  }
  return verifyMessage(advisorySigningBytes(m), m.signature);
}

/** True when the in-payload signature was made by `oracle`. */
export function verifyMessageSigner(m: HcsMessage, oracle: string): boolean {
  try {
    return recoverMessageSigner(m).toLowerCase() === oracle.toLowerCase();
  } catch {
    return false;
  }
}
