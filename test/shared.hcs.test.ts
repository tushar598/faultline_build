// shared/ts/hcsMessage.ts: §6.5 message shapes, JCS bytes, the 1024-byte chunk limit and the in-payload signatures
// (D16). Extra to the reference repo's root tests (the reference covers this in oracle/test/hcs.test.ts, which also
// tests the oracle's publishers; those come with the oracle part).
import { expect } from "chai";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { buildAttestation, kutchTerms, signAttestation } from "../shared/ts/attestation";
import {
  ADVISORY_ACTION,
  HCS_MAX_BYTES,
  advisorySigningBytes,
  attestationMessage,
  attestationOf,
  decodeMessage,
  encodeMessage,
  recoverMessageSigner,
  signedAdvisory,
  verifyMessageSigner,
  type AdvisoryMessage,
  type AttestationMessage,
} from "../shared/ts/hcsMessage";
import { canonicalize } from "../shared/ts/jcs";
import { BHUJ_FILE, loadFeature } from "../scripts/lib/fixtures";

const CHAIN_ID = 31_337n;
const TRIGGER = "0x5fbdb2315678afecb367f032d93f642f64180aa3"; // lower case on purpose: messages store the checksum form
// Throwaway keys made only for this test (never funded, never used on any network).
const oracle = Wallet.createRandom();
const stranger = Wallet.createRandom();

async function signedAttestationMessage(): Promise<AttestationMessage> {
  const terms = kutchTerms("replay", 777);
  const feature = loadFeature(BHUJ_FILE);
  const nowSec = Math.floor(feature.properties.time / 1000) + 10 * 365 * 86_400;
  const att = buildAttestation({ feature, terms, chainId: CHAIN_ID, nonce: 1n, deadline: 2_000_000_000n, nowSec });
  const signature = await signAttestation(oracle, att, CHAIN_ID, TRIGGER);
  return attestationMessage({ chainId: CHAIN_ID, trigger: TRIGGER, terms, att, signature, usgsId: feature.id });
}

const advisoryArgs = {
  chainId: CHAIN_ID,
  trigger: TRIGGER,
  eventId: keccak256(toUtf8Bytes("synthetic-kutch-3")),
  usgsId: "synthetic-kutch-3",
  reason: "box" as const,
  dataHash: keccak256(toUtf8Bytes("revised record")),
};

describe("shared/ts hcsMessage — format (§6.5)", () => {
  it("attestation message: exactly the §6.5 keys, checksum trigger, JCS bytes, fits one chunk, round-trips", async () => {
    const m = await signedAttestationMessage();
    expect(Object.keys(m).sort()).to.deep.equal(["attestation", "chainId", "kind", "mode", "signature", "timeOffsetSec", "trigger", "usgsId", "v"]);
    expect(m).to.include({ v: 1, kind: "faultline.attestation", chainId: 31_337, mode: "replay", timeOffsetSec: 777, usgsId: "usp000a8ds" });
    expect(m.trigger).to.equal("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(m.attestation.lossBps).to.equal(7000);
    const bytes = encodeMessage(m);
    expect(new TextDecoder().decode(bytes)).to.equal(canonicalize(m));
    expect(bytes.length).to.be.at.most(HCS_MAX_BYTES);
    expect(decodeMessage(bytes)).to.deep.equal(m);
    expect(decodeMessage(canonicalize(m))).to.deep.equal(m);
  });

  it("attestationOf turns the JSON numbers back into the exact signed struct", async () => {
    const m = await signedAttestationMessage();
    const att = attestationOf(m);
    expect(att.lossBps).to.equal(7000n);
    expect(att.observedAt).to.equal(980_479_777n);
    // lossBps, magnitudeX100, observedAt, usgsUpdatedAt, nonce, deadline; the three bytes32 fields stay hex strings.
    expect(Object.values(att).filter((x) => typeof x === "bigint")).to.have.length(6);
  });

  it("advisory message: kind, fixed action, null dataHash allowed", async () => {
    const m = await signedAdvisory(oracle, advisoryArgs);
    expect(m).to.include({ v: 1, kind: "faultline.advisory", reason: "box", action: ADVISORY_ACTION });
    const gone = await signedAdvisory(oracle, { ...advisoryArgs, reason: "deleted", dataHash: null });
    expect(gone.dataHash).to.equal(null);
    expect(decodeMessage(encodeMessage(gone))).to.deep.equal(gone);
  });

  it("refuses a message over 1024 bytes and non-Faultline JSON", async () => {
    const m = await signedAttestationMessage();
    expect(() => encodeMessage({ ...m, usgsId: "x".repeat(HCS_MAX_BYTES) })).to.throw(/> 1024/);
    expect(() => decodeMessage('{"v":1,"kind":"other"}')).to.throw(/not a Faultline HCS message/);
    expect(() => decodeMessage('{"v":2,"kind":"faultline.attestation"}')).to.throw(/not a Faultline HCS message/);
  });

  it("unsafe integers are refused instead of silently rounded", async () => {
    const m = await signedAttestationMessage();
    const att = { ...attestationOf(m), deadline: 2n ** 60n };
    expect(() => attestationMessage({ chainId: CHAIN_ID, trigger: TRIGGER, terms: kutchTerms("replay", 777), att, signature: m.signature, usgsId: m.usgsId })).to.throw(
      /not a safe integer/,
    );
  });
});

describe("shared/ts hcsMessage — in-payload signatures (D16)", () => {
  it("attestation: the EIP-712 signature recovers to the oracle; a changed field or another signer fails", async () => {
    const m = await signedAttestationMessage();
    expect(recoverMessageSigner(m)).to.equal(oracle.address);
    expect(verifyMessageSigner(m, oracle.address.toLowerCase())).to.equal(true);
    expect(verifyMessageSigner(m, stranger.address)).to.equal(false);
    expect(verifyMessageSigner({ ...m, attestation: { ...m.attestation, lossBps: 10_000 } }, oracle.address)).to.equal(false);
    expect(verifyMessageSigner({ ...m, chainId: 296 }, oracle.address)).to.equal(false);
    expect(verifyMessageSigner({ ...m, signature: "0x1234" }, oracle.address)).to.equal(false); // malformed: false, no throw
  });

  it("advisory: EIP-191 over utf8(JCS(message without signature)); a changed field or another signer fails", async () => {
    const m = await signedAdvisory(oracle, advisoryArgs);
    const { signature: _sig, ...payload } = m;
    expect(new TextDecoder().decode(advisorySigningBytes(payload))).to.equal(canonicalize(payload));
    expect(recoverMessageSigner(m)).to.equal(oracle.address);
    expect(verifyMessageSigner({ ...m, reason: "depth" } as AdvisoryMessage, oracle.address)).to.equal(false);
    const forged = await signedAdvisory(stranger, advisoryArgs);
    expect(verifyMessageSigner(forged, oracle.address)).to.equal(false);
  });
});
