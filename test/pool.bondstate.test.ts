// RT-04: the pool depends on bond state it does not own. Each state must stop the pool cleanly, change no book, and
// recover when restored. Mock-tested; `IsPaused` on controllerRedeem and mint is testnet-verified (spike S2).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { travelTo } from "./helpers/time";
import { A_UNITS, B_UNITS, MIN_TICKET, deployPoolFixture, expectInvariants, investedPoolFixture, readyPoolFixture, wirePool } from "./helpers/pool";

type World = Awaited<ReturnType<typeof investedPoolFixture>>;

/** Every book a failed `redeem` must leave alone. */
const books = async (f: Pick<World, "pool" | "usd" | "bond" | "investor">) => ({
  redeemed: await f.pool.unitsRedeemed(),
  index: await f.pool.couponIndex(),
  last: await f.pool.lastAccrual(),
  claimable: await f.pool.claimable(f.investor.address),
  total: await f.pool.totalClaimable(),
  units: await f.bond.balanceOf(f.investor.address),
  usd: await f.usd.balanceOf(await f.pool.getAddress()),
});

async function afterDeadlineFixture() {
  const f = await investedPoolFixture();
  await travelTo(f.deadline + 1n);
  return f;
}

describe("FaultlinePool — bond state it does not own (RT-04)", () => {
  it("bond paused: redeem bubbles IsPaused, no book moves, and it works after unpause", async () => {
    const f = await loadFixture(afterDeadlineFixture);
    const before = await books(f);
    await f.bond.pause();
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.bond, "IsPaused");
    expect(await books(f)).to.deep.equal(before);
    await f.bond.unpause();
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    await expectInvariants(f);
  });

  it("bond paused: invest bubbles IsPaused and the investor keeps the stablecoin (the pull is undone)", async () => {
    const f = await loadFixture(readyPoolFixture);
    await travelTo(f.s.issuanceStart);
    const usd = await f.usd.balanceOf(f.investor.address);
    await f.bond.pause();
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.bond, "IsPaused");
    expect(await f.usd.balanceOf(f.investor.address)).to.equal(usd);
    expect(await f.pool.unitsIssued()).to.equal(0n);
    await f.bond.unpause();
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.emit(f.pool, "Invested");
  });

  it("a bond pause does not stop claim of existing credit: claim never touches the bond", async () => {
    const f = await loadFixture(afterDeadlineFixture);
    await f.pool.connect(f.investor).redeem();
    await f.bond.pause();
    await expect(f.pool.connect(f.investor).claim()).to.emit(f.pool, "Claimed");
  });

  it("ROLE_CONTROLLER revoked: redeem bubbles AccountHasNoRoles, no book moves, and it works after the re-grant", async () => {
    const f = await loadFixture(afterDeadlineFixture);
    const poolAddr = await f.pool.getAddress();
    const before = await books(f);
    await f.bond.revokeRole(ROLES.CONTROLLER, poolAddr);
    await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.bond, "AccountHasNoRoles");
    expect(await books(f)).to.deep.equal(before);
    await f.bond.grantRole(ROLES.CONTROLLER, poolAddr);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
  });

  it("ROLE_ISSUER revoked: invest bubbles AccountHasNoRoles and nothing is pulled", async () => {
    const f = await loadFixture(readyPoolFixture);
    await travelTo(f.s.issuanceStart);
    const usd = await f.usd.balanceOf(f.investor.address);
    await f.bond.revokeRole(ROLES.ISSUER, await f.pool.getAddress());
    await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.bond, "AccountHasNoRoles");
    expect(await f.usd.balanceOf(f.investor.address)).to.equal(usd);
  });

  it("a non-controllable bond: redeem bubbles TokenIsNotControllable, for good (the flag is fixed at deploy)", async () => {
    const f = await loadFixture(deployPoolFixture);
    const bond = await ethers.deployContract("MockBond", [f.admin.address, USD(10_000), false]);
    await bond.grantRole(ROLES.KYC, f.admin.address);
    const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, bond: await bond.getAddress() }]);
    const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
    await trigger.test_setSubmissionDeadline(f.deadline);
    const world = { ...f, bond, pool };
    await wirePool(world, await trigger.getAddress());
    await pool.connect(f.sponsor).fundCoupons(await pool.requiredReserve(f.params.cap as bigint));
    await travelTo(f.s.issuanceStart);
    await pool.connect(f.investor).invest(MIN_TICKET);
    await travelTo(f.deadline + 1n);
    await expect(pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(bond, "TokenIsNotControllable");
  });

  it("a bond max supply below the pool cap: invest bubbles MaxSupplyReached", async () => {
    const f = await loadFixture(deployPoolFixture);
    const bond = await ethers.deployContract("MockBond", [f.admin.address, MIN_TICKET, true]);
    await bond.grantRole(ROLES.KYC, f.admin.address);
    const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, bond: await bond.getAddress() }]);
    const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
    await wirePool({ ...f, bond, pool }, await trigger.getAddress());
    await pool.connect(f.sponsor).fundCoupons(await pool.requiredReserve(f.params.cap as bigint));
    await travelTo(f.s.issuanceStart);
    await pool.connect(f.investor).invest(MIN_TICKET);
    await expect(pool.connect(f.investor2).invest(MIN_TICKET)).to.be.revertedWithCustomError(bond, "MaxSupplyReached");
  });

  it("bond KYC revoked after issuance: the pool still redeems the holder (controllerRedeem has no KYC check, S1)", async () => {
    const f = await loadFixture(afterDeadlineFixture);
    await f.bond.revokeKyc(f.investor.address);
    await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.investor.address, A_UNITS, A_UNITS, await f.pool.claimable(f.investor.address).then(() => expectCoupon(f, A_UNITS)));
  });

  it("a bond pause during the run blocks every holder equally; unpaused, all redeem and the books still close", async () => {
    const f = await loadFixture(afterDeadlineFixture);
    await f.bond.pause();
    for (const who of [f.investor, f.investor2]) await expect(f.pool.connect(who).redeem()).to.be.revertedWithCustomError(f.bond, "IsPaused");
    await f.bond.unpause();
    for (const who of [f.investor, f.investor2]) await f.pool.connect(who).redeem();
    expect(await f.bond.totalSupply()).to.equal(0n);
    expect(await f.pool.unitsRedeemed()).to.equal(A_UNITS + B_UNITS);
    await f.pool.sweepDust();
    await expectInvariants(f, { swept: true });
  });
});

/** Coupon the next redeem pays for `units`: maturity has passed, so the index is final. */
async function expectCoupon(f: World, units: bigint) {
  return (units * (await f.pool.currentCouponIndex())) / 10n ** 18n;
}
