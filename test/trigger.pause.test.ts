// FaultlineTrigger veto, pause clock and the D2 submission deadline (ARCHITECTURE §4.2–§4.3).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { advance, now, travelTo } from "./helpers/time";
import { atTime } from "./helpers/pool";
import { ROLES } from "./helpers/roles";
import { EV_A, EV_B, Status, WINDOW, expectStatuses, makeAtt, submit, triggerFixture } from "./helpers/trigger";

const TRUSTEE = ethers.id("TRUSTEE_ROLE");

describe("FaultlineTrigger — veto", () => {
  it("trustee vetoes inside the window: Pending → Vetoed, pendingCount--, EventVetoed", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.emit(f.trigger, "EventVetoed").withArgs(EV_A, f.trustee.address);
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed });
  });

  it("works until windowEnd - 1 and reverts WindowClosed from windowEnd (effective time)", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await submit(f, makeAtt(f, { eventId: EV_B }));
    const endA = await f.trigger.windowEndsAt(EV_A);
    const endB = await f.trigger.windowEndsAt(EV_B);
    await atTime(endA - 1n);
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.emit(f.trigger, "EventVetoed");
    await atTime(endB);
    await expect(f.trigger.connect(f.trustee).veto(EV_B)).to.be.revertedWithCustomError(f.trigger, "WindowClosed");
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed, [EV_B]: Status.Pending });
  });

  it("works while paused, even long after the window would have ended in real time", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await f.trigger.connect(f.trustee).pause();
    await advance(10n * WINDOW);
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.emit(f.trigger, "EventVetoed");
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed });
  });

  it("only TRUSTEE_ROLE may veto (not the admin, not the oracle)", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    for (const who of [f.admin, f.oracle, f.other]) {
      await expect(f.trigger.connect(who).veto(EV_A))
        .to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount")
        .withArgs(who.address, TRUSTEE);
    }
  });

  it("reverts NotPending for an unknown event and for an already vetoed one", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(f.trigger.connect(f.trustee).veto(EV_B)).to.be.revertedWithCustomError(f.trigger, "NotPending").withArgs(EV_B);
    await submit(f, makeAtt(f));
    await f.trigger.connect(f.trustee).veto(EV_A);
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.be.revertedWithCustomError(f.trigger, "NotPending").withArgs(EV_A);
  });
});

describe("FaultlineTrigger — pause clock", () => {
  it("pause: trustee only, TriggerPaused, pauseStart = now; a second pause reverts IsPaused", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(f.trigger.connect(f.admin).pause())
      .to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount")
      .withArgs(f.admin.address, TRUSTEE);
    const ts = (await now()) + 3n;
    await atTime(ts);
    await expect(f.trigger.connect(f.trustee).pause()).to.emit(f.trigger, "TriggerPaused").withArgs(f.trustee.address);
    expect(await f.trigger.paused()).to.equal(true);
    expect(await f.trigger.pauseStart()).to.equal(ts);
    await expect(f.trigger.connect(f.trustee).pause()).to.be.revertedWithCustomError(f.trigger, "IsPaused");
  });

  it("unpause: admin only (not the trustee), NotPaused when running, TriggerUnpaused(by, pausedFor), adds to totalPausedSeconds", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(f.trigger.unpause()).to.be.revertedWithCustomError(f.trigger, "NotPaused");
    const p = (await now()) + 1n;
    await atTime(p);
    await f.trigger.connect(f.trustee).pause();
    await expect(f.trigger.connect(f.trustee).unpause())
      .to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount")
      .withArgs(f.trustee.address, ROLES.DEFAULT_ADMIN);
    await atTime(p + 500n);
    await expect(f.trigger.unpause()).to.emit(f.trigger, "TriggerUnpaused").withArgs(f.admin.address, 500);
    expect(await f.trigger.paused()).to.equal(false);
    expect(await f.trigger.totalPausedSeconds()).to.equal(500);
  });

  it("a pause does not consume the window: effectiveTime stops, execute needs window + paused time in real time", async () => {
    const f = await loadFixture(triggerFixture);
    const t0 = (await now()) + 1n;
    await atTime(t0);
    await submit(f, makeAtt(f));
    const endsAt = t0 + WINDOW; // effective time
    await atTime(t0 + 1000n);
    await f.trigger.connect(f.trustee).pause();
    await advance(5_000n);
    expect(await f.trigger.effectiveTime()).to.equal(t0 + 1000n); // frozen
    expect(await f.trigger.windowRemaining(EV_A)).to.equal(WINDOW - 1000n);
    await atTime(t0 + 7000n);
    await f.trigger.unpause(); // paused for 6000 s
    const realEnd = endsAt + 6000n;
    await atTime(realEnd - 1n);
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen").withArgs(endsAt);
    await atTime(realEnd);
    await expect(f.trigger.execute(EV_A)).to.emit(f.trigger, "EventExecuted");
    expect(await f.trigger.windowRemaining(EV_A)).to.equal(0);
  });

  it("several pauses add up in totalPausedSeconds and effectiveTime", async () => {
    const f = await loadFixture(triggerFixture);
    let ts = (await now()) + 1n;
    for (const d of [100n, 250n, 7n]) {
      await atTime(ts);
      await f.trigger.connect(f.trustee).pause();
      await atTime(ts + d);
      await f.trigger.unpause();
      ts += d + 50n;
    }
    expect(await f.trigger.totalPausedSeconds()).to.equal(357);
    await travelTo(ts);
    expect(await f.trigger.effectiveTime()).to.equal(ts - 357n);
  });

  it("execute while paused reverts IsPaused even when the window is complete", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await advance(WINDOW);
    await f.trigger.connect(f.trustee).pause();
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "IsPaused");
  });

  it("early execute reverts WindowOpen(endsAt) with the effective end time", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    const endsAt = await f.trigger.windowEndsAt(EV_A);
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen").withArgs(endsAt);
  });
});

describe("FaultlineTrigger — D2 submission deadline", () => {
  it("a pause that starts BEFORE the deadline moves it with the clock, then adds exactly its length; redeem stays closed meanwhile", async () => {
    const f = await loadFixture(triggerFixture);
    const D = f.s.maturity + f.s.grace;
    const P = D - 100n;
    await atTime(P);
    await f.trigger.connect(f.trustee).pause();
    await travelTo(D + 400n); // 500 s into the pause
    expect(await f.trigger.submissionDeadline()).to.equal(D + 500n);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "IsPaused");
    await travelTo(D + 500n); // the two reverted txs above mined blocks, so jump to an exact time
    expect(await f.trigger.submissionDeadline()).to.equal(D + 600n); // still moving
    const U = D + 1000n;
    await atTime(U);
    await f.trigger.unpause(); // paused for 1100 s
    const newD = D + 1100n;
    expect(await f.trigger.submissionDeadline()).to.equal(newD);
    // The quake that the pause would otherwise have cut off can still be submitted …
    await atTime(newD);
    await expect(submit(f, makeAtt(f, { observedAt: f.s.maturity }))).to.emit(f.trigger, "AttestationSubmitted");
    await expect(submit(f, makeAtt(f, { eventId: EV_B }))).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
    // … and redemption waits for it.
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
  });

  it("a pause that starts AFTER the deadline keeps it below now (during and after the pause): submit stays closed, redeem stays open", async () => {
    const f = await loadFixture(triggerFixture);
    const D = f.s.maturity + f.s.grace;
    const P = D + 100n;
    await atTime(P);
    await f.trigger.connect(f.trustee).pause();
    for (const t of [P + 1n, P + 5_000n]) {
      await travelTo(t);
      const deadline = await f.trigger.submissionDeadline();
      expect(deadline).to.equal(D + (t - P));
      expect(deadline < t).to.equal(true);
    }
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed"); // open while paused
    await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "IsPaused");
    const U = P + 6_000n;
    await atTime(U);
    await f.trigger.unpause();
    const deadline = await f.trigger.submissionDeadline();
    expect(deadline).to.equal(D + 6_000n);
    expect(deadline <= U).to.equal(true);
    await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
    await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed");
  });
});
