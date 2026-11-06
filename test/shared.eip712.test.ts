// shared/ts/attestation.ts EIP-712 part, checked off chain: the digest ethers signs equals the digest rebuilt by hand
// the way FaultlineTrigger (OpenZeppelin EIP712) computes it: keccak256(0x1901 ‖ domainSeparator ‖ structHash).
// The on-chain check (trigger.hashAttestation) is in the FaultlineTrigger tests.
import { expect } from "chai";
import { AbiCoder, Wallet, concat, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
import spec from "../shared/attestation.eip712.json";
import {
  ATTESTATION_DOMAIN,
  ATTESTATION_TYPES,
  attestationDigest,
  kutchTerms,
  signAttestation,
  termsHash,
  type Attestation,
} from "../shared/ts/attestation";

const abi = AbiCoder.defaultAbiCoder();
const CHAIN_ID = 31_337n;
const TRIGGER = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // any address; no contract is deployed in this test
// Throwaway key made only for this test (never funded, never used on any network).
const oracle = Wallet.createRandom();

const att: Attestation = {
  eventId: keccak256(toUtf8Bytes("usp000a8ds")),
  lossBps: 7000n,
  magnitudeX100: 770n,
  observedAt: 980_479_777n,
  usgsUpdatedAt: 1_651_259_951n,
  nonce: 1n,
  termsHash: termsHash(kutchTerms("replay", 777)),
  dataHash: keccak256(toUtf8Bytes("any data")),
  deadline: 2_000_000_000n,
};

/** EIP-712 digest rebuilt from the spec, field by field, without ethers' TypedDataEncoder. */
function manualDigest(a: Attestation, chainId: bigint, verifyingContract: string): string {
  const fields = spec.types.Attestation;
  const typeString = `Attestation(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
  const structHash = keccak256(
    abi.encode(["bytes32", ...fields.map((f) => f.type)], [keccak256(toUtf8Bytes(typeString)), ...fields.map((f) => a[f.name as keyof Attestation])]),
  );
  const domainSeparator = keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        keccak256(toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toUtf8Bytes(spec.domain.name)),
        keccak256(toUtf8Bytes(spec.domain.version)),
        chainId,
        verifyingContract,
      ],
    ),
  );
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

describe("shared/ts attestation — EIP-712 (off chain)", () => {
  it("spec: domain FaultlineTrigger v1 and the nine §6.1 fields in order", () => {
    expect(ATTESTATION_DOMAIN).to.deep.equal({ name: "FaultlineTrigger", version: "1" });
    expect(ATTESTATION_TYPES.Attestation.map((f) => `${f.type} ${f.name}`)).to.deep.equal([
      "bytes32 eventId",
      "uint16 lossBps",
      "uint16 magnitudeX100",
      "uint64 observedAt",
      "uint64 usgsUpdatedAt",
      "uint64 nonce",
      "bytes32 termsHash",
      "bytes32 dataHash",
      "uint64 deadline",
    ]);
  });

  it("attestationDigest equals the hand-built 0x1901 ‖ domainSeparator ‖ structHash", () => {
    expect(attestationDigest(att, CHAIN_ID, TRIGGER)).to.equal(manualDigest(att, CHAIN_ID, TRIGGER));
  });

  it("the digest is bound to chainId, trigger address and every field", () => {
    const d = attestationDigest(att, CHAIN_ID, TRIGGER);
    expect(attestationDigest(att, 296n, TRIGGER)).to.not.equal(d);
    expect(attestationDigest(att, CHAIN_ID, "0x0000000000000000000000000000000000000001")).to.not.equal(d);
    expect(attestationDigest({ ...att, lossBps: 7001n }, CHAIN_ID, TRIGGER)).to.not.equal(d);
    expect(attestationDigest({ ...att, nonce: 2n }, CHAIN_ID, TRIGGER)).to.not.equal(d);
  });

  it("signAttestation recovers to the oracle; the same signature under another domain or field recovers someone else", async () => {
    const sig = await signAttestation(oracle, att, CHAIN_ID, TRIGGER);
    const domain = { ...ATTESTATION_DOMAIN, chainId: CHAIN_ID, verifyingContract: TRIGGER };
    expect(verifyTypedData(domain, ATTESTATION_TYPES, att, sig)).to.equal(oracle.address);
    expect(verifyTypedData({ ...domain, chainId: 296n }, ATTESTATION_TYPES, att, sig)).to.not.equal(oracle.address);
    expect(verifyTypedData(domain, ATTESTATION_TYPES, { ...att, lossBps: 10_000n }, sig)).to.not.equal(oracle.address);
  });

  it("uint16 / uint64 limits: an out-of-range field cannot be encoded", () => {
    expect(() => attestationDigest({ ...att, lossBps: 65_536n }, CHAIN_ID, TRIGGER)).to.throw();
    expect(() => attestationDigest({ ...att, deadline: 2n ** 64n }, CHAIN_ID, TRIGGER)).to.throw();
  });
});
