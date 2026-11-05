// Builds and signs one attestation with shared/ts (buildAttestation with the chainId, D14; signAttestation, §6.1),
// then applies the smoke-run gate: eth_call trigger.hashAttestation(att) must equal the local attestationDigest, and
// the signature must recover to the signer. Any mismatch aborts before anything is published or sent.
import { verifyTypedData, type Contract, type Wallet } from "ethers";
import { ATTESTATION_TYPES, attestationDigest, attestationDomain, buildAttestation, signAttestation, type Attestation, type Terms, type UsgsFeature } from "../../shared/ts/attestation.js";

export type Signed = { att: Attestation; signature: string; digest: string };

export async function buildAndSign(args: {
  feature: UsgsFeature;
  terms: Terms;
  chainId: bigint;
  trigger: Contract; // read-only is enough
  triggerAddress: string;
  /** D8: the ORIGINAL eventId from the ledger (equals eventIdOf(feature.id) for a first sighting). */
  eventId: string;
  nonce: number;
  deadline: number;
  nowSec: number;
  signer: Wallet;
}): Promise<Signed> {
  const built = buildAttestation({ feature: args.feature, terms: args.terms, chainId: args.chainId, nonce: BigInt(args.nonce), deadline: BigInt(args.deadline), nowSec: args.nowSec });
  const att: Attestation = { ...built, eventId: args.eventId };
  const digest = attestationDigest(att, args.chainId, args.triggerAddress);
  const onChain: string = await args.trigger.getFunction("hashAttestation")(att);
  if (onChain.toLowerCase() !== digest.toLowerCase()) throw new Error(`hashAttestation gate failed: trigger ${onChain} != local ${digest} — nothing published or sent`);
  // The oracle package and shared/ts resolve two copies of ethers 6.17 (ESM / CJS); a Wallet works with both at run
  // time, only their private type members differ.
  const signature = await signAttestation(args.signer as unknown as Parameters<typeof signAttestation>[0], att, args.chainId, args.triggerAddress);
  const recovered = verifyTypedData(attestationDomain(args.chainId, args.triggerAddress), ATTESTATION_TYPES, att, signature);
  if (recovered.toLowerCase() !== args.signer.address.toLowerCase()) throw new Error("signature does not recover to the oracle signer");
  return { att, signature, digest };
}
