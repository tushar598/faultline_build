// FaultlinePool constructor and initialize (ARCHITECTURE §3.1, §3.3, D5, §8.1).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { CAP, COUPON_BPS, MIN_TICKET, deployPoolFixture, expectInvariants } from "./helpers/pool";
import { ROLES } from "./helpers/roles";

describe("FaultlinePool — constructor", () => {
  it("stores every immutable, grants DEFAULT_ADMIN_ROLE to admin and starts accrual at riskStart", async () => {
    const f = await loadFixture(deployPoolFixture);
    const { pool, s } = f;
    expect(await pool.stablecoin()).to.equal(await f.usd.getAddress());
    expect(await pool.bond()).to.equal(await f.bond.getAddress());
    expect(await pool.sponsor()).to.equal(f.sponsor.address);
    expect(await pool.issuanceStart()).to.equal(s.issuanceStart);
    expect(await pool.issuanceEnd()).to.equal(s.issuanceEnd);
    expect(await pool.riskStart()).to.equal(s.riskStart);
    expect(await pool.maturity()).to.equal(s.maturity);
    expect(await pool.grace()).to.equal(s.grace);
    expect(await pool.couponBps()).to.equal(COUPON_BPS);
    expect(await pool.cap()).to.equal(CAP);
    expect(await pool.minTicket()).to.equal(MIN_TICKET);
    expect(await pool.lastAccrual()).to.equal(s.riskStart);
    expect(await pool.trigger()).to.equal(ethers.ZeroAddress);
    expect(await pool.hasRole(ROLES.DEFAULT_ADMIN, f.admin.address)).to.equal(true);
    expect(await pool.hasRole(ROLES.DEFAULT_ADMIN, f.other.address)).to.equal(false);
    await expectInvariants(f);
  });

  it("reverts ZeroAddress for a zero admin, stablecoin, bond or sponsor", async () => {
    const { params } = await loadFixture(deployPoolFixture);
    const factory = await ethers.getContractFactory("FaultlinePool");
    for (const key of ["admin", "stablecoin", "bond", "sponsor"] as const) {
      await expect(factory.deploy({ ...params, [key]: ethers.ZeroAddress }), key).to.be.revertedWithCustomError(factory, "ZeroAddress");
    }
  });

  it("reverts InvalidSchedule unless issuanceStart < issuanceEnd <= riskStart < maturity and grace > 0", async () => {
    const { params, s } = await loadFixture(deployPoolFixture);
    const factory = await ethers.getContractFactory("FaultlinePool");
    const bad = [
      { issuanceEnd: s.issuanceStart }, // start == end
      { issuanceStart: s.issuanceEnd + 1n }, // start > end
      { riskStart: s.issuanceEnd - 1n }, // end > riskStart
      { maturity: s.riskStart }, // riskStart == maturity
      { grace: 0n },
    ];
    for (const b of bad) {
      await expect(factory.deploy({ ...params, ...b }), JSON.stringify(b, (_k, v) => String(v))).to.be.revertedWithCustomError(factory, "InvalidSchedule");
    }
    // issuanceEnd == riskStart is allowed.
    await expect(factory.deploy({ ...params, riskStart: s.issuanceEnd })).to.not.be.reverted;
  });

  it("D17 (SEC-03): grace of exactly 365 days deploys; 365 days + 1 s reverts InvalidSchedule", async () => {
    const { params } = await loadFixture(deployPoolFixture);
    const factory = await ethers.getContractFactory("FaultlinePool");
    const MAX = 365n * 24n * 3600n;
    expect(await (await factory.deploy({ ...params, grace: MAX })).grace()).to.equal(MAX);
    await expect(factory.deploy({ ...params, grace: MAX + 1n })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
  });

  it("reverts InvalidSchedule for couponBps, cap or minTicket of zero", async () => {
    const { params } = await loadFixture(deployPoolFixture);
    const factory = await ethers.getContractFactory("FaultlinePool");
    for (const b of [{ couponBps: 0n }, { cap: 0n }, { minTicket: 0n }]) {
      await expect(factory.deploy({ ...params, ...b }), Object.keys(b)[0]).to.be.revertedWithCustomError(factory, "InvalidSchedule");
    }
  });

  it("reverts InvalidSchedule unless both the bond and the stablecoin have 6 decimals", async () => {
    const { params } = await loadFixture(deployPoolFixture);
    const factory = await ethers.getContractFactory("FaultlinePool");
    const eighteen = await ethers.deployContract("MockTokenVariant", [18, 22]);
    await expect(factory.deploy({ ...params, bond: await eighteen.getAddress() })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
    await expect(factory.deploy({ ...params, stablecoin: await eighteen.getAddress() })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
  });

  it("has no receive(): a plain HBAR (ETH) transfer reverts", async () => {
    const { pool, admin } = await loadFixture(deployPoolFixture);
    await expect(admin.sendTransaction({ to: await pool.getAddress(), value: 1n })).to.be.revertedWithoutReason();
  });
});

describe("FaultlinePool — initialize (D5)", () => {
  it("stores the trigger, associates with the stablecoin exactly once (code 22) and emits Initialized", async () => {
    const f = await loadFixture(deployPoolFixture);
    const poolAddr = await f.pool.getAddress();
    const tx = f.pool.initialize(await f.trigger.getAddress());
    await expect(tx).to.emit(f.pool, "Initialized").withArgs(await f.trigger.getAddress());
    await expect(tx).to.emit(f.usd, "Associated").withArgs(poolAddr, 22);
    const receipt = await (await tx).wait();
    const associated = receipt!.logs.filter((l) => l.topics[0] === f.usd.interface.getEvent("Associated")!.topicHash);
    expect(associated.length).to.equal(1);
    expect(await f.pool.trigger()).to.equal(await f.trigger.getAddress());
    expect(await f.usd.associatedOf(poolAddr)).to.equal(true);
  });

  it("only DEFAULT_ADMIN_ROLE may call it", async () => {
    const f = await loadFixture(deployPoolFixture);
    await expect(f.pool.connect(f.other).initialize(await f.trigger.getAddress()))
      .to.be.revertedWithCustomError(f.pool, "AccessControlUnauthorizedAccount")
      .withArgs(f.other.address, ROLES.DEFAULT_ADMIN);
  });

  it("runs once: a second call reverts AlreadyInitialized before touching the token", async () => {
    const f = await loadFixture(deployPoolFixture);
    await f.pool.initialize(await f.trigger.getAddress());
    await expect(f.pool.initialize(await f.trigger.getAddress())).to.be.revertedWithCustomError(f.pool, "AlreadyInitialized");
  });

  it("reverts ZeroAddress for a zero trigger and TriggerMismatch for a trigger of another pool", async () => {
    const f = await loadFixture(deployPoolFixture);
    await expect(f.pool.initialize(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.pool, "ZeroAddress");
    const foreign = await ethers.deployContract("MockTrigger", [f.other.address]);
    await expect(f.pool.initialize(await foreign.getAddress())).to.be.revertedWithCustomError(f.pool, "TriggerMismatch");
  });

  async function poolOnVariantToken(code: number) {
    const f = await loadFixture(deployPoolFixture);
    const token = await ethers.deployContract("MockTokenVariant", [6, code]);
    const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await token.getAddress() }]);
    const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
    return { pool, trigger };
  }

  it("treats associate() code 194 (already associated) as success", async () => {
    const { pool, trigger } = await poolOnVariantToken(194);
    await expect(pool.initialize(await trigger.getAddress())).to.emit(pool, "Initialized");
  });

  it("reverts HtsCallFailed(code) for any other associate() code, e.g. 184", async () => {
    const { pool, trigger } = await poolOnVariantToken(184);
    await expect(pool.initialize(await trigger.getAddress())).to.be.revertedWithCustomError(pool, "HtsCallFailed").withArgs(184);
    expect(await pool.trigger()).to.equal(ethers.ZeroAddress);
  });
});
