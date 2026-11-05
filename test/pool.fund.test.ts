// FaultlinePool.fundCoupons (D6, D11): sponsor only, before issuanceEnd, KYC pre-check, balance-delta check.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, setCode } from "@nomicfoundation/hardhat-network-helpers";
import { HTS_ADDRESS, USD } from "./helpers/fixtures";
import { atTime, expectInvariants, wiredPoolFixture } from "./helpers/pool";

describe("FaultlinePool — fundCoupons", () => {
  it("sponsor funds the reserve: pulls exactly `amount`, couponReserve grows, CouponsFunded", async () => {
    const f = await loadFixture(wiredPoolFixture);
    const amount = USD(300) + 7n;
    const tx = f.pool.connect(f.sponsor).fundCoupons(amount);
    await expect(tx).to.emit(f.pool, "CouponsFunded").withArgs(f.sponsor.address, amount);
    await expect(tx).to.changeTokenBalances(f.usd, [f.sponsor, f.pool], [-amount, amount]);
    await f.pool.connect(f.sponsor).fundCoupons(1n);
    expect(await f.pool.couponReserve()).to.equal(amount + 1n);
    expect(await f.pool.couponReserveLeft()).to.equal(amount + 1n);
    await expectInvariants(f);
  });

  it("only the sponsor may fund (D6)", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await expect(f.pool.connect(f.investor).fundCoupons(USD(1))).to.be.revertedWithCustomError(f.pool, "OnlySponsor");
    await expect(f.pool.connect(f.admin).fundCoupons(USD(1))).to.be.revertedWithCustomError(f.pool, "OnlySponsor");
  });

  it("works until issuanceEnd - 1 and reverts IssuanceClosed from issuanceEnd", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await atTime(f.s.issuanceEnd - 1n);
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1))).to.not.be.reverted;
    await atTime(f.s.issuanceEnd);
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1))).to.be.revertedWithCustomError(f.pool, "IssuanceClosed");
  });

  it("reverts ZeroAmount for 0", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await expect(f.pool.connect(f.sponsor).fundCoupons(0)).to.be.revertedWithCustomError(f.pool, "ZeroAmount");
  });

  it("D11: a sponsor without stablecoin KYC gets NotKycForToken(sponsor), not an empty revert", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await f.usd.revokeKyc(f.sponsor.address);
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1)))
      .to.be.revertedWithCustomError(f.pool, "NotKycForToken")
      .withArgs(f.sponsor.address);
  });

  it("D11: a pool without stablecoin KYC gets NotKycForToken(pool)", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await f.usd.revokeKyc(await f.pool.getAddress());
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1)))
      .to.be.revertedWithCustomError(f.pool, "NotKycForToken")
      .withArgs(await f.pool.getAddress());
  });

  it("D11: an HTS response code other than 22 reverts HtsCallFailed(code)", async () => {
    const f = await loadFixture(wiredPoolFixture);
    const variant = await ethers.deployContract("MockHtsVariant", [21]); // 21 = UNKNOWN
    await setCode(HTS_ADDRESS, await ethers.provider.getCode(await variant.getAddress()));
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1))).to.be.revertedWithCustomError(f.pool, "HtsCallFailed").withArgs(21);
  });

  it("a fee-on-transfer stablecoin reverts UnexpectedTransferAmount(expected, received)", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await f.usd.test_setTransferFee(100); // 1 %
    const amount = USD(100);
    await expect(f.pool.connect(f.sponsor).fundCoupons(amount))
      .to.be.revertedWithCustomError(f.pool, "UnexpectedTransferAmount")
      .withArgs(amount, amount - amount / 100n);
  });

  it("a missing allowance fails inside the facade (empty revert, as on HTS)", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await f.usd.connect(f.sponsor).approve(await f.pool.getAddress(), 0);
    await expect(f.pool.connect(f.sponsor).fundCoupons(USD(1))).to.be.revertedWithoutReason();
  });
});
