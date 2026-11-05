// FaultlinePool.claim: pull payment, once; KYC pre-check on the claimant (D11) and the pool (D17); a frozen claimant fails
// alone (empty revert, S3).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, setCode } from "@nomicfoundation/hardhat-network-helpers";
import { HTS_ADDRESS, USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { travelTo } from "./helpers/time";
import { deployPoolFixture, expectInvariants, investedPoolFixture, loss } from "./helpers/pool";

/** Invested, 40 % loss, both investors redeemed: sponsor, investor and investor2 all have claimable balances. */
async function claimableFixture() {
  const f = await investedPoolFixture();
  await loss(f, 4000);
  await travelTo(f.deadline + 1n);
  await f.pool.connect(f.investor).redeem();
  await f.pool.connect(f.investor2).redeem();
  return f;
}

describe("FaultlinePool — claim", () => {
  it("pays the whole claimable balance once (CEI), emits Claimed; a second claim reverts NothingToClaim", async () => {
    const f = await loadFixture(claimableFixture);
    const amount = await f.pool.claimable(f.investor.address);
    const total = await f.pool.totalClaimable();
    const tx = f.pool.connect(f.investor).claim();
    await expect(tx).to.emit(f.pool, "Claimed").withArgs(f.investor.address, amount);
    await expect(tx).to.changeTokenBalances(f.usd, [f.investor, f.pool], [amount, -amount]);
    expect(await f.pool.claimable(f.investor.address)).to.equal(0);
    expect(await f.pool.totalClaimable()).to.equal(total - amount);
    await expect(f.pool.connect(f.investor).claim()).to.be.revertedWithCustomError(f.pool, "NothingToClaim");
    await expectInvariants(f);
  });

  it("reverts NothingToClaim for an account that was never credited", async () => {
    const f = await loadFixture(claimableFixture);
    await expect(f.pool.connect(f.other).claim()).to.be.revertedWithCustomError(f.pool, "NothingToClaim");
  });

  it("works in the risk period: the sponsor claims its write-down credit right after the loss", async () => {
    const f = await loadFixture(investedPoolFixture);
    await loss(f, 2500);
    const credit = await f.pool.claimable(f.sponsor.address);
    await expect(f.pool.connect(f.sponsor).claim()).to.changeTokenBalances(f.usd, [f.sponsor, f.pool], [credit, -credit]);
    await expectInvariants(f);
  });

  it("D11: a claimant without stablecoin KYC gets NotKycForToken and keeps the balance; after re-KYC it claims", async () => {
    const f = await loadFixture(claimableFixture);
    const amount = await f.pool.claimable(f.investor.address);
    await f.usd.revokeKyc(f.investor.address);
    await expect(f.pool.connect(f.investor).claim())
      .to.be.revertedWithCustomError(f.pool, "NotKycForToken")
      .withArgs(f.investor.address);
    expect(await f.pool.claimable(f.investor.address)).to.equal(amount);
    await f.usd.grantKyc(f.investor.address);
    await expect(f.pool.connect(f.investor).claim()).to.emit(f.pool, "Claimed").withArgs(f.investor.address, amount);
  });

  it("D17 (SEC-04): when the POOL loses stablecoin KYC every claim reverts NotKycForToken(pool), balances are kept, and claims resume after re-KYC", async () => {
    const f = await loadFixture(claimableFixture);
    const poolAddr = await f.pool.getAddress();
    const amount = await f.pool.claimable(f.sponsor.address);
    await f.usd.revokeKyc(poolAddr);
    for (const who of [f.sponsor, f.investor, f.investor2]) {
      await expect(f.pool.connect(who).claim()).to.be.revertedWithCustomError(f.pool, "NotKycForToken").withArgs(poolAddr);
    }
    expect(await f.pool.claimable(f.sponsor.address)).to.equal(amount);
    await f.usd.grantKyc(poolAddr);
    await expect(f.pool.connect(f.sponsor).claim()).to.emit(f.pool, "Claimed").withArgs(f.sponsor.address, amount);
    await expectInvariants(f);
  });

  it("D11: an HTS response code other than 22 reverts HtsCallFailed(code)", async () => {
    const f = await loadFixture(claimableFixture);
    const variant = await ethers.deployContract("MockHtsVariant", [21]);
    await setCode(HTS_ADDRESS, await ethers.provider.getCode(await variant.getAddress()));
    await expect(f.pool.connect(f.investor).claim()).to.be.revertedWithCustomError(f.pool, "HtsCallFailed").withArgs(21);
  });

  it("a frozen claimant fails with the facade's empty revert, keeps its balance, and blocks nobody else", async () => {
    const f = await loadFixture(claimableFixture);
    const amount = await f.pool.claimable(f.investor.address);
    await f.usd.freeze(f.investor.address);
    await expect(f.pool.connect(f.investor).claim()).to.be.revertedWithoutReason();
    expect(await f.pool.claimable(f.investor.address)).to.equal(amount);
    await expect(f.pool.connect(f.investor2).claim()).to.emit(f.pool, "Claimed");
    await expect(f.pool.connect(f.sponsor).claim()).to.emit(f.pool, "Claimed");
    await expectInvariants(f);
    await f.usd.unfreeze(f.investor.address);
    await expect(f.pool.connect(f.investor).claim()).to.emit(f.pool, "Claimed").withArgs(f.investor.address, amount);
    await expectInvariants(f);
  });

  it("a frozen POOL fails every claim with the facade's empty revert and keeps every balance (RT-17); unfrozen, all claim", async () => {
    const f = await loadFixture(claimableFixture);
    const poolAddr = await f.pool.getAddress();
    const amount = await f.pool.claimable(f.investor.address);
    const total = await f.pool.totalClaimable();
    await f.usd.freeze(poolAddr);
    for (const who of [f.investor, f.investor2, f.sponsor]) await expect(f.pool.connect(who).claim()).to.be.revertedWithoutReason();
    expect(await f.pool.claimable(f.investor.address)).to.equal(amount);
    expect(await f.pool.totalClaimable()).to.equal(total);
    await f.usd.unfreeze(poolAddr);
    await expect(f.pool.connect(f.investor).claim()).to.emit(f.pool, "Claimed").withArgs(f.investor.address, amount);
  });
});

describe("FaultlinePool — a stablecoin that returns false (RT-17, mock-only: the HTS facade reverts instead, S3)", () => {
  async function falseTokenFixture() {
    const f = await deployPoolFixture();
    const token = await ethers.deployContract("MockFalseToken");
    const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await token.getAddress() }]);
    const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
    await trigger.test_setSubmissionDeadline(f.deadline);
    await pool.initialize(await trigger.getAddress());
    await f.bond.grantRole(ROLES.ISSUER, await pool.getAddress());
    await f.bond.grantRole(ROLES.CONTROLLER, await pool.getAddress());
    await f.bond.grantKyc(f.investor.address, "vc", 0, 2n ** 64n, f.admin.address);
    for (const who of [f.sponsor, f.investor]) await token.mint(who.address, USD(5_000));
    return { ...f, token, pool, trigger };
  }

  it("fundCoupons and invest revert SafeERC20FailedOperation and book nothing", async () => {
    const { pool, token, sponsor, investor, s } = await loadFixture(falseTokenFixture);
    await token.setFailing(true);
    await expect(pool.connect(sponsor).fundCoupons(USD(1))).to.be.revertedWithCustomError(pool, "SafeERC20FailedOperation").withArgs(await token.getAddress());
    expect(await pool.couponReserve()).to.equal(0n);
    await token.setFailing(false);
    await pool.connect(sponsor).fundCoupons(USD(1_000));
    await travelTo(s.issuanceStart);
    await token.setFailing(true);
    await expect(pool.connect(investor).invest(USD(10))).to.be.revertedWithCustomError(pool, "SafeERC20FailedOperation");
    expect(await pool.unitsIssued()).to.equal(0n);
  });

  it("claim reverts SafeERC20FailedOperation and the credit survives", async () => {
    const { pool, token, sponsor, investor, s, deadline } = await loadFixture(falseTokenFixture);
    await pool.connect(sponsor).fundCoupons(USD(1_000));
    await travelTo(s.issuanceStart);
    await pool.connect(investor).invest(USD(10));
    await travelTo(deadline + 1n);
    await pool.connect(investor).redeem();
    const amount = await pool.claimable(investor.address);
    await token.setFailing(true);
    await expect(pool.connect(investor).claim()).to.be.revertedWithCustomError(pool, "SafeERC20FailedOperation");
    expect(await pool.claimable(investor.address)).to.equal(amount);
    expect(await pool.totalClaimable()).to.equal(amount);
    await token.setFailing(false);
    await expect(pool.connect(investor).claim()).to.emit(pool, "Claimed").withArgs(investor.address, amount);
  });
});
