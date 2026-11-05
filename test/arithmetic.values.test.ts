// Task 2D: arithmetic and input validation on the D18 build. Mock-tested. Not repeated here because RT-18 and the setup tests
// already cover them: zero addresses in both constructors and in `initialize`, `setOracle(0)`, zero coupon, cap and ticket, the
// schedule order, the D17 bounds, 6-decimal happy path, `invest(MaxUint256)`, the exact cap, `associate()` code casts, no-code
// addresses, dirty calldata, attestation time boundaries and 0 / 10001 at the `submit` gate. New here: wrong decimals one by one,
// very large books, the five loss levels end to end, rounding on the smallest amounts, and odd but deployable config.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD, onboardUsd } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { HOUR, YEAR, now, travelTo } from "./helpers/time";
import { A_UNITS, B_UNITS, BPS, CAP, COUPON_BPS, SCALE, accrual, deployPoolFixture, expectInvariants, investedPoolFixture, loss, reserveFor, wirePool } from "./helpers/pool";
import { EV_A, EV_B, Status, WINDOW, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

type World = Awaited<ReturnType<typeof deployPoolFixture>>;

/** A second pool on fresh mocks. `maxSupply` 0 is an unlimited bond; `treasury` is the stablecoin's whole supply. */
async function poolWith(f: World, over: Record<string, unknown>, treasury = USD(1_000_000), maxSupply = 0n) {
  const usd = await ethers.deployContract("MockUSD", [treasury]);
  const bond = await ethers.deployContract("MockBond", [f.admin.address, maxSupply, true]);
  const params = { ...f.params, stablecoin: await usd.getAddress(), bond: await bond.getAddress(), ...over };
  const pool = await ethers.deployContract("FaultlinePool", [params]);
  const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
  const deadline = BigInt(params.maturity as bigint) + BigInt(params.grace as bigint);
  if (deadline < 2n ** 64n) await trigger.test_setSubmissionDeadline(deadline);
  return { ...f, usd, bond, pool, trigger, params } as unknown as World;
}

/** Associates, grants KYC and pays `who`; makes the pool usable on `w`'s own mocks. */
async function wireCustom(w: World, investors: typeof w.investor[], amount: bigint) {
  const poolAddr = await w.pool.getAddress();
  await w.pool.initialize(await w.trigger.getAddress());
  await w.usd.grantKyc(poolAddr);
  await w.bond.grantRole(ROLES.KYC, w.admin.address);
  await w.bond.grantRole(ROLES.ISSUER, poolAddr);
  await w.bond.grantRole(ROLES.CONTROLLER, poolAddr);
  for (const who of [w.sponsor, ...investors]) {
    await onboardUsd(w.usd, who, amount);
    await w.usd.connect(who).approve(poolAddr, ethers.MaxUint256);
  }
  for (const who of investors) await w.bond.grantKyc(who.address, "vc", 0, 2n ** 64n, w.admin.address);
}

describe("Arithmetic and input validation (task 2D)", () => {
  describe("wrong token decimals", () => {
    for (const decimals of [0, 5, 7, 18, 255]) {
      it(`a stablecoin or a bond with ${decimals} decimals is refused at deployment`, async () => {
        const f = await loadFixture(deployPoolFixture);
        const variant = await ethers.deployContract("MockTokenVariant", [decimals, 22]);
        const factory = await ethers.getContractFactory("FaultlinePool");
        await expect(factory.deploy({ ...f.params, stablecoin: await variant.getAddress() })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
        await expect(factory.deploy({ ...f.params, bond: await variant.getAddress() })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
      });
    }
    it("a token with no decimals() at all is refused too", async () => {
      const f = await loadFixture(deployPoolFixture);
      const noDecimals = await ethers.deployContract("RawCaller");
      const factory = await ethers.getContractFactory("FaultlinePool");
      await expect(factory.deploy({ ...f.params, stablecoin: await noDecimals.getAddress() })).to.be.reverted;
    });
  });

  describe("zero and minimum amounts", () => {
    it("invest(0) reverts BelowMinTicket, and a 1-unit ticket works when minTicket is 1", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, { minTicket: 1n, cap: 1n });
      await wireCustom(w, [w.investor], USD(5_000));
      await w.pool.connect(w.sponsor).fundCoupons(1n);
      await travelTo(f.s.issuanceStart);
      await expect(w.pool.connect(w.investor).invest(0n)).to.be.revertedWithCustomError(w.pool, "BelowMinTicket").withArgs(0n, 1n);
      await expect(w.pool.connect(w.investor).invest(1n)).to.emit(w.pool, "Invested").withArgs(w.investor.address, 1n);
      await expect(w.pool.connect(w.investor).invest(1n)).to.be.revertedWithCustomError(w.pool, "CapExceeded").withArgs(1n, 0n);
    });
    it("one unit, reserve of 1 base unit (ceil): the required reserve never rounds down to zero", async () => {
      const f = await loadFixture(deployPoolFixture);
      expect(await f.pool.requiredReserve(1n)).to.equal(1n);
      expect(await f.pool.requiredReserve(0n)).to.equal(0n);
    });
    it("an amount below the reserve needed for one more unit reverts CouponReserveInsufficient, with the exact numbers", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, {});
      await wireCustom(w, [w.investor], USD(5_000));
      const units = USD(100);
      const need = reserveFor(units, f.s);
      await w.pool.connect(w.sponsor).fundCoupons(need - 1n);
      await travelTo(f.s.issuanceStart);
      await expect(w.pool.connect(w.investor).invest(units)).to.be.revertedWithCustomError(w.pool, "CouponReserveInsufficient").withArgs(need - 1n, need);
      await w.pool.connect(w.sponsor).fundCoupons(1n);
      await expect(w.pool.connect(w.investor).invest(units)).to.emit(w.pool, "Invested");
    });
  });

  describe("very large values and overflow boundaries", () => {
    const HUGE = 2n ** 200n + 12_345n; // far above any real issue, near the point where mulDiv still has work to do
    it("U near 2^200: sponsor credit, principal and coupon stay exact, no intermediate overflow", async () => {
      const f = await loadFixture(deployPoolFixture);
      const reserve = (HUGE * COUPON_BPS) / BPS;
      const w = await poolWith(f, { cap: HUGE * 2n }, HUGE * 4n);
      await wireCustom(w, [w.investor], HUGE + reserve * 2n);
      await w.pool.connect(w.sponsor).fundCoupons(await w.pool.requiredReserve(HUGE));
      await travelTo(f.s.issuanceStart);
      await w.pool.connect(w.investor).invest(HUGE);
      await travelTo(f.s.riskStart);
      await w.trigger.forwardApplyLoss(9_999);
      expect(await w.pool.sponsorCredited()).to.equal((HUGE * 9_999n) / BPS);
      const idx = await w.pool.couponIndex();
      await travelTo(f.deadline + 1n);
      await w.pool.connect(w.investor).redeem();
      const principal = (HUGE * 1n) / BPS;
      const finalIdx = await w.pool.couponIndex();
      expect(await w.pool.principalPaid()).to.equal(principal);
      expect(await w.pool.couponPaid()).to.equal((HUGE * finalIdx) / SCALE);
      expect(finalIdx).to.be.gt(idx);
      expect(await w.pool.isSolvent()).to.equal(true);
    });
    it("the largest coupon and the longest term in the types: 65535 bps over a term near 2^64 stays in range for a normal issue", async () => {
      const f = await loadFixture(deployPoolFixture);
      const maturity = 2n ** 64n - 2n;
      const w = await poolWith(f, { couponBps: 65_535n, maturity, grace: 1n });
      const units = USD(1_000);
      const expected = (units * 65_535n * (maturity - f.s.riskStart) + BPS * YEAR - 1n) / (BPS * YEAR);
      expect(await w.pool.requiredReserve(units)).to.equal(expected);
    });
    it("requiredReserve(MaxUint256) with a coupon above 100 % overflows mulDiv's result: a panic, and invest can never get there past the cap", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, { couponBps: 65_535n });
      await expect(w.pool.requiredReserve(ethers.MaxUint256)).to.be.revertedWithPanic(0x11);
    });
    it("maturity at 2^64 - 1 deploys, but submissionDeadline() then overflows: SEC-22, a deploy-time typo with no live path", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, { maturity: 2n ** 64n - 1n, grace: 1n });
      const trigger = await ethers.deployContract("FaultlineTrigger", [await w.pool.getAddress(), ethers.ZeroHash, 3_600n, f.admin.address, f.admin.address, f.admin.address]);
      await expect(trigger.submissionDeadline()).to.be.revertedWithPanic(0x11);
    });
    it("uint64 nonce and update time at their maximum: the revision is accepted, and nothing can revise it again", async () => {
      const f = await loadFixture(triggerFixture);
      const MAX = 2n ** 64n - 1n;
      await submit(f, makeAtt(f));
      await submit(f, makeAtt(f, { nonce: MAX, usgsUpdatedAt: MAX, lossBps: 4_000n }));
      expect((await f.trigger.getEventRecord(EV_A)).nonce).to.equal(MAX);
      await expect(submit(f, makeAtt(f, { nonce: MAX, usgsUpdatedAt: MAX }))).to.be.revertedWithCustomError(f.trigger, "StaleRevision");
    });
  });

  describe("losses at 0, 1, 9,999, 10,000 and 10,001 bps through the real trigger", () => {
    for (const bad of [0n, 10_001n]) {
      it(`${bad} bps never reaches the chain state`, async () => {
        const f = await loadFixture(triggerFixture);
        await expect(submit(f, makeAtt(f, { lossBps: bad }))).to.be.revertedWithCustomError(f.trigger, "LossOutOfRange").withArgs(bad);
        expect(await f.trigger.pendingCount()).to.equal(0n);
        expect((await f.trigger.getEventRecord(EV_A)).status).to.equal(Status.None);
      });
    }
    for (const L of [1n, 9_999n, 10_000n]) {
      it(`${L} bps: exact credit, exact floors for both holders, books close to zero`, async () => {
        const f = await loadFixture(triggerFixture);
        const att = makeAtt(f, { lossBps: L });
        await submit(f, att);
        const sub = await ethers.provider.getBlock("latest");
        await travelTo(BigInt(sub!.timestamp) + WINDOW);
        await f.trigger.execute(EV_A);
        const executedAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
        const U = A_UNITS + B_UNITS;
        const credited = (U * L) / BPS;
        expect(await f.pool.appliedLossBps()).to.equal(L);
        expect(await f.pool.sponsorCredited()).to.equal(credited);
        await travelTo((await f.trigger.submissionDeadline()) + 1n);
        const index = accrual(0n, executedAt - f.s.riskStart) + (L < BPS ? accrual(L, f.s.maturity - executedAt) : 0n);
        for (const [who, units] of [[f.investor, A_UNITS], [f.investor2, B_UNITS]] as const) {
          await f.pool.connect(who).redeem();
          expect(await f.pool.claimable(who.address)).to.equal((units * (BPS - L)) / BPS + (units * index) / SCALE);
        }
        await expectInvariants(f);
        await f.pool.sweepDust();
        for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
        expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
      });
    }
    it("at 10,000 a holder still gets the coupon accrued before the write-down, and a new event reverts FullyWrittenDown", async () => {
      const f = await loadFixture(triggerFixture);
      await submit(f, makeAtt(f, { lossBps: 10_000n }));
      await travelTo((await f.trigger.windowEndsAt(EV_A)) + 1n);
      await f.trigger.execute(EV_A);
      await expect(submit(f, makeAtt(f, { eventId: EV_B }))).to.be.revertedWithCustomError(f.trigger, "FullyWrittenDown");
      await travelTo((await f.trigger.submissionDeadline()) + 1n);
      await f.pool.connect(f.investor).redeem();
      expect(await f.pool.principalPaid()).to.equal(0n);
      expect(await f.pool.claimable(f.investor.address)).to.be.gt(0n);
    });
    it("two events that overshoot are capped: 9,999 plus 9,999 ends at exactly 10,000", async () => {
      const f = await loadFixture(triggerFixture);
      await submit(f, makeAtt(f, { lossBps: 9_999n }));
      await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 9_999n }));
      await travelTo((await f.trigger.windowEndsAt(EV_B)) + 1n);
      await f.trigger.execute(EV_A);
      await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventExecuted").withArgs(EV_B, 9_999n, 10_000n);
      expect(await f.pool.sponsorCredited()).to.equal(A_UNITS + B_UNITS);
    });
  });

  describe("rounding", () => {
    it("the smallest holding at the smallest loss: 1 unit at 1 bps is worth 0 principal, and the sponsor gets the base unit only through the dust", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).transfer(f.buyer.address, 1n);
      await loss(f, 1);
      const [principal] = await f.pool.effectiveValue(f.buyer.address);
      expect(principal).to.equal(0n);
      expect(await f.pool.sponsorCredited()).to.equal(((A_UNITS + B_UNITS) * 1n) / BPS);
    });
    it("splitting a holding never gains: four 3-unit wallets are worth no more principal than one 12-unit wallet", async () => {
      const f = await loadFixture(investedPoolFixture);
      await loss(f, 3_333);
      const signers = (await ethers.getSigners()).slice(11, 15);
      for (const s of signers) {
        await f.bond.grantKyc(s.address, "vc", 0, 2n ** 64n, f.admin.address);
        await f.bond.connect(f.investor).transfer(s.address, 3n);
      }
      await f.bond.connect(f.investor).transfer(f.buyer.address, 12n);
      const single = (12n * (BPS - 3_333n)) / BPS;
      const split = 4n * ((3n * (BPS - 3_333n)) / BPS);
      expect(split).to.be.lte(single);
      const [buyer] = await f.pool.effectiveValue(f.buyer.address);
      expect(buyer).to.equal(single);
    });
    it("coupon index floors on every checkpoint: many checkpoints never pay more than one", async () => {
      expect(accrual(0n, 1n) * 1000n).to.be.lte(accrual(0n, 1000n));
    });
    it("the full-term coupon of the whole cap, at no loss, stays within the ceil-rounded reserve, for any odd unit count", async () => {
      const f = await loadFixture(investedPoolFixture);
      const index = accrual(0n, f.s.maturity - f.s.riskStart);
      for (const units of [1n, 7n, A_UNITS, B_UNITS, CAP - 1n, CAP]) {
        expect((units * index) / SCALE, `${units}`).to.be.lte(await f.pool.requiredReserve(units));
      }
    });
    it("a holder too small to earn a whole coupon base unit still redeems: 1 unit pays 0 coupon and 1 principal", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).transfer(f.buyer.address, 1n);
      await travelTo(f.deadline + 1n);
      await f.pool.connect(f.buyer).redeem();
      expect(await f.pool.claimable(f.buyer.address)).to.equal(1n);
    });
  });

  describe("invalid timestamps and config that still deploys", () => {
    it("a schedule entirely in the past deploys but stays inert: no money can enter", async () => {
      const f = await loadFixture(deployPoolFixture);
      const t = await now();
      const w = await poolWith(f, { issuanceStart: 1n, issuanceEnd: 2n, riskStart: 3n, maturity: 4n, grace: 1n });
      await wireCustom(w, [w.investor], USD(5_000));
      expect(t).to.be.gt(4n);
      await expect(w.pool.connect(w.sponsor).fundCoupons(1n)).to.be.revertedWithCustomError(w.pool, "IssuanceClosed");
      await expect(w.pool.connect(w.investor).invest(USD(100))).to.be.revertedWithCustomError(w.pool, "IssuanceClosed");
      expect(await w.usd.balanceOf(await w.pool.getAddress())).to.equal(0n);
    });
    it("cap below minTicket deploys but no invest can ever pass", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, { cap: USD(5), minTicket: USD(10) });
      await wireCustom(w, [w.investor], USD(5_000));
      await w.pool.connect(w.sponsor).fundCoupons(USD(100));
      await travelTo(f.s.issuanceStart);
      await expect(w.pool.connect(w.investor).invest(USD(10))).to.be.revertedWithCustomError(w.pool, "CapExceeded");
    });
    it("a pool cap above the bond's max supply: the bond's MaxSupplyReached bubbles and the stablecoin pull is undone", async () => {
      const f = await loadFixture(deployPoolFixture);
      const w = await poolWith(f, {}, USD(1_000_000), USD(100));
      await wireCustom(w, [w.investor], USD(5_000));
      await w.pool.connect(w.sponsor).fundCoupons(USD(100));
      await travelTo(f.s.issuanceStart);
      const before = await w.usd.balanceOf(w.investor.address);
      await expect(w.pool.connect(w.investor).invest(USD(101))).to.be.revertedWithCustomError(w.bond, "MaxSupplyReached").withArgs(USD(100));
      expect(await w.usd.balanceOf(w.investor.address)).to.equal(before);
      expect(await w.pool.unitsIssued()).to.equal(0n);
    });
    it("a stablecoin that is not a MockUSD makes the KYC pre-check fail, so nothing is pulled", async () => {
      const f = await loadFixture(deployPoolFixture);
      const variant = await ethers.deployContract("MockTokenVariant", [6, 22]);
      const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await variant.getAddress() }]);
      await expect(pool.connect(f.sponsor).fundCoupons(1n)).to.be.reverted;
    });
    it("the shortest window: 1 s, veto stops at the next second", async () => {
      const f = await loadFixture(deployPoolFixture);
      const signers = await ethers.getSigners();
      const trigger = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), ethers.id("t"), 1n, signers[7].address, f.admin.address, signers[8].address]);
      await wirePool(f, await trigger.getAddress());
      await f.pool.connect(f.sponsor).fundCoupons(USD(1));
      await travelTo(f.s.riskStart + HOUR);
      const att = { eventId: EV_A, lossBps: 1n, magnitudeX100: 700n, observedAt: f.s.riskStart, usgsUpdatedAt: f.s.riskStart, nonce: 1n, termsHash: ethers.id("t"), dataHash: ethers.ZeroHash, deadline: f.s.maturity };
      await trigger.submit(att, await sign(signers[7], att, await trigger.getAddress()));
      await expect(trigger.connect(signers[8]).veto(EV_A)).to.be.revertedWithCustomError(trigger, "WindowClosed");
    });
  });

  describe("signed fields the chain does not judge", () => {
    it("a zero eventId, zero magnitude, zero dataHash and an update time before the origin time are accepted: only the oracle signature vouches for them", async () => {
      const f = await loadFixture(triggerFixture);
      const att = makeAtt(f, { eventId: ethers.ZeroHash, magnitudeX100: 0n, dataHash: ethers.ZeroHash, usgsUpdatedAt: 1n, nonce: 0n });
      await expect(submit(f, att)).to.emit(f.trigger, "AttestationSubmitted");
      expect((await f.trigger.getEventRecord(ethers.ZeroHash)).status).to.equal(Status.Pending);
    });
    it("a stolen oracle key is still bounded: 10,000 bps needs a full window and the trustee can veto it", async () => {
      const f = await loadFixture(triggerFixture);
      await submit(f, makeAtt(f, { lossBps: 10_000n }));
      await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen");
      await f.trigger.connect(f.trustee).veto(EV_A);
      expect(await f.pool.appliedLossBps()).to.equal(0n);
    });
  });
});
