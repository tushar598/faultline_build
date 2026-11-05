// FaultlineTrigger.execute (D1: per-event loss, L = min(10000, L + lossBps)), Superseded at L == 10000, pendingCount
// bookkeeping, and oracle rotation.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { advance } from "./helpers/time";
import { A_UNITS, B_UNITS, BPS } from "./helpers/pool";
import { ROLES } from "./helpers/roles";
import { EV_A, EV_B, EV_C, Status, WINDOW, expectStatuses, makeAtt, submit, triggerFixture } from "./helpers/trigger";

const U = A_UNITS + B_UNITS;

/** Two pending events, A and B, both past their window. */
async function twoPendingFixture() {
  const f = await triggerFixture();
  await submit(f, makeAtt(f, { lossBps: 5_000n }));
  await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 5_000n }));
  await advance(WINDOW);
  return f;
}

describe("FaultlineTrigger — execute", () => {
  it("anyone executes after the window: Executed, pool.applyLoss(L + lossBps), EventExecuted, pendingCount--", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 2_500n }));
    await advance(WINDOW);
    const tx = f.trigger.connect(f.other).execute(EV_A);
    await expect(tx).to.emit(f.trigger, "EventExecuted").withArgs(EV_A, 2_500, 2_500);
    await expect(tx).to.emit(f.pool, "LossApplied").withArgs(0, 2_500, (U * 2_500n) / BPS);
    expect(await f.pool.appliedLossBps()).to.equal(2_500);
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed });
  });

  it("reverts NotPending for unknown, vetoed and executed events", async () => {
    const f = await loadFixture(twoPendingFixture);
    await expect(f.trigger.execute(EV_C)).to.be.revertedWithCustomError(f.trigger, "NotPending").withArgs(EV_C);
    await f.trigger.execute(EV_A);
    await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "NotPending").withArgs(EV_A);
    await submit(f, makeAtt(f, { eventId: EV_C, lossBps: 100n }));
    await f.trigger.connect(f.trustee).veto(EV_C);
    await expect(f.trigger.execute(EV_C)).to.be.revertedWithCustomError(f.trigger, "NotPending").withArgs(EV_C);
  });

  it("D1: A (5000) and B (5000) pending — execute A then B → L = 10000, and B then A gives the same L", async () => {
    const f = await loadFixture(twoPendingFixture);
    const snap = await takeSnapshot();
    await expect(f.trigger.execute(EV_A)).to.emit(f.trigger, "EventExecuted").withArgs(EV_A, 5_000, 5_000);
    await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventExecuted").withArgs(EV_B, 5_000, 10_000);
    const ab = await f.pool.appliedLossBps();
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Executed });
    await snap.restore();
    await f.trigger.execute(EV_B);
    await f.trigger.execute(EV_A);
    expect(await f.pool.appliedLossBps()).to.equal(ab);
    expect(ab).to.equal(10_000);
    expect(await f.pool.sponsorCredited()).to.equal(U);
  });

  it("D1: vetoing A never changes B's loss — veto A, execute B → L = 5000", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 5_000n }));
    await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 5_000n }));
    await f.trigger.connect(f.trustee).veto(EV_A);
    await advance(WINDOW);
    await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventExecuted").withArgs(EV_B, 5_000, 5_000);
    expect(await f.pool.appliedLossBps()).to.equal(5_000);
    await expectStatuses(f.trigger, { [EV_A]: Status.Vetoed, [EV_B]: Status.Executed });
  });

  it("D1: uneven losses (3000 + 4000) give 7000 in either order; the sum is capped at 10000 (7000 + 5000)", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 3_000n }));
    await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 4_000n }));
    await submit(f, makeAtt(f, { eventId: EV_C, lossBps: 5_000n }));
    await advance(WINDOW);
    const snap = await takeSnapshot();
    await f.trigger.execute(EV_A);
    await f.trigger.execute(EV_B);
    expect(await f.pool.appliedLossBps()).to.equal(7_000);
    await snap.restore();
    await f.trigger.execute(EV_B);
    await f.trigger.execute(EV_A);
    expect(await f.pool.appliedLossBps()).to.equal(7_000);
    await expect(f.trigger.execute(EV_C)).to.emit(f.trigger, "EventExecuted").withArgs(EV_C, 5_000, 10_000);
    expect(await f.pool.sponsorCredited()).to.equal(U);
  });

  it("once L == 10000 another execute marks the event Superseded (EventSuperseded), no revert, pool unchanged", async () => {
    const f = await loadFixture(twoPendingFixture);
    await submit(f, makeAtt(f, { eventId: EV_C, lossBps: 1_000n }));
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    await f.trigger.execute(EV_B);
    const credited = await f.pool.sponsorCredited();
    const tx = f.trigger.execute(EV_C);
    await expect(tx).to.emit(f.trigger, "EventSuperseded").withArgs(EV_C, 1_000);
    await expect(tx).to.not.emit(f.pool, "LossApplied");
    expect(await f.pool.appliedLossBps()).to.equal(10_000);
    expect(await f.pool.sponsorCredited()).to.equal(credited);
    await expectStatuses(f.trigger, { [EV_A]: Status.Executed, [EV_B]: Status.Executed, [EV_C]: Status.Superseded });
  });

  it("pendingCount equals the number of Pending events after every step; terminal statuses never change", async () => {
    const f = await loadFixture(triggerFixture);
    const model: Record<string, bigint> = {};
    const step = async (fn: () => Promise<unknown>, id: string, status: bigint) => {
      await fn();
      model[id] = status;
      await expectStatuses(f.trigger, model);
    };
    await step(() => submit(f, makeAtt(f, { lossBps: 1_000n })), EV_A, Status.Pending);
    await step(() => submit(f, makeAtt(f, { eventId: EV_B, lossBps: 2_000n })), EV_B, Status.Pending);
    await step(() => submit(f, makeAtt(f, { nonce: 2n, usgsUpdatedAt: makeAtt(f).usgsUpdatedAt + 1n, lossBps: 900n })), EV_A, Status.Pending);
    await step(() => f.trigger.connect(f.trustee).veto(EV_B), EV_B, Status.Vetoed);
    await step(() => submit(f, makeAtt(f, { eventId: EV_C, lossBps: 9_500n })), EV_C, Status.Pending);
    await advance(WINDOW);
    await step(() => f.trigger.execute(EV_C), EV_C, Status.Executed);
    await step(() => f.trigger.execute(EV_A), EV_A, Status.Executed);
    expect(await f.pool.appliedLossBps()).to.equal(10_000); // 9500 + 900 capped
    for (const id of [EV_A, EV_B, EV_C]) {
      await expect(f.trigger.execute(id)).to.be.revertedWithCustomError(f.trigger, "NotPending");
      await expect(f.trigger.connect(f.trustee).veto(id)).to.be.revertedWithCustomError(f.trigger, "NotPending");
    }
    await expectStatuses(f.trigger, model);
  });
});

describe("FaultlineTrigger — oracle rotation", () => {
  it("admin only; zero reverts ZeroAddress; OracleRotated(old, new)", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(f.trigger.connect(f.trustee).setOracle(f.oracle2.address))
      .to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount")
      .withArgs(f.trustee.address, ROLES.DEFAULT_ADMIN);
    await expect(f.trigger.setOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.trigger, "ZeroAddress");
    await expect(f.trigger.setOracle(f.oracle2.address)).to.emit(f.trigger, "OracleRotated").withArgs(f.oracle.address, f.oracle2.address);
    expect(await f.trigger.oracle()).to.equal(f.oracle2.address);
  });

  it("the old oracle's new signatures fail, the new oracle's work, and a pending event signed by the old oracle still executes", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f, { lossBps: 2_000n }), f.oracle);
    await f.trigger.setOracle(f.oracle2.address);
    await expect(submit(f, makeAtt(f, { eventId: EV_B }), f.oracle)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
    await expect(submit(f, makeAtt(f, { eventId: EV_B, lossBps: 1_000n }), f.oracle2)).to.emit(f.trigger, "AttestationSubmitted");
    await advance(WINDOW);
    await expect(f.trigger.execute(EV_A)).to.emit(f.trigger, "EventExecuted").withArgs(EV_A, 2_000, 2_000);
    await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventExecuted").withArgs(EV_B, 1_000, 3_000);
  });
});
