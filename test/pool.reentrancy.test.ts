// FaultlinePool nonReentrant guard (ReentrancyGuardTransient): a token that calls back into the pool from inside a
// transfer is stopped with ReentrancyGuardReentrantCall. MOCK-ONLY: the real HTS facade never calls back (HTS has no
// transfer hook, S3), so none of this can happen on real HTS. The bond path (RT-05) needs a bond that calls out from
// controllerRedeem; on ATS that would take an admin-configured ERC-3643 compliance contract, which Faultline leaves unset.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { travelTo } from "./helpers/time";
import { CAP, deployPoolFixture, wirePool } from "./helpers/pool";

async function reentrantPoolFixture() {
  const f = await deployPoolFixture();
  const token = await ethers.deployContract("MockReentrantToken");
  const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await token.getAddress() }]);
  const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
  await pool.initialize(await trigger.getAddress());
  await f.bond.grantRole(ROLES.ISSUER, await pool.getAddress());
  await f.bond.grantKyc(f.investor.address, "vc", 0, 2n ** 64n, f.admin.address);
  for (const who of [f.sponsor, f.investor]) await token.mint(who.address, USD(5_000));
  return { ...f, token, pool, trigger };
}

describe("FaultlinePool — reentrancy guard", () => {
  async function expectBlocked(token: Awaited<ReturnType<typeof reentrantPoolFixture>>["token"], pool: Awaited<ReturnType<typeof reentrantPoolFixture>>["pool"]) {
    expect(await token.lastOk()).to.equal(false);
    expect(await token.lastData()).to.equal(pool.interface.getError("ReentrancyGuardReentrantCall")!.selector);
  }

  it("fundCoupons: a re-entrant fundCoupons from inside transferFrom is blocked", async () => {
    const { pool, token, sponsor } = await loadFixture(reentrantPoolFixture);
    await token.arm(await pool.getAddress(), pool.interface.encodeFunctionData("fundCoupons", [1n]));
    await pool.connect(sponsor).fundCoupons(await pool.requiredReserve(CAP));
    await expectBlocked(token, pool);
  });

  it("invest: a re-entrant invest from inside transferFrom is blocked", async () => {
    const { pool, token, sponsor, investor, s } = await loadFixture(reentrantPoolFixture);
    await pool.connect(sponsor).fundCoupons(await pool.requiredReserve(CAP));
    await travelTo(s.issuanceStart);
    await token.arm(await pool.getAddress(), pool.interface.encodeFunctionData("invest", [USD(10)]));
    await pool.connect(investor).invest(USD(10));
    await expectBlocked(token, pool);
    expect(await pool.unitsIssued()).to.equal(USD(10));
  });

  it("claim: a re-entrant claim from inside transfer is blocked (no double payout)", async () => {
    const { pool, token, trigger, sponsor, investor, s } = await loadFixture(reentrantPoolFixture);
    await pool.connect(sponsor).fundCoupons(await pool.requiredReserve(CAP));
    await travelTo(s.issuanceStart);
    await pool.connect(investor).invest(USD(100));
    await travelTo(s.riskStart);
    await trigger.forwardApplyLoss(5000);
    const credit = await pool.claimable(sponsor.address);
    await token.arm(await pool.getAddress(), pool.interface.encodeFunctionData("claim"));
    await pool.connect(sponsor).claim();
    await expectBlocked(token, pool);
    expect(await token.balanceOf(sponsor.address)).to.equal(USD(5_000) - (await pool.requiredReserve(CAP)) + credit);
  });
});

/** Pool on MockReentrantBond with two holders, past the deadline. MockUSD and MockHTS are the normal mocks. */
async function reentrantBondFixture() {
  const f = await deployPoolFixture();
  const bond = await ethers.deployContract("MockReentrantBond");
  const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, bond: await bond.getAddress() }]);
  const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
  await trigger.test_setSubmissionDeadline(f.deadline);
  const stub = { grantRole: async () => undefined, grantKyc: async () => undefined } as unknown as typeof f.bond;
  await wirePool({ ...f, pool, bond: stub }, await trigger.getAddress());
  await pool.connect(f.sponsor).fundCoupons(await pool.requiredReserve(CAP));
  await travelTo(f.s.issuanceStart);
  await pool.connect(f.investor).invest(USD(100));
  await pool.connect(f.investor2).invest(USD(100));
  await travelTo(f.deadline + 1n);
  return { ...f, bond, pool, trigger };
}

describe("FaultlinePool — re-entry through the bond (RT-05, mock-only)", () => {
  const blockedBy = async (bond: Awaited<ReturnType<typeof reentrantBondFixture>>["bond"], pool: Awaited<ReturnType<typeof reentrantBondFixture>>["pool"], error: string) => {
    expect(await bond.lastOk()).to.equal(false);
    expect((await bond.lastData()).slice(0, 10)).to.equal(pool.interface.getError(error)!.selector);
  };

  for (const after of [false, true]) {
    const when = after ? "after" : "before";
    it(`redeem re-entered ${when} the burn: ReentrancyGuardReentrantCall, one credit only`, async () => {
      const f = await loadFixture(reentrantBondFixture);
      await f.bond.arm(await f.pool.getAddress(), f.pool.interface.encodeFunctionData("redeem"), after);
      await f.pool.connect(f.investor).redeem();
      await blockedBy(f.bond, f.pool, "ReentrancyGuardReentrantCall");
      expect(await f.pool.unitsRedeemed()).to.equal(USD(100));
    });
    it(`claim re-entered ${when} the burn: blocked`, async () => {
      const f = await loadFixture(reentrantBondFixture);
      await f.bond.arm(await f.pool.getAddress(), f.pool.interface.encodeFunctionData("claim"), after);
      await f.pool.connect(f.investor).redeem();
      await blockedBy(f.bond, f.pool, "ReentrancyGuardReentrantCall");
    });
  }

  it("invest re-entered from mint: blocked, and the second ticket is not issued", async () => {
    const f = await loadFixture(deployPoolFixture);
    const bond = await ethers.deployContract("MockReentrantBond");
    const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, bond: await bond.getAddress() }]);
    const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
    const stub = { grantRole: async () => undefined, grantKyc: async () => undefined } as unknown as typeof f.bond;
    await wirePool({ ...f, pool, bond: stub }, await trigger.getAddress());
    await pool.connect(f.sponsor).fundCoupons(await pool.requiredReserve(CAP));
    await travelTo(f.s.issuanceStart);
    await bond.arm(await pool.getAddress(), pool.interface.encodeFunctionData("invest", [USD(10)]), false);
    await pool.connect(f.investor).invest(USD(10));
    expect(await bond.lastOk()).to.equal(false);
    expect((await bond.lastData()).slice(0, 10)).to.equal(pool.interface.getError("ReentrancyGuardReentrantCall")!.selector);
    expect(await pool.unitsIssued()).to.equal(USD(10));
  });

  it("sweepExcess has no guard: re-entered before the burn the supply guard stops it, because the book already moved", async () => {
    const f = await loadFixture(reentrantBondFixture);
    await f.bond.arm(await f.pool.getAddress(), f.pool.interface.encodeFunctionData("sweepExcess"), false);
    await f.pool.connect(f.investor).redeem();
    await blockedBy(f.bond, f.pool, "SupplyMismatch");
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(0n);
  });

  it("sweepExcess re-entered after the burn: state is final, it credits exactly what a later call would, and all holders stay covered", async () => {
    const f = await loadFixture(reentrantBondFixture);
    await f.bond.arm(await f.pool.getAddress(), f.pool.interface.encodeFunctionData("sweepExcess"), true);
    await f.pool.connect(f.investor).redeem();
    expect(await f.bond.lastOk()).to.equal(true);
    const swept = await f.pool.claimable(f.sponsor.address);
    expect(swept).to.be.gt(0n);
    expect(await f.pool.isSolvent()).to.equal(true);
    await f.pool.sweepExcess();
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(swept); // nothing left to sweep: same as a separate call
    await f.pool.connect(f.investor2).redeem();
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    expect(await f.usd.balanceOf(await f.pool.getAddress())).to.be.lte(2n); // rounding dust only
  });

  it("sweepDust re-entered after the last burn: it sees supply 0 and every credit, so it takes only the true surplus", async () => {
    const f = await loadFixture(reentrantBondFixture);
    await f.pool.connect(f.investor).redeem();
    await f.bond.arm(await f.pool.getAddress(), f.pool.interface.encodeFunctionData("sweepDust"), true);
    await f.pool.connect(f.investor2).redeem();
    expect(await f.bond.lastOk()).to.equal(true);
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
    expect(await f.pool.totalClaimable()).to.equal(0n);
  });
});
