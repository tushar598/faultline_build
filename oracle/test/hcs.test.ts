// HCS messages (shared/ts/hcsMessage.ts) and the publishers (src/hcs.ts): §6.5 shape, JCS bytes, the 1024-byte
// limit, in-payload signatures of both kinds (D16), MockHcs lines, RealHcs against a stubbed SDK transaction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { buildAttestation, kutchTerms, signAttestation } from "../../shared/ts/attestation.js";
import { canonicalize } from "../../shared/ts/jcs.js";
import { HCS_MAX_BYTES, attestationMessage, decodeMessage, encodeMessage, recoverMessageSigner, signedAdvisory, verifyMessageSigner, type AdvisoryMessage } from "../../shared/ts/hcsMessage.js";
import { MockHcs, RealHcs, type SdkTopicTx } from "../src/hcs.js";

const TRIGGER = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const bhuj = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/real-usgs-usp000a8ds-detail.geojson"), "utf8"));
const terms = kutchTerms("replay", 812_561_278);
const oracle = Wallet.createRandom();
const nowSec = 1_793_040_300;

async function attMsg() {
  const att = buildAttestation({ feature: bhuj, terms, chainId: 296n, nonce: 1n, deadline: BigInt(nowSec + 3600), nowSec });
  const signature = await signAttestation(oracle as never, att, 296n, TRIGGER);
  return attestationMessage({ chainId: 296n, trigger: TRIGGER, terms, att, signature, usgsId: "usp000a8ds" });
}
const advisory = () => signedAdvisory(oracle as never, { chainId: 296n, trigger: TRIGGER, eventId: "0x" + "ab".repeat(32), usgsId: "synthetic-kutch-3", reason: "box", dataHash: "0x" + "cd".repeat(32) });

describe("HCS message format", () => {
  it("attestation message: exactly the §6.5 keys incl. mode + timeOffsetSec; JCS bytes; fits one chunk", async () => {
    const m = await attMsg();
    expect(Object.keys(m).sort()).toEqual(["attestation", "chainId", "kind", "mode", "signature", "timeOffsetSec", "trigger", "usgsId", "v"]);
    expect(m).toMatchObject({ v: 1, kind: "faultline.attestation", chainId: 296, mode: "replay", timeOffsetSec: 812_561_278, usgsId: "usp000a8ds" });
    expect(m.attestation).toMatchObject({ lossBps: 7000, magnitudeX100: 770, nonce: 1 });
    const bytes = encodeMessage(m);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalize(m));
    expect(bytes.length).toBeLessThanOrEqual(HCS_MAX_BYTES);
    expect(decodeMessage(bytes)).toEqual(m);
  });
  it("advisory message: kind, action, null dataHash allowed; no personal data fields", async () => {
    const a = await advisory();
    expect(Object.keys(a).sort()).toEqual(["action", "chainId", "dataHash", "eventId", "kind", "reason", "signature", "trigger", "usgsId", "v"]);
    expect(a.action).toBe("trustee should veto");
    const gone = await signedAdvisory(oracle as never, { chainId: 296n, trigger: TRIGGER, eventId: a.eventId, usgsId: "x", reason: "deleted", dataHash: null });
    expect(gone.dataHash).toBeNull();
    expect(encodeMessage(gone).length).toBeLessThan(HCS_MAX_BYTES);
  });
  it("refuses a message over 1024 bytes", async () => {
    const m = { ...(await attMsg()), usgsId: "x".repeat(1100) };
    expect(() => encodeMessage(m)).toThrow(/> 1024/);
  });
  it("rejects non-Faultline JSON", () => {
    expect(() => decodeMessage('{"v":2,"kind":"faultline.attestation"}')).toThrow();
  });
});

describe("in-payload signatures (D16)", () => {
  it("attestation: the EIP-712 signature recovers to the oracle; any field change breaks it", async () => {
    const m = await attMsg();
    expect(recoverMessageSigner(m)).toBe(oracle.address);
    expect(verifyMessageSigner(m, oracle.address)).toBe(true);
    expect(verifyMessageSigner({ ...m, attestation: { ...m.attestation, lossBps: 10000 } }, oracle.address)).toBe(false);
    expect(verifyMessageSigner({ ...m, trigger: "0x0000000000000000000000000000000000000001" }, oracle.address)).toBe(false);
    expect(verifyMessageSigner({ ...m, chainId: 295 }, oracle.address)).toBe(false);
  });
  it("advisory: EIP-191 over the JCS payload without the signature; any field change breaks it", async () => {
    const a = await advisory();
    expect(verifyMessageSigner(a, oracle.address)).toBe(true);
    const tampered: AdvisoryMessage = { ...a, reason: "depth" };
    expect(verifyMessageSigner(tampered, oracle.address)).toBe(false);
    expect(verifyMessageSigner({ ...a, eventId: "0x" + "00".repeat(32) }, oracle.address)).toBe(false);
    expect(verifyMessageSigner(a, Wallet.createRandom().address)).toBe(false);
    expect(verifyMessageSigner({ ...a, signature: "0x1234" }, oracle.address)).toBe(false);
  });
});

describe("publishers", () => {
  it("MockHcs appends JSON lines with increasing sequence numbers and the exact JCS bytes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-hcs-"));
    const h = new MockHcs("local-test", dir);
    const m = await attMsg();
    const r1 = await h.publish(m);
    const r2 = await h.publish(await advisory());
    expect([r1.sequenceNumber, r2.sequenceNumber]).toEqual(["1", "2"]);
    const lines = h.lines();
    expect(lines[0]!.message).toBe(canonicalize(m));
    expect(lines[0]!.consensusTimestamp).toMatch(/^\d+\.\d{9}$/);
    expect(decodeMessage(lines[1]!.message).kind).toBe("faultline.advisory");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("RealHcs: sets the topic and the JCS bytes, freezes with the relayer client, signs with the submit key, reads the sequence", async () => {
    const calls: string[] = [];
    let sent: Uint8Array | undefined;
    const fake = (status: string, seq: string | null): SdkTopicTx => {
      const tx: SdkTopicTx = {
        setTopicId: (id) => (calls.push(`topic ${id}`), tx),
        setMessage: (b) => ((sent = b), calls.push(`message ${b.length} bytes`), tx),
        freezeWith: (c) => (calls.push(`freeze ${String(c)}`), tx),
        sign: async (k) => (calls.push(`sign ${String(k)}`), tx),
        execute: async (c) => (calls.push(`execute ${String(c)}`), { transactionId: { toString: () => "0.0.11183040@1.2" }, getReceipt: async () => ({ status: { toString: () => status }, topicSequenceNumber: seq === null ? null : { toString: () => seq } }) }),
      };
      return tx;
    };
    const m = await attMsg();
    const ok = new RealHcs("0.0.123", { client: "relayer-client", submitKey: "oracle-submit-key", newTx: () => fake("SUCCESS", "7") });
    expect(await ok.publish(m)).toEqual({ topicId: "0.0.123", sequenceNumber: "7" });
    expect(new TextDecoder().decode(sent)).toBe(canonicalize(m));
    expect(calls).toEqual([`topic 0.0.123`, `message ${sent!.length} bytes`, "freeze relayer-client", "sign oracle-submit-key", "execute relayer-client"]);
    const bad = new RealHcs("0.0.123", { client: "c", submitKey: "k", newTx: () => fake("INVALID_SIGNATURE", null) });
    await expect(bad.publish(m)).rejects.toThrow(/INVALID_SIGNATURE/);
  });
});
