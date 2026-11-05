// FaultlinePool.redeem: opens strictly after trigger.submissionDeadline() with no pending event (D2), supply guard
// (D4), floor rounding against the holder, no holder KYC (S1), and the transfer-before-loss regression.
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { travelTo } from "./helpers/time";
import {
  A_UNITS,
  B_UNITS,
  BPS,
  SCALE,
  YEAR_HALF,
  accrual,
  atTime,
  deployPoolFixture,
  expectInvariants,
  investedPoolFixture,
  loss,
} from "./helpers/pool";

/** Invested; a 33.33 % loss executed half-way through the risk period. Chain time is at the loss. */
async function lossFixture() {
  const f = await investedPoolFixture();
  const tLoss = f.s.riskStart + YEAR_HALF;
  await atTime(tLoss);
  await loss(f, 3333);
  const index = accrual(0n, tLoss - f.s.riskStart) + accrual(3333n, f.s.maturity - tLoss);
  return { ...f, tLoss, index };
}

const owed = (units: bigint, L: bigint, index: bigint) => ({ principal: (units * (BPS - L)) / BPS, coupon: (units * index) / SCALE });

describe("FaultlinePool — redeem", () => {
  it("credits floor(b*(10000-L)/10000) + floor(b*index/1e18), burns all b units via controllerRedeem, emits Redeemed", async () => {
    const f = await loadFixture(lossFixture);
    await travelTo(f.deadline + 1n);
    const { principal, coupon } = owed(A_UNITS, 3333n, f.index);
    expect(await f.pool.effectiveValue(f.investor.address)).to.deep.equal([principal, coupon]);
    const tx = f.pool.connect(f.investor).redeem();
    await expect(tx).to.emit(f.pool, "Redeemed").withArgs(f.investor.address, A_UNITS, principal, coupon);
    await expect(tx).to.emit(f.bond, "ControllerRedemption").withArgs(await f.pool.getAddress(), f.investor.address, A_UNITS, "0x", "0x");
    expect(await f.bond.balanceOf(f.investor.address)).to.equal(0);
    expect(await f.pool.claimable(f.investor.address)).to.equal(principal + coupon);
    expect(await f.pool.unitsRedeemed()).to.equal(A_UNITS);
    expect(await f.pool.principalPaid()).to.equal(principal);
    expect(await f.pool.couponPaid()).to.equal(coupon);
    expect(await f.pool.couponIndex()).to.equal(f.index);
    expect(await f.pool.lastAccrual()).to.equal(f.s.maturity);
    // Both values really were rounded down (odd balances).
    expect((A_UNITS * (BPS - 3333n)) % BPS).to.not.equal(0n);
    expect((A_UNITS * f.index) % SCALE).to.not.equal(0n);
    await expectInvariants(f);
  });

  it("opens strictly after the deadline: at deadline RedemptionNotOpen, at deadline + 1 it works", async () => {
    const f = await loadFixture(investedPoolFixture);
    await atTime(f.deadline);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await atTime(f.deadline + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.not.be.reverted;
  });

  it("pause case (D2): while the trigger reports a later deadline, redeem stays closed", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 10n);
    await f.trigger.test_setSubmissionDeadline(f.deadline + 3600n); // a running pause moves the deadline with the clock
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    await travelTo(f.deadline + 3601n);
    await expect(f.pool.connect(f.investor).redeem()).to.not.be.reverted;
  });

  it("reverts EventPending while the trigger has a pending event", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    await f.trigger.test_setPendingCount(1);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "EventPending");
    await f.trigger.test_setPendingCount(0);
    await expect(f.pool.connect(f.investor).redeem()).to.not.be.reverted;
  });

  it("reverts NotInitialized before initialize", async () => {
    const f = await loadFixture(deployPoolFixture);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "NotInitialized");
  });

  it("D4: a foreign mint blocks redemption with SupplyMismatch instead of paying the extra units", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    await f.bond.test_adjustBalance(f.investor.address, 1_000n);
    await expect(f.pool.connect(f.investor).redeem())
      .to.be.revertedWithCustomError(f.pool, "SupplyMismatch")
      .withArgs(A_UNITS + B_UNITS + 1_000n, A_UNITS + B_UNITS);
    await expectInvariants(f, { supplyBroken: true });
  });

  it("reverts NothingToRedeem for a wallet without units and on a second redeem", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    await expect(f.pool.connect(f.other).redeem()).to.be.revertedWithCustomError(f.pool, "NothingToRedeem");
    await f.pool.connect(f.investor).redeem();
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "NothingToRedeem");
    await expectInvariants(f);
  });

  it("a holder whose BOND KYC was revoked still redeems (ATS controllerRedeem has no KYC check, S1)", async () => {
    const f = await loadFixture(investedPoolFixture);
    await f.bond.revokeKyc(f.investor.address);
    await travelTo(f.deadline + 1n);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    expect(await f.bond.balanceOf(f.investor.address)).to.equal(0);
  });

  it("no loss: full principal plus the full-term coupon", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    const { principal, coupon } = owed(B_UNITS, 0n, accrual(0n, f.s.maturity - f.s.riskStart));
    await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.investor2.address, B_UNITS, principal, coupon);
    expect(principal).to.equal(B_UNITS);
    await expectInvariants(f);
  });

  it("full write-down: principal 0, coupon only for the time before the loss", async () => {
    const f = await loadFixture(investedPoolFixture);
    const t = f.s.riskStart + 1000n;
    await atTime(t);
    await loss(f, 10_000);
    await travelTo(f.deadline + 1n);
    const { coupon } = owed(A_UNITS, 10_000n, accrual(0n, t - f.s.riskStart));
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.investor.address, A_UNITS, 0, coupon);
    await expectInvariants(f);
  });

  it("regression (main review finding): units moved to a new KYC'd wallet just before the loss — the buyer inherits the loss", async () => {
    const f = await loadFixture(investedPoolFixture);
    const moved = USD(100) + 33n;
    await f.bond.connect(f.investor).transfer(f.buyer.address, moved); // a brand-new holder the pool never saw
    await loss(f, 5000); // execution still works: no holder registry, O(1)
    await expectInvariants(f);
    await travelTo(f.deadline + 1n);
    const index = await f.pool.currentCouponIndex();
    const buyer = owed(moved, 5000n, index);
    const seller = owed(A_UNITS - moved, 5000n, index);
    await expect(f.pool.connect(f.buyer).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.buyer.address, moved, buyer.principal, buyer.coupon);
    await expect(f.pool.connect(f.investor).redeem())
      .to.emit(f.pool, "Redeemed")
      .withArgs(f.investor.address, A_UNITS - moved, seller.principal, seller.coupon);
    expect(buyer.principal + seller.principal).to.be.lte(((A_UNITS) * 5000n) / BPS);
    await expectInvariants(f);
  });

  it("effectiveValue tracks the view-only accrual during the risk period and is 0 coupon at riskStart", async () => {
    const f = await loadFixture(investedPoolFixture);
    // investedPoolFixture stops exactly at riskStart: no coupon yet.
    expect(await f.pool.effectiveValue(f.investor.address)).to.deep.equal([A_UNITS, 0n]);
    await travelTo(f.s.riskStart + 86_400n);
    const idx = accrual(0n, 86_400n);
    expect(await f.pool.currentCouponIndex()).to.equal(idx);
    expect(await f.pool.effectiveValue(f.investor.address)).to.deep.equal([A_UNITS, (A_UNITS * idx) / SCALE]);
    expect(await f.pool.effectiveValue(f.other.address)).to.deep.equal([0n, 0n]);
  });
});
