// FaultlineTrigger revisions (higher nonce AND newer usgsUpdatedAt replace a pending event, may lower the loss and
// restart the window) and replay protection (terminal statuses are permanent: EventFinalised).
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { advance, now, travelTo } from "./helpers/time";
import { atTime } from "./helpers/pool";
import { EV_A, EV_B, Status, WINDOW, effectiveAt, expectStatuses, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

describe("FaultlineTrigger — revisions", () => {
  it("a higher nonce with a newer usgsUpdatedAt replaces the event, may LOWER the loss, and restarts the window", async () => {
    const f = await loadFixture(triggerFixture);
    const first = makeAtt(f);
    await submit(f, first);
    const firstEnd = await f.trigger.windowEndsAt(EV_A);
    await advance(WINDOW / 2n);
    const revised = makeAtt(f, { nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt + 1n, lossBps: 3_000n, magnitudeX100: 680n, dataHash: first.eventId });
    const ts = (await now()) + 5n;
    await atTime(ts);
    const windowStart = await effectiveAt(f.trigger, ts);
    const tx = submit(f, revised);
    await expect(tx).to.emit(f.trigger, "AttestationRevised").withArgs(EV_A, 1, 2, 5_000, 3_000);
    await expect(tx)
      .to.emit(f.trigger, "AttestationSubmitted")
      .withArgs(EV_A, 2, 3_000, 680, revised.observedAt, revised.usgsUpdatedAt, revised.dataHash, windowStart);
    const r = await f.trigger.getEventRecord(EV_A);
    expect([r.status, r.lossBps, r.magnitudeX100, r.nonce, r.usgsUpdatedAt, r.dataHash, r.windowStart]).to.deep.equal([
      Status.Pending, 3_000n, 680n, 2n, revised.usgsUpdatedAt, revised.dataHash, windowStart,
    ]);
    await expectStatuses(f.trigger, { [EV_A]: Status.Pending }); // still one pending event
    const newEnd = windowStart + WINDOW;
    expect(newEnd > firstEnd).to.equal(true);

    await travelTo(firstEnd + 1n); // old window over, new one not
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen").withArgs(newEnd);
    await travelTo(newEnd);
    await expect(f.trigger.execute(EV_A)).to.emit(f.trigger, "EventExecuted").withArgs(EV_A, 3_000, 3_000);
    expect(await f.pool.appliedLossBps()).to.equal(3_000);
  });

  it("a revision may also raise the loss", async () => {
    const f = await loadFixture(triggerFixture);
    const first = makeAtt(f, { lossBps: 2_000n });
    await submit(f, first);
    await expect(submit(f, makeAtt(f, { nonce: 5n, usgsUpdatedAt: first.usgsUpdatedAt + 60n, lossBps: 6_000n })))
      .to.emit(f.trigger, "AttestationRevised")
      .withArgs(EV_A, 1, 5, 2_000, 6_000);
  });

  it("a higher nonce with an equal or older usgsUpdatedAt reverts StaleRevision", async () => {
    const f = await loadFixture(triggerFixture);
    const first = makeAtt(f);
    await submit(f, first);
    await expect(submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt }))).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
    await expect(submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt - 1n }))).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
  });

  it("an equal or lower nonce reverts StaleRevision, even with a newer usgsUpdatedAt (and the same signature replayed)", async () => {
    const f = await loadFixture(triggerFixture);
    const first = makeAtt(f, { nonce: 3n });
    const sig = await sign(f.oracle, first, await f.trigger.getAddress());
    await f.trigger.submit(first, sig);
    await expect(f.trigger.submit(first, sig)).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
    await expect(submit(f, makeAtt(f, { nonce: 3n, usgsUpdatedAt: first.usgsUpdatedAt + 1n }))).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
    await expect(submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt + 1n }))).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
    await expectStatuses(f.trigger, { [EV_A]: Status.Pending });
  });
});

describe("FaultlineTrigger — revision of a pending event at L = 10000 (RT-08)", () => {
  it("A and B pending, A executes to 10000: revising B reverts FullyWrittenDown, B then executes to Superseded, nothing stays stuck", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 10_000n }));
    const b = makeAtt(f, { eventId: EV_B, lossBps: 2_000n });
    await submit(f, b);
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    expect(await f.pool.appliedLossBps()).to.equal(10_000);

    await expect(submit(f, { ...b, nonce: 2n, usgsUpdatedAt: b.usgsUpdatedAt + 1n })).to.be.revertedWithCustomError(f.trigger, "FullyWrittenDown");
    expect((await f.trigger.getEventRecord(EV_B)).nonce).to.equal(1n); // the revision changed nothing
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Pending });

    await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventSuperseded").withArgs(EV_B, 2_000n);
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Superseded });
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    // POOL PART (restore with the real pool): await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
  });

  it("the same pending event can also still be vetoed at L = 10000, inside its window", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 10_000n }));
    await advance(WINDOW / 2n);
    await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 2_000n }));
    await advance(WINDOW / 2n);
    await f.trigger.execute(EV_A);
    await f.trigger.connect(f.trustee).veto(EV_B);
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Vetoed });
  });
});

describe("FaultlineTrigger — replay protection (terminal statuses are permanent)", () => {
  it("Vetoed: the same signature and a fresh higher-nonce one both revert EventFinalised(id, Vetoed)", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const sig = await sign(f.oracle, att, await f.trigger.getAddress());
    await f.trigger.submit(att, sig);
    await f.trigger.connect(f.trustee).veto(EV_A);
    await expect(f.trigger.submit(att, sig)).to.be.revertedWithCustomError(f.trigger, "EventFinalised").withArgs(EV_A, Status.Vetoed);
    await expect(submit(f, makeAtt(f, { nonce: 9n, usgsUpdatedAt: att.usgsUpdatedAt + 99n })))
      .to.be.revertedWithCustomError(f.trigger, "EventFinalised")
      .withArgs(EV_A, Status.Vetoed);
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed });
  });

  it("Executed: replays revert EventFinalised(id, Executed)", async () => {
    const f = await loadFixture(triggerFixture);
    const att = makeAtt(f);
    const sig = await sign(f.oracle, att, await f.trigger.getAddress());
    await f.trigger.submit(att, sig);
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    await expect(f.trigger.submit(att, sig)).to.be.revertedWithCustomError(f.trigger, "EventFinalised").withArgs(EV_A, Status.Executed);
    await expect(submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: att.usgsUpdatedAt + 1n })))
      .to.be.revertedWithCustomError(f.trigger, "EventFinalised")
      .withArgs(EV_A, Status.Executed);
    expect(await f.pool.appliedLossBps()).to.equal(5_000); // applied once only
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed });
  });

  it("Superseded (and the Executed event that reached 10000): replays revert EventFinalised, not FullyWrittenDown", async () => {
    const f = await loadFixture(triggerFixture);
    const a = makeAtt(f, { lossBps: 10_000n });
    const b = makeAtt(f, { eventId: EV_B, lossBps: 4_000n });
    const sigB = await sign(f.oracle, b, await f.trigger.getAddress());
    await submit(f, a);
    await f.trigger.submit(b, sigB);
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventSuperseded").withArgs(EV_B, 4_000);
    await expect(f.trigger.submit(b, sigB)).to.be.revertedWithCustomError(f.trigger, "EventFinalised").withArgs(EV_B, Status.Superseded);
    await expect(submit(f, makeAtt(f, { eventId: EV_B, nonce: 2n, usgsUpdatedAt: b.usgsUpdatedAt + 1n })))
      .to.be.revertedWithCustomError(f.trigger, "EventFinalised")
      .withArgs(EV_B, Status.Superseded);
    await expect(submit(f, a)).to.be.revertedWithCustomError(f.trigger, "EventFinalised").withArgs(EV_A, Status.Executed);
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Superseded });
  });
});
