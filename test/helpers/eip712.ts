// EIP-712 definition of the oracle attestation, loaded from the single shared file used by tests and the oracle.
import spec from "../../shared/attestation.eip712.json";

export type TypedField = { name: string; type: string };

export const ATTESTATION_SPEC = spec as {
  domain: { name: string; version: string };
  primaryType: "Attestation";
  types: { Attestation: TypedField[] };
};

/** `types` argument for ethers `signTypedData` / `TypedDataEncoder` (no EIP712Domain entry). */
export const attestationTypes: Record<string, TypedField[]> = { Attestation: ATTESTATION_SPEC.types.Attestation };

/** Full domain for one trigger instance. */
export function attestationDomain(chainId: bigint | number, verifyingContract: string) {
  return { ...ATTESTATION_SPEC.domain, chainId, verifyingContract };
}
