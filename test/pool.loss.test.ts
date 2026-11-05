// FaultlinePool.applyLoss: trigger only, D12 riskStart guard, monotonic, range, path-independent sponsor credit,
// coupon checkpoint before L changes, RedemptionStarted.
import { expect } from "chai";
import fc from "fast-check";
import { loadFixture, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { travelTo } from "./helpers/time";
import {
  A_UNITS,
  B_UNITS,
  BPS,
  MIN_TICKET,
  YEAR_HALF,
  accrual,
  atTime,
  expectInvariants,
  investedPoolFixture,
  loss,
  readyPoolFixture,
} from "./helpers/pool";

const U = A_UNITS + B_UNITS;

describe("FaultlinePool — applyLoss", () => {
  it("only the trigger may call it (OnlyTrigger), not even the admin or the sponsor", async () => {
    const f = await loadFixture(investedPoolFixture);
    for (const who of [f.admin, f.sponsor, f.investor]) {
      await expect(f.pool.connect(who).applyLoss(1000)).to.be.revertedWithCustomError(f.pool, "OnlyTrigger");
    }
  });

  it("D12: before riskStart it reverts RiskPeriodNotStarted (riskStart - 1), from riskStart it works", async () => {
    const f = await loadFixture(readyPoolFixture);
    await travelTo(f.s.issuanceStart);
    await f.pool.connect(f.investor).invest(A_UNITS);
    await expect(loss(f, 1000)).to.be.revertedWithCustomError(f.pool, "RiskPeriodNotStarted");
    await atTime(f.s.riskStart - 1n);
    await expect(loss(f, 1000)).to.be.revertedWithCustomError(f.pool, "RiskPeriodNotStarted");
    await atTime(f.s.riskStart);
    await expect(loss(f, 1000)).to.emit(f.pool, "LossApplied").withArgs(0, 1000, (A_UNITS * 1000n) / BPS);
    await expectInvariants(f);
  });

  it("D12: an early loss can therefore never precede an invest (issuance window is before riskStart)", async () => {
    const f = await loadFixture(readyPoolFixture);
    await travelTo(f.s.issuanceStart);
    await expect(loss(f, 5000)).to.be.revertedWithCustomError(f.pool, "RiskPeriodNotStarted");
    await f.pool.connect(f.investor).invest(MIN_TICKET);
    expect(await f.pool.appliedLossBps()).to.equal(0);
    await expectInvariants(f);
  });

  it("raises L, credits floor(U*L/10000) to the sponsor's claimable and emits LossApplied(prev, new, credit)", async () => {
    const f = await loadFixture(investedPoolFixture);
    const credit = (U * 2500n) / BPS;
    await expect(loss(f, 2500)).to.emit(f.pool, "LossApplied").withArgs(0, 2500, credit);
    expect(await f.pool.appliedLossBps()).to.equal(2500);
    expect(await f.pool.sponsorCredited()).to.equal(credit);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(credit);
    expect(await f.pool.totalClaimable()).to.equal(credit);
    expect(await f.pool.collateralLeft()).to.equal(U - credit);
    await expectInvariants(f);
  });

  it("range: 10001 reverts LossOutOfRange; 10000 (full write-down) works", async () => {
    const f = await loadFixture(investedPoolFixture);
    await expect(loss(f, 10_001)).to.be.revertedWithCustomError(f.pool, "LossOutOfRange").withArgs(10_001);
    await expect(loss(f, 10_000)).to.emit(f.pool, "LossApplied").withArgs(0, 10_000, U);
    expect(await f.pool.collateralLeft()).to.equal(0);
    await expectInvariants(f);
  });

  it("monotonic: 0, the same value and a lower value revert LossNotIncreasing(applied, requested)", async () => {
    const f = await loadFixture(investedPoolFixture);
    await expect(loss(f, 0)).to.be.revertedWithCustomError(f.pool, "LossNotIncreasing").withArgs(0, 0);
    await loss(f, 3000);
    await expect(loss(f, 3000)).to.be.revertedWithCustomError(f.pool, "LossNotIncreasing").withArgs(3000, 3000);
    await expect(loss(f, 2000)).to.be.revertedWithCustomError(f.pool, "LossNotIncreasing").withArgs(3000, 2000);
    await loss(f, 10_000);
    await expect(loss(f, 10_000)).to.be.revertedWithCustomError(f.pool, "LossNotIncreasing").withArgs(10_000, 10_000);
    await expectInvariants(f);
  });

  it("30 % then 70 % credits exactly what 70 % alone does: floor(U*7000/10000)", async () => {
    const f = await loadFixture(investedPoolFixture);
    const snap = await takeSnapshot();
    const c1 = (U * 3000n) / BPS;
    const c70 = (U * 7000n) / BPS;
    await expect(loss(f, 3000)).to.emit(f.pool, "LossApplied").withArgs(0, 3000, c1);
    await expect(loss(f, 7000)).to.emit(f.pool, "LossApplied").withArgs(3000, 7000, c70 - c1);
    const twoStep = await f.pool.sponsorCredited();
    await expectInvariants(f);
    await snap.restore();
    await loss(f, 7000);
    expect(await f.pool.sponsorCredited()).to.equal(twoStep);
    expect(twoStep).to.equal(c70);
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(c70);
  });

  it("checkpoints the coupon index at the OLD loss before L changes (D7)", async () => {
    const f = await loadFixture(investedPoolFixture);
    const t1 = f.s.riskStart + YEAR_HALF;
    await atTime(t1);
    await loss(f, 5000);
    const idx1 = accrual(0n, t1 - f.s.riskStart);
    expect(await f.pool.couponIndex()).to.equal(idx1);
    expect(await f.pool.lastAccrual()).to.equal(t1);
    await travelTo(f.s.maturity + 10n);
    expect(await f.pool.currentCouponIndex()).to.equal(idx1 + accrual(5000n, f.s.maturity - t1));
    await expectInvariants(f);
  });

  it("a loss after maturity checkpoints only up to maturity; later losses add no accrual", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.s.maturity + 100n);
    await loss(f, 4000);
    const full = accrual(0n, f.s.maturity - f.s.riskStart);
    expect(await f.pool.couponIndex()).to.equal(full);
    expect(await f.pool.lastAccrual()).to.equal(f.s.maturity);
    await loss(f, 6000);
    expect(await f.pool.couponIndex()).to.equal(full);
    await expectInvariants(f);
  });

  it("reverts RedemptionStarted after the first redemption (defensive)", async () => {
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    await f.pool.connect(f.investor).redeem();
    await expect(loss(f, 1000)).to.be.revertedWithCustomError(f.pool, "RedemptionStarted");
  });

  it("property (fast-check, on-chain): any increasing loss sequence credits floor(U*Lfinal/10000) in total", async () => {
    const base = await loadFixture(readyPoolFixture);
    const runs = Number(process.env.FC_RUNS ?? 15);
    const seed = Number(process.env.FC_SEED ?? Date.now() & 0x7fffffff);
    console.log(`      fast-check seed ${seed}, runs ${runs} (FC_SEED, FC_RUNS)`);
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: MIN_TICKET, max: USD(5_000) }),
        fc.bigInt({ min: MIN_TICKET, max: USD(5_000) }),
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 4 }),
        async (a, b, raw) => {
          const snap = await takeSnapshot();
          try {
            const steps = [...raw].sort((x, y) => x - y);
            await travelTo(base.s.issuanceStart);
            await base.pool.connect(base.investor).invest(a);
            await base.pool.connect(base.investor2).invest(b);
            await travelTo(base.s.riskStart);
            let credits = 0n;
            for (const s of steps) {
              const r = await (await loss(base, s)).wait();
              const ev = r!.logs.map((l) => base.pool.interface.parseLog(l)).find((e) => e?.name === "LossApplied");
              credits += ev!.args.sponsorCredit as bigint;
            }
            const expected = ((a + b) * BigInt(steps[steps.length - 1])) / BPS;
            expect(credits).to.equal(expected);
            expect(await base.pool.sponsorCredited()).to.equal(expected);
            await expectInvariants(base);
          } finally {
            await snap.restore();
          }
        },
      ),
      { numRuns: runs, seed },
    );
  });
});
