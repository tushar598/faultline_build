// RT-07: what one trustee or a lost key can do since D17. These tests CHARACTERISE behaviour; they are not all desirable,
// and the owner decides whether a limit is wanted (docs/SECURITY-TEST-REPORT.md). A pause has no maximum and only the
// admin ends it. Mock-tested.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { DAY, YEAR, advance, travelTo } from "./helpers/time";
import { EV_A, Status, WINDOW, makeAtt, submit, triggerFixture } from "./helpers/trigger";

/** One trigger with a backup trustee. */
async function twoTrusteesFixture() {
  const f = await triggerFixture();
  const signers = await ethers.getSigners();
  const backup = signers[12];
  await f.trigger.connect(f.trustee).grantRole(await f.trigger.TRUSTEE_ROLE(), backup.address);
  return { ...f, backup };
}

describe("FaultlineTrigger — griefing and lost keys (RT-07, characterisation)", () => {
  it("a trustee who re-pauses after every unpause delays redemption with no bound, and each cycle moves the deadline by its length", async () => {
    const f = await loadFixture(twoTrusteesFixture);
    await travelTo((await f.pool.maturity()) - DAY); // the pause must start before the deadline to keep redemption closed
    const start = await f.trigger.submissionDeadline();
    for (let i = 0; i < 5; i++) {
      await f.trigger.connect(f.trustee).pause();
      await advance(30n * DAY);
      await f.trigger.connect(f.admin).unpause();
    }
    const moved = (await f.trigger.submissionDeadline()) - start;
    expect(moved).to.equal(await f.trigger.totalPausedSeconds());
    expect(moved).to.be.gte(150n * DAY);
    expect(BigInt(await time.latest())).to.be.gt(start); // the original deadline passed long ago
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
  });

  it("a rogue trustee can remove the backup; the admin cannot put it back (D17)", async () => {
    const f = await loadFixture(twoTrusteesFixture);
    const ROLE = await f.trigger.TRUSTEE_ROLE();
    await f.trigger.connect(f.trustee).revokeRole(ROLE, f.backup.address);
    await expect(f.trigger.connect(f.admin).grantRole(ROLE, f.backup.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.backup).pause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
  });

  it("the backup can equally remove the primary: trustees are peers", async () => {
    const f = await loadFixture(twoTrusteesFixture);
    await f.trigger.connect(f.backup).revokeRole(await f.trigger.TRUSTEE_ROLE(), f.trustee.address);
    await expect(f.trigger.connect(f.trustee).pause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
  });

  it("the last trustee renounces: veto and pause are gone for good, and every attested event executes after its window", async () => {
    const f = await loadFixture(triggerFixture);
    await f.trigger.connect(f.trustee).renounceRole(await f.trigger.TRUSTEE_ROLE(), f.trustee.address);
    expect(await f.trigger.hasRole(await f.trigger.TRUSTEE_ROLE(), f.trustee.address)).to.equal(false);
    await submit(f, makeAtt(f, { lossBps: 10_000n }));
    await expect(f.trigger.connect(f.admin).grantRole(await f.trigger.TRUSTEE_ROLE(), f.admin.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    expect(await f.pool.appliedLossBps()).to.equal(10_000);
  });

  it("the admin key is lost during a pause begun before the deadline: redemption stays closed for ever, and veto of an open window still works", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await f.trigger.connect(f.trustee).pause();
    await f.trigger.connect(f.admin).renounceRole(ethers.ZeroHash, f.admin.address); // stands in for a lost key
    await expect(f.trigger.connect(f.admin).unpause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await f.trigger.connect(f.trustee).veto(EV_A);
    expect((await f.trigger.getEventRecord(EV_A)).status).to.equal(Status.Vetoed);
    await travelTo((await f.pool.maturity()) + 50n * YEAR);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
  });

  it("the admin key is lost with an event pending past its window, during a pause: it can never execute or be vetoed, so EventPending blocks for ever, even for a pause begun after the deadline", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    const att = makeAtt(f, { deadline: D + 10n });
    await travelTo(D - 10n);
    await submit(f, att);
    await travelTo(D + WINDOW + 1n);
    await f.trigger.connect(f.trustee).pause(); // after the deadline: alone it would not close redemption
    await f.trigger.connect(f.admin).renounceRole(ethers.ZeroHash, f.admin.address);
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "IsPaused");
    await expect(f.trigger.connect(f.trustee).veto(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowClosed");
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
  });

  it("a pause begun after the deadline with nothing pending does not stop redemption, however long it lasts", async () => {
    const f = await loadFixture(triggerFixture);
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    await f.trigger.connect(f.trustee).pause();
    await advance(5n * YEAR);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept");
  });

  it("a trustee who vetoes every event blocks every payout to the sponsor: the veto is permanent even for a real quake", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await f.trigger.connect(f.trustee).veto(EV_A);
    await expect(submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: makeAtt(f).usgsUpdatedAt + 1n }))).to.be.revertedWithCustomError(f.trigger, "EventFinalised");
  });
});
