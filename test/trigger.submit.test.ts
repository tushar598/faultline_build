// FaultlineTrigger.submit: signature binding (oracle, verifyingContract, chainId, low-s), every rule and its error,
// and the check order (paused → deadline → signature → … → status → FullyWrittenDown).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { travelTo } from "./helpers/time";
import { atTime } from "./helpers/pool";
import { EV_A, EV_B, Status, TERMS, WINDOW, effectiveAt, expectStatuses, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

describe("FaultlineTrigger — submit: signature", () => {
  it("valid flow: anyone relays the oracle's signature; None → Pending; record stored; AttestationSubmitted", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const ts = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
    await atTime(BigInt(ts));
    const windowStart = await effectiveAt(f.trigger, BigInt(ts));
    await expect(submit(f, att))
      .to.emit(f.trigger, "AttestationSubmitted")
      .withArgs(att.eventId, att.nonce, att.lossBps, att.magnitudeX100, att.observedAt, att.usgsUpdatedAt, att.dataHash, windowStart);
    const r = await f.trigger.getEventRecord(att.eventId);
    expect([r.status, r.lossBps, r.magnitudeX100, r.observedAt, r.usgsUpdatedAt, r.nonce, r.dataHash, r.windowStart]).to.deep.equal([
      Status.Pending, att.lossBps, att.magnitudeX100, att.observedAt, att.usgsUpdatedAt, att.nonce, att.dataHash, windowStart,
    ]);
    expect(await f.trigger.windowEndsAt(att.eventId)).to.equal(windowStart + WINDOW);
    expect(await f.trigger.windowRemaining(att.eventId)).to.equal(WINDOW);
    await expectStatuses(f.trigger, { [EV_A]: Status.Pending });
  });

  it("a signature by anyone but the oracle reverts InvalidSignature", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(submit(f, makeAtt(f), f.other)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(submit(f, makeAtt(f), f.trustee)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
  });

  it("changing any signed field after signing reverts InvalidSignature", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const sig = await sign(f.oracle, att, await f.trigger.getAddress());
    await expect(f.trigger.submit({ ...att, lossBps: 10_000n }, sig)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(f.trigger.submit({ ...att, dataHash: ethers.id("x") }, sig)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(f.trigger.submit(att, sig)).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("a signature for another trigger instance (verifyingContract) reverts InvalidSignature", async () => {
    const f = await loadFixture(triggerFixture);
    const other = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), TERMS, WINDOW, f.oracle.address, f.admin.address, f.trustee.address]);
    const att = makeAtt(f);
    const sigForFirst = await sign(f.oracle, att, await f.trigger.getAddress());
    await expect(other.submit(att, sigForFirst)).to.be.revertedWithCustomError(other, "InvalidSignature");
    await expect(other.submit(att, await sign(f.oracle, att, await other.getAddress()))).to.emit(other, "AttestationSubmitted");
  });

  it("a signature for another chainId (e.g. 296 testnet) reverts InvalidSignature", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const sig = await sign(f.oracle, att, await f.trigger.getAddress(), 296n);
    await expect(f.trigger.submit(att, sig)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
  });

  it("a malleable high-s copy of a valid signature, and a 64-byte signature, revert InvalidSignature", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const sig = ethers.Signature.from(await sign(f.oracle, att, await f.trigger.getAddress()));
    const sHigh = ethers.toBeHex(SECP256K1_N - BigInt(sig.s), 32);
    const vFlipped = sig.v === 27 ? 28 : 27;
    const highS = ethers.concat([sig.r, sHigh, ethers.toBeHex(vFlipped, 1)]);
    // Same signer under the raw ecrecover precompile (0x01), so only the low-s rule rejects it.
    const raw = await ethers.provider.call({
      to: "0x0000000000000000000000000000000000000001",
      data: ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint8", "bytes32", "bytes32"], [await f.trigger.hashAttestation(att), vFlipped, sig.r, sHigh]),
    });
    expect(ethers.getAddress(ethers.dataSlice(raw, 12))).to.equal(f.oracle.address);
    await expect(f.trigger.submit(att, highS)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(f.trigger.submit(att, sig.compactSerialized)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(f.trigger.submit(att, sig.serialized)).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("deadline: at att.deadline it works, one second later AttestationExpired(deadline)", async () => {
    const f = await loadFixture(triggerFixture);
    const ts = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 100n;
    await atTime(ts);
    await expect(submit(f, makeAtt(f, { deadline: ts }))).to.emit(f.trigger, "AttestationSubmitted");
    await atTime(ts + 1n);
    await expect(submit(f, makeAtt(f, { eventId: EV_B, deadline: ts })))
      .to.be.revertedWithCustomError(f.trigger, "AttestationExpired")
      .withArgs(ts);
  });
});

describe("FaultlineTrigger — submit: rules", () => {
  it("termsHash must equal the trigger's: TermsMismatch(got)", async () => {
    const f = await loadFixture(triggerFixture);
    const bad = ethers.id("other terms");
    await expect(submit(f, makeAtt(f, { termsHash: bad }))).to.be.revertedWithCustomError(f.trigger, "TermsMismatch").withArgs(bad);
  });

  it("lossBps must be 1..10000: 0 and 10001 revert LossOutOfRange; 1 and 10000 work", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(submit(f, makeAtt(f, { lossBps: 0n }))).to.be.revertedWithCustomError(f.trigger, "LossOutOfRange").withArgs(0);
    await expect(submit(f, makeAtt(f, { lossBps: 10_001n }))).to.be.revertedWithCustomError(f.trigger, "LossOutOfRange").withArgs(10_001);
    await expect(submit(f, makeAtt(f, { lossBps: 1n }))).to.emit(f.trigger, "AttestationSubmitted");
    await expect(submit(f, makeAtt(f, { eventId: EV_B, lossBps: 10_000n }))).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("observedAt before riskStart reverts ObservedOutsideRiskPeriod; riskStart itself works", async () => {
    const f = await loadFixture(triggerFixture);
    const early = f.s.riskStart - 1n;
    await expect(submit(f, makeAtt(f, { observedAt: early }))).to.be.revertedWithCustomError(f.trigger, "ObservedOutsideRiskPeriod").withArgs(early);
    await expect(submit(f, makeAtt(f, { observedAt: f.s.riskStart }))).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("observedAt in the future reverts ObservedOutsideRiskPeriod; observedAt == block time works", async () => {
    const f = await loadFixture(triggerFixture);
    const ts = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 50n;
    await atTime(ts);
    await expect(submit(f, makeAtt(f, { observedAt: ts + 1n }))).to.be.revertedWithCustomError(f.trigger, "ObservedOutsideRiskPeriod").withArgs(ts + 1n);
    await atTime(ts + 1n);
    await expect(submit(f, makeAtt(f, { observedAt: ts + 1n }))).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("observedAt after maturity reverts ObservedOutsideRiskPeriod (in grace); maturity itself works", async () => {
    const f = await loadFixture(triggerFixture);
    await travelTo(f.s.maturity + 1000n);
    await expect(submit(f, makeAtt(f, { observedAt: f.s.maturity + 1n })))
      .to.be.revertedWithCustomError(f.trigger, "ObservedOutsideRiskPeriod")
      .withArgs(f.s.maturity + 1n);
    await expect(submit(f, makeAtt(f, { observedAt: f.s.maturity }))).to.emit(f.trigger, "AttestationSubmitted");
  });

  it("submissionDeadline(): at the deadline it works, one second later SubmissionClosed", async () => {
    const f = await loadFixture(triggerFixture);
    const deadline = await f.trigger.submissionDeadline();
    await atTime(deadline);
    await expect(submit(f, makeAtt(f))).to.emit(f.trigger, "AttestationSubmitted");
    await atTime(deadline + 1n);
    await expect(submit(f, makeAtt(f, { eventId: EV_B }))).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
  });

  it("while paused submit reverts IsPaused (D2)", async () => {
    const f = await loadFixture(triggerFixture);
    await f.trigger.connect(f.trustee).pause();
    await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "IsPaused");
  });

  it("once the pool is fully written down a NEW event reverts FullyWrittenDown", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 10_000n }));
    await travelTo((await ethers.provider.getBlock("latest"))!.timestamp + Number(WINDOW));
    await f.trigger.execute(EV_A);
    expect(await f.pool.appliedLossBps()).to.equal(10_000);
    await expect(submit(f, makeAtt(f, { eventId: EV_B }))).to.be.revertedWithCustomError(f.trigger, "FullyWrittenDown");
  });

  it("check order: paused beats a bad signature; a closed deadline beats a bad signature; status beats FullyWrittenDown", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 10_000n }));
    await travelTo((await ethers.provider.getBlock("latest"))!.timestamp + Number(WINDOW));
    await f.trigger.execute(EV_A);
    // L == 10000 now; replaying the executed event reports its final status, not FullyWrittenDown.
    await expect(submit(f, makeAtt(f, { lossBps: 10_000n }))).to.be.revertedWithCustomError(f.trigger, "EventFinalised").withArgs(EV_A, Status.Executed);
    await f.trigger.connect(f.trustee).pause();
    await expect(submit(f, makeAtt(f, { eventId: EV_B }), f.other)).to.be.revertedWithCustomError(f.trigger, "IsPaused");
    await f.trigger.unpause();
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    await expect(submit(f, makeAtt(f, { eventId: EV_B }), f.other)).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
  });
});
