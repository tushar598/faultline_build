// FaultlineTrigger + the REAL FaultlinePool (MockBond, MockUSD, MockHTS at 0x167): the end-to-end lifecycle, the
// redemption gates the trigger drives (pendingCount, submissionDeadline), invariant 11 and D12. Local chain only.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { advance, travelTo } from "./helpers/time";
import { A_UNITS, B_UNITS, BPS, MIN_TICKET, SCALE, deployPoolFixture, expectInvariants, loss, readyPoolFixture } from "./helpers/pool";
import { EV_A, EV_B, Status, TERMS, WINDOW, deployTriggerFixture, expectStatuses, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

const U = A_UNITS + B_UNITS;

describe("FaultlineTrigger × FaultlinePool — integration", () => {
  it("invest → submit → window → execute → sponsor credited floor(U*L/10000) → redeem → claim; pool ends empty", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 3_333n }));
    await expectInvariants(f);
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    expect(await f.pool.sponsorCredited()).to.equal((U * 3_333n) / BPS);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal((U * 3_333n) / BPS);
    await expectInvariants(f);

    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    const index = await f.pool.currentCouponIndex();
    await expect(f.pool.connect(f.investor).redeem())
      .to.emit(f.pool, "Redeemed")
      .withArgs(f.investor.address, A_UNITS, (A_UNITS * (BPS - 3_333n)) / BPS, (A_UNITS * index) / SCALE);
    await f.pool.connect(f.investor2).redeem();
    await f.pool.sweepDust();
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0);
    await expectInvariants(f, { swept: true });
  });

  it("redeem is blocked before submissionDeadline() and while pendingCount > 0; opens after execute", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    await travelTo(D - WINDOW / 2n); // in grace
    await submit(f, makeAtt(f, { observedAt: f.s.maturity, lossBps: 1_000n })); // quake on the last day
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await travelTo(D + 1n);
    expect(await f.trigger.pendingCount()).to.equal(1);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await travelTo(D + WINDOW);
    await f.trigger.execute(EV_A); // execute still works after the deadline
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    await expectInvariants(f);
  });

  it("a vetoed event also unblocks redemption, and the pool sees no loss", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    await travelTo(D - WINDOW / 2n); // submitted in grace, so its window is still open after the deadline
    await submit(f, makeAtt(f, { observedAt: f.s.maturity }));
    await travelTo(D + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await f.trigger.connect(f.trustee).pause(); // a pause after the deadline does not block redeem, and the veto still works
    await f.trigger.connect(f.trustee).veto(EV_A);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.investor.address, A_UNITS, A_UNITS, (A_UNITS * (await f.pool.currentCouponIndex())) / SCALE);
    expect(await f.pool.appliedLossBps()).to.equal(0);
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed });
  });

  it("invariant 11: no submit succeeds after the first redeem", async () => {
    const f = await loadFixture(triggerFixture);
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    await f.pool.connect(f.investor).redeem();
    await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
    await f.trigger.connect(f.trustee).pause();
    await advance(1000n);
    await f.trigger.unpause();
    await expect(submit(f, makeAtt(f, { eventId: EV_B }))).to.be.revertedWithCustomError(f.trigger, "SubmissionClosed");
  });

  it("D1 through the pool: two quakes of 5000 each fully write down the bond; the sponsor gets all collateral", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await submit(f, makeAtt(f, { eventId: EV_B }));
    await advance(WINDOW);
    await f.trigger.execute(EV_B);
    await f.trigger.execute(EV_A);
    expect(await f.pool.collateralLeft()).to.equal(0);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(U);
    await expectInvariants(f);
  });

  it("D12 holds: the real trigger cannot submit a quake before riskStart, and the pool rejects an early loss from a test trigger", async () => {
    const f = await loadFixture(deployTriggerFixture);
    await travelTo(f.s.issuanceStart);
    await f.pool.connect(f.investor).invest(MIN_TICKET);
    const nowTs = f.s.issuanceStart + 1n;
    await expect(submit(f, makeAtt(f, { observedAt: nowTs })))
      .to.be.revertedWithCustomError(f.trigger, "ObservedOutsideRiskPeriod")
      .withArgs(nowTs);
    const h = await loadFixture(earlyLossFixture); // MockTrigger world, also before riskStart

    await expect(loss(h, 1_000)).to.be.revertedWithCustomError(h.pool, "RiskPeriodNotStarted");
  });
});

/** MockTrigger world inside the issuance window (before riskStart), with an investment. */
async function earlyLossFixture() {
  const f = await readyPoolFixture();
  await travelTo(f.s.issuanceStart);
  await f.pool.connect(f.investor).invest(MIN_TICKET);
  return f;
}

describe("A trigger the pool does not know (RT-09)", () => {
  async function secondTriggerFixture() {
    const f = await triggerFixture();
    const rogue = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), TERMS, WINDOW, f.oracle.address, f.admin.address, f.trustee.address]);
    return { ...f, rogue };
  }

  it("execute on a second trigger for the same pool bubbles OnlyTrigger and changes neither side", async () => {
    const f = await loadFixture(secondTriggerFixture);
    const att = makeAtt(f);
    await f.rogue.connect(f.relayer).submit(att, await sign(f.oracle, att, await f.rogue.getAddress()));
    await advance(WINDOW);
    await expect(f.rogue.execute(EV_A)).to.be.revertedWithCustomError(f.pool, "OnlyTrigger");
    expect((await f.rogue.getEventRecord(EV_A)).status).to.equal(Status.Pending); // the revert undid the status change
    expect(await f.rogue.pendingCount()).to.equal(1n);
    expect(await f.pool.appliedLossBps()).to.equal(0);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(0n);
  });

  it("the pool reads only its own trigger: an event stuck on a second trigger never blocks redemption", async () => {
    const f = await loadFixture(secondTriggerFixture);
    const att = makeAtt(f);
    await f.rogue.connect(f.relayer).submit(att, await sign(f.oracle, att, await f.rogue.getAddress()));
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    expect(await f.rogue.pendingCount()).to.equal(1n);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
  });

  it("initialize refuses a trigger built for another pool", async () => {
    const f = await loadFixture(deployPoolFixture);
    const other = await ethers.deployContract("FaultlinePool", [f.params]);
    const foreign = await ethers.deployContract("MockTrigger", [await other.getAddress()]);
    await expect(f.pool.initialize(await foreign.getAddress())).to.be.revertedWithCustomError(f.pool, "TriggerMismatch");
  });
});

describe("Exact boundaries against the real trigger (RT-10)", () => {
  const at = (ts: bigint) => time.setNextBlockTimestamp(ts);

  it("redeem: at the deadline D RedemptionNotOpen, at exactly D + 1 it works", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    await at(D);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await at(D + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
  });

  it("sweepExcess: D RedemptionNotOpen, exactly D + 1 works", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    await at(D);
    await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await at(D + 1n);
    await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept");
  });

  it("sweepDust: D RedemptionNotOpen, exactly D + 1 passes with supply 0", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const D = await f.trigger.submissionDeadline();
    await at(D);
    await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await at(D + 1n);
    await expect(f.pool.sweepDust()).to.emit(f.pool, "DustSwept");
  });

  it("sweepDust at D + 1 with units outstanding fails on supply, not on time", async () => {
    const f = await loadFixture(triggerFixture);
    await at((await f.trigger.submissionDeadline()) + 1n);
    await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "SupplyNotZero");
  });

  it("submit at exactly D works and the pending event then blocks redeem at D + 1: the two never overlap", async () => {
    const f = await loadFixture(triggerFixture);
    const D = await f.trigger.submissionDeadline();
    const att = makeAtt(f, { deadline: D + 100n });
    const sig = await sign(f.oracle, att, await f.trigger.getAddress());
    await at(D);
    await f.trigger.connect(f.relayer).submit(att, sig);
    await at(D + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
  });

  it("a pause moves the redeem edge by exactly its length", async () => {
    const f = await loadFixture(triggerFixture);
    const D0 = await f.trigger.submissionDeadline();
    await f.trigger.connect(f.trustee).pause();
    await advance(7_777n);
    await f.trigger.connect(f.admin).unpause();
    const D = await f.trigger.submissionDeadline();
    expect(D - D0).to.equal(await f.trigger.totalPausedSeconds());
    expect(D - D0).to.be.gte(7_777n);
    await at(D);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await at(D + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
  });

  it("a pause moves the sweepExcess and sweepDust edges too", async () => {
    const f = await loadFixture(deployTriggerFixture);
    await f.trigger.connect(f.trustee).pause();
    await advance(100n);
    await f.trigger.connect(f.admin).unpause();
    const D = await f.trigger.submissionDeadline();
    await at(D);
    await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await at(D + 1n);
    await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept");
    await expect(f.pool.sweepDust()).to.emit(f.pool, "DustSwept");
  });
});
