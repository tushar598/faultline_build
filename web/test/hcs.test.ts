import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { TESTNET } from "@/config/networks";
import { eventInfos, realTimeOf } from "@/lib/eventInfo";
import { toEntries } from "@/lib/hcs";
import { eventIdOf, kutchTerms, termsHash } from "@/lib/shared";
import type { ChainEventRecord } from "@/lib/types";
import { attestationMessage, signedAdvisory, encodeMessage } from "../../shared/ts/hcsMessage";
import { signAttestation, type Attestation } from "../../shared/ts/attestation";

// Throwaway keys generated per run; they sign only these in-memory test messages.
const oracle = Wallet.createRandom();
const stranger = Wallet.createRandom();
const trigger = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const terms = kutchTerms("replay", 813_518_175);
const att: Attestation = {
  eventId: eventIdOf("usp000a8ds"),
  lossBps: 7000n,
  magnitudeX100: 770n,
  observedAt: 1_793_997_175n,
  usgsUpdatedAt: 2_464_777_349n,
  nonce: 1n,
  termsHash: termsHash(terms),
  dataHash: "0xd604b4f7132c25556c5acda8c97ef967af9ce458b017144bac0741ff02672730",
  deadline: 1_796_247_175n,
};
const text = (m: Parameters<typeof encodeMessage>[0]) => new TextDecoder().decode(encodeMessage(m));

async function lines() {
  const good = attestationMessage({ chainId: 31337n, trigger, terms, att, signature: await signAttestation(oracle, att, 31337n, trigger), usgsId: "usp000a8ds" });
  const forged = attestationMessage({ chainId: 31337n, trigger, terms, att: { ...att, nonce: 2n }, signature: await signAttestation(stranger, { ...att, nonce: 2n }, 31337n, trigger), usgsId: "usp000a8ds-forged" });
  const advisory = await signedAdvisory(oracle, { chainId: 31337n, trigger, eventId: att.eventId, usgsId: "usp000a8ds", reason: "box", dataHash: null });
  const otherBond = attestationMessage({ chainId: 296n, trigger, terms, att, signature: "0x", usgsId: "usp000a8ds" });
  return [
    { sequenceNumber: 1, consensusTimestamp: "1.0", payer: null, text: text(good) },
    { sequenceNumber: 2, consensusTimestamp: "2.0", payer: null, text: text(forged) },
    { sequenceNumber: 3, consensusTimestamp: "3.0", payer: null, text: text(advisory) },
    { sequenceNumber: 4, consensusTimestamp: "4.0", payer: null, text: text(otherBond) },
    { sequenceNumber: 5, consensusTimestamp: "5.0", payer: null, text: "not json" },
  ];
}

describe("HCS log: decode, filter by bond, verify the oracle's in-payload signature (D16)", () => {
  it("keeps this trigger's messages and flags who signed them", async () => {
    const out = toEntries(await lines(), { chainId: 31337, trigger: trigger.toLowerCase(), oracle: oracle.address });
    expect(out.map((e) => e.sequenceNumber)).toEqual([1, 2, 3, 5]); // seq 4 is another chain's message
    expect(out.map((e) => e.signedByOracle)).toEqual([true, false, true, null]);
    expect(out[3]!.parseError).toBeTruthy();
  });
  it("only oracle-signed messages name an event; replayed chain times map back to real times", async () => {
    const entries = toEntries(await lines(), { chainId: 31337, trigger, oracle: oracle.address });
    const record: ChainEventRecord = { eventId: att.eventId, status: "Pending", lossBps: 7000, magnitudeX100: 770, observedAt: Number(att.observedAt), usgsUpdatedAt: Number(att.usgsUpdatedAt), nonce: 1, dataHash: att.dataHash, windowStart: 0, windowEndsAt: 0, windowRemaining: 0 };
    const [info] = eventInfos([record], [], entries);
    expect(info!.usgsId).toBe("usp000a8ds"); // not the forged id from seq 2
    expect(info!.advisories).toHaveLength(1);
    expect(info!.mode).toBe("replay");
    expect(realTimeOf(record.observedAt, info!)).toBe(980_479_000); // 2001-01-26 03:16:40 UTC, Bhuj origin
    expect(realTimeOf(record.usgsUpdatedAt, info!)).toBe(1_651_259_174); // the record's real `updated`
    expect(realTimeOf(1, { mode: null, timeOffsetSec: null })).toBeNull();
  });
});

describe("testnet config", () => {
  it("terms hash to the full-demo trigger's termsHash (docs/DEPLOYMENTS.md, full demo)", () => {
    expect(termsHash(TESTNET.terms!)).toBe("0x76135117384c954cbeb10265dcd69ab06f489f3eff903f9b34cf939d387957e2");
  });
});
