// FaultlinePool.sweepExcess (D3) and sweepDust: same gates as redeem, credit the sponsor (never push), and leave
// every unredeemed holder fully covered.
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { travelTo } from "./helpers/time";
import { B_UNITS, BPS, SCALE, atTime, deployPoolFixture, expectInvariants, investedPoolFixture, loss } from "./helpers/pool";

/** Invested, 25 % loss mid-term (so part of the coupon reserve is unused), past the deadline; investor redeemed,
 *  investor2 never does. */
async function oneHolderLeftFixture() {
  const f = await investedPoolFixture();
  await atTime(f.s.riskStart + 1000n);
  await loss(f, 2500);
  await travelTo(f.deadline + 1n);
  await f.pool.connect(f.investor).redeem();
  return f;
}

describe("FaultlinePool — sweepExcess (D3)", () => {
  it("with one holder never redeeming, credits only the excess to the sponsor; a second call credits 0", async () => {
    const f = await loadFixture(oneHolderLeftFixture);
    const poolAddr = await f.pool.getAddress();
    const bal = await f.usd.balanceOf(poolAddr);
    const totalClaimable = await f.pool.totalClaimable();
    const index = await f.pool.currentCouponIndex();
    const owed = (B_UNITS * (BPS - 2500n)) / BPS + (B_UNITS * index) / SCALE;
    const excess = bal - totalClaimable - owed;
    expect(excess > 0n).to.equal(true);
    const sponsorBefore = await f.pool.claimable(f.sponsor.address);
    await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept").withArgs(excess);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(sponsorBefore + excess);
    expect(await f.usd.balanceOf(poolAddr)).to.equal(bal); // credited, not pushed
    await expectInvariants(f, { swept: true });
    await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept").withArgs(0);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(sponsorBefore + excess);

    // The holder who stayed is still fully covered, and everyone can claim.
    await f.pool.connect(f.investor2).redeem();
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    await expectInvariants(f, { swept: true });
    await expect(f.pool.sweepDust()).to.emit(f.pool, "DustSwept").withArgs(0); // sweepExcess already took the dust
    expect(await f.pool.totalClaimable()).to.equal(0);
    expect(await f.usd.balanceOf(poolAddr)).to.equal(0); // nothing left behind, nothing over-paid
  });

  it("anyone may call it, but only after the deadline (RedemptionNotOpen) and with no pending event (EventPending)", async () => {
    const f = await loadFixture(investedPoolFixture);
    await atTime(f.deadline);
    await expect(f.pool.connect(f.other).sweepExcess()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await travelTo(f.deadline + 5n);
    await f.trigger.test_setPendingCount(2);
    await expect(f.pool.connect(f.other).sweepExcess()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await f.trigger.test_setPendingCount(0);
    await expect(f.pool.connect(f.other).sweepExcess()).to.emit(f.pool, "ExcessSwept");
    await expectInvariants(f, { swept: true });
  });

  it("is blocked by the supply guard (D4) and before initialize", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    await f.bond.test_adjustBalance(f.other.address, 1n);
    await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch");
    const g = await loadFixture(deployPoolFixture);
    await expect(g.pool.sweepExcess()).to.be.revertedWithCustomError(g.pool, "NotInitialized");
  });
});

describe("FaultlinePool — sweepDust", () => {
  it("reverts SupplyNotZero(supply) while units are outstanding", async () => {
    const f = await loadFixture(oneHolderLeftFixture);
    await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "SupplyNotZero").withArgs(B_UNITS);
  });

  it("at zero supply credits balance - totalClaimable (rounding dust + stray transfers) to the sponsor", async () => {
    const f = await loadFixture(oneHolderLeftFixture);
    await f.pool.connect(f.investor2).redeem();
    const poolAddr = await f.pool.getAddress();
    await f.usd.connect(f.stranger).transfer(poolAddr, 77n); // a stray transfer
    const dust = (await f.usd.balanceOf(poolAddr)) - (await f.pool.totalClaimable());
    expect(dust >= 77n).to.equal(true);
    const before = await f.pool.claimable(f.sponsor.address);
    await expect(f.pool.connect(f.other).sweepDust()).to.emit(f.pool, "DustSwept").withArgs(dust);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(before + dust);
    expect(await f.usd.balanceOf(poolAddr)).to.equal(await f.pool.totalClaimable());
    await expectInvariants(f, { swept: true });
    await expect(f.pool.sweepDust()).to.emit(f.pool, "DustSwept").withArgs(0);
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    expect(await f.usd.balanceOf(poolAddr)).to.equal(0);
    await expectInvariants(f, { swept: true });
  });

  it("respects the deadline (RedemptionNotOpen), a moved deadline (pause) and pending events (EventPending)", async () => {
    const f = await loadFixture(oneHolderLeftFixture);
    await f.pool.connect(f.investor2).redeem();
    await f.trigger.test_setPendingCount(1);
    await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await f.trigger.test_setPendingCount(0);
    await f.trigger.test_setSubmissionDeadline(f.deadline + 10_000n);
    await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    const g = await loadFixture(deployPoolFixture);
    await expect(g.pool.sweepDust()).to.be.revertedWithCustomError(g.pool, "NotInitialized");
  });
});
