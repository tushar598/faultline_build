// FaultlinePool.invest: window, ticket, cap, reserve, supply guard (D4), KYC pre-check (D11), 1:1 mint.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, setCode } from "@nomicfoundation/hardhat-network-helpers";
import { HTS_ADDRESS, USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { travelTo } from "./helpers/time";
import { CAP, MIN_TICKET, atTime, deployPoolFixture, expectInvariants, readyPoolFixture, reserveFor, wiredPoolFixture } from "./helpers/pool";

/** Ready and inside the issuance window. */
async function openFixture() {
  const f = await readyPoolFixture();
  await travelTo(f.s.issuanceStart);
  return f;
}

describe("FaultlinePool — invest", () => {
  it("mints 1:1: pulls `units` stablecoin, mints `units` bond units, unitsIssued grows, Invested", async () => {
    const f = await loadFixture(openFixture);
    const units = USD(1234) + 567n;
    const tx = f.pool.connect(f.investor).invest(units);
    await expect(tx).to.emit(f.pool, "Invested").withArgs(f.investor.address, units);
    await expect(tx).to.emit(f.bond, "Issued").withArgs(await f.pool.getAddress(), f.investor.address, units, "0x");
    await expect(tx).to.changeTokenBalances(f.usd, [f.investor, f.pool], [-units, units]);
    expect(await f.bond.balanceOf(f.investor.address)).to.equal(units);
    expect(await f.pool.unitsIssued()).to.equal(units);
    expect(await f.pool.collateralLeft()).to.equal(units);
    await f.pool.connect(f.investor2).invest(MIN_TICKET);
    expect(await f.pool.unitsIssued()).to.equal(units + MIN_TICKET);
    await expectInvariants(f);
  });

  it("reverts NotInitialized before initialize", async () => {
    const f = await loadFixture(deployPoolFixture);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "NotInitialized");
  });

  it("window edges: issuanceStart - 1 IssuanceNotOpen; issuanceStart and issuanceEnd - 1 work; issuanceEnd IssuanceClosed", async () => {
    const f = await loadFixture(readyPoolFixture);
    await atTime(f.s.issuanceStart - 1n);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "IssuanceNotOpen");
    await atTime(f.s.issuanceStart);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.not.be.reverted;
    await atTime(f.s.issuanceEnd - 1n);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.not.be.reverted;
    await atTime(f.s.issuanceEnd);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "IssuanceClosed");
    await expectInvariants(f);
  });

  it("minTicket: minTicket - 1 reverts BelowMinTicket(units, minTicket); minTicket works", async () => {
    const f = await loadFixture(openFixture);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET - 1n))
      .to.be.revertedWithCustomError(f.pool, "BelowMinTicket")
      .withArgs(MIN_TICKET - 1n, MIN_TICKET);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.not.be.reverted;
  });

  it("cap: unitsIssued + units > cap reverts CapExceeded(requested, available); filling the cap exactly works", async () => {
    const f = await loadFixture(openFixture);
    await f.pool.connect(f.investor).invest(USD(5_000));
    await expect(f.pool.connect(f.investor2).invest(USD(5_000) + 1n))
      .to.be.revertedWithCustomError(f.pool, "CapExceeded")
      .withArgs(USD(5_000) + 1n, CAP - USD(5_000));
    await f.pool.connect(f.investor2).invest(USD(5_000));
    expect(await f.pool.unitsIssued()).to.equal(CAP);
    await expect(f.pool.connect(f.buyer).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "CapExceeded").withArgs(MIN_TICKET, 0);
    await expectInvariants(f);
  });

  it("reserve: reverts CouponReserveInsufficient(have, need) once the funded reserve stops covering the new supply", async () => {
    const f = await loadFixture(wiredPoolFixture);
    const funded = reserveFor(USD(1_000), f.s);
    expect(await f.pool.requiredReserve(USD(1_000))).to.equal(funded);
    await f.pool.connect(f.sponsor).fundCoupons(funded);
    await travelTo(f.s.issuanceStart);
    await f.pool.connect(f.investor).invest(USD(1_000));
    const need = reserveFor(USD(1_000) + MIN_TICKET, f.s);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET))
      .to.be.revertedWithCustomError(f.pool, "CouponReserveInsufficient")
      .withArgs(funded, need);
    await expectInvariants(f);
  });

  it("reserve: with nothing funded the first invest already reverts", async () => {
    const f = await loadFixture(wiredPoolFixture);
    await travelTo(f.s.issuanceStart);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET))
      .to.be.revertedWithCustomError(f.pool, "CouponReserveInsufficient")
      .withArgs(0, reserveFor(MIN_TICKET, f.s));
  });

  it("requiredReserve rounds up: ceil(units * couponBps * term / (10000 * YEAR))", async () => {
    const f = await loadFixture(deployPoolFixture);
    for (const u of [1n, 7n, USD(1) + 3n, CAP]) expect(await f.pool.requiredReserve(u)).to.equal(reserveFor(u, f.s));
    expect(await f.pool.requiredReserve(1n)).to.equal(1n); // 0.08 rounds up to 1
  });

  it("D11: an investor without stablecoin KYC gets NotKycForToken(investor) before any transfer", async () => {
    const f = await loadFixture(openFixture);
    await f.usd.revokeKyc(f.investor.address);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET))
      .to.be.revertedWithCustomError(f.pool, "NotKycForToken")
      .withArgs(f.investor.address);
  });

  it("D11: a pool without stablecoin KYC gets NotKycForToken(pool)", async () => {
    const f = await loadFixture(openFixture);
    await f.usd.revokeKyc(await f.pool.getAddress());
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET))
      .to.be.revertedWithCustomError(f.pool, "NotKycForToken")
      .withArgs(await f.pool.getAddress());
  });

  it("an investor KYC'd on the stablecoin but not on the bond: the ATS mint reverts InvalidKycStatus (S1) and nothing moves", async () => {
    const f = await loadFixture(openFixture);
    const before = await f.usd.balanceOf(f.stranger.address);
    await expect(f.pool.connect(f.stranger).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
    expect(await f.usd.balanceOf(f.stranger.address)).to.equal(before);
    expect(await f.pool.unitsIssued()).to.equal(0);
  });

  it("D4: a foreign mint by a second ROLE_ISSUER makes invest revert SupplyMismatch(actual, expected)", async () => {
    const f = await loadFixture(openFixture);
    await f.pool.connect(f.investor).invest(MIN_TICKET);
    await f.bond.grantRole(ROLES.ISSUER, f.admin.address);
    await f.bond.mint(f.investor.address, 5n);
    await expect(f.pool.connect(f.investor2).invest(MIN_TICKET))
      .to.be.revertedWithCustomError(f.pool, "SupplyMismatch")
      .withArgs(MIN_TICKET + 5n, MIN_TICKET);
    await expectInvariants(f, { supplyBroken: true });
  });

  it("D4: an ATS balance adjustment (test_adjustBalance) also trips the supply guard", async () => {
    const f = await loadFixture(openFixture);
    await f.bond.test_adjustBalance(f.stranger.address, 1n);
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "SupplyMismatch").withArgs(1, 0);
  });

  it("a fee-on-transfer stablecoin reverts UnexpectedTransferAmount and mints nothing", async () => {
    const f = await loadFixture(openFixture);
    await f.usd.test_setTransferFee(50); // 0.5 %
    const units = USD(100);
    await expect(f.pool.connect(f.investor).invest(units))
      .to.be.revertedWithCustomError(f.pool, "UnexpectedTransferAmount")
      .withArgs(units, units - (units * 50n) / 10_000n);
    expect(await f.bond.totalSupply()).to.equal(0);
  });

  it("a bond that does not let the pool mint (no ROLE_ISSUER) reverts the whole invest", async () => {
    const f = await loadFixture(openFixture);
    await f.bond.revokeRole(ROLES.ISSUER, await f.pool.getAddress());
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.bond, "AccountHasNoRoles");
    expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(await f.pool.couponReserve());
  });

  it("units are transferable between bond-KYC'd wallets and keep the supply guard intact", async () => {
    const f = await loadFixture(openFixture);
    await f.pool.connect(f.investor).invest(USD(100));
    await f.bond.connect(f.investor).transfer(f.buyer.address, USD(40));
    expect(await f.bond.balanceOf(f.buyer.address)).to.equal(USD(40));
    await expect(f.pool.connect(f.investor2).invest(MIN_TICKET)).to.not.be.reverted;
    await expectInvariants(f);
  });

  it("D11: an HTS response code other than 22 reverts HtsCallFailed(code) and nothing is pulled (RT-17)", async () => {
    const f = await loadFixture(openFixture);
    const usd = await f.usd.balanceOf(f.investor.address);
    const variant = await ethers.deployContract("MockHtsVariant", [21]); // 21 = UNKNOWN
    await setCode(HTS_ADDRESS, await ethers.provider.getCode(await variant.getAddress()));
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "HtsCallFailed").withArgs(21);
    expect(await f.usd.balanceOf(f.investor.address)).to.equal(usd);
    expect(await f.pool.unitsIssued()).to.equal(0n);
  });
});
