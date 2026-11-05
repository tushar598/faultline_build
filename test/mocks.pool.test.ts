// MockPool (local tests only) keeps the real pool's initialize and applyLoss rules, so the trigger tests that run
// against it cannot pass for the wrong reason. Goes away with MockPool once the trigger tests run on the real pool.
import { expect } from "chai";
import { ethers } from "hardhat";
import { impersonateAccount, loadFixture, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { A_UNITS, B_UNITS, BPS, deployPoolFixture, wirePool } from "./helpers/pool";
import { travelTo } from "./helpers/time";

const U = A_UNITS + B_UNITS;

/** MockPool wired to a real FaultlineTrigger, plus a signer AS the trigger address (impersonated, local chain only). */
async function wiredMockPool() {
  const f = await deployPoolFixture();
  const trigger = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), ethers.ZeroHash, 3_600n, f.admin.address, f.admin.address, f.admin.address]);
  const addr = await trigger.getAddress();
  await wirePool(f, addr);
  await impersonateAccount(addr);
  await setBalance(addr, 10n ** 18n);
  return { ...f, trigger, asTrigger: await ethers.getSigner(addr) };
}

describe("MockPool (local tests only)", () => {
  it("initialize: non-zero, once, and only a trigger that points back at this pool", async () => {
    const f = await deployPoolFixture();
    const other = await deployPoolFixture();
    const trigger = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), ethers.ZeroHash, 3_600n, f.admin.address, f.admin.address, f.admin.address]);
    await expect(f.pool.initialize(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.pool, "ZeroAddress");
    await expect(other.pool.initialize(await trigger.getAddress())).to.be.revertedWithCustomError(other.pool, "TriggerMismatch");
    await f.pool.initialize(await trigger.getAddress());
    expect(await f.pool.trigger()).to.equal(await trigger.getAddress());
    await expect(f.pool.initialize(await trigger.getAddress())).to.be.revertedWithCustomError(f.pool, "AlreadyInitialized");
  });

  it("applyLoss: trigger only, from riskStart, at most 10000, strictly increasing", async () => {
    const f = await loadFixture(wiredMockPool);
    await expect(f.pool.connect(f.admin).applyLoss(100)).to.be.revertedWithCustomError(f.pool, "OnlyTrigger");
    await expect(f.pool.connect(f.asTrigger).applyLoss(100)).to.be.revertedWithCustomError(f.pool, "RiskPeriodNotStarted");
    await travelTo(f.s.riskStart);
    await expect(f.pool.connect(f.asTrigger).applyLoss(10_001)).to.be.revertedWithCustomError(f.pool, "LossOutOfRange").withArgs(10_001);
    await f.pool.connect(f.asTrigger).applyLoss(3_000);
    for (const bad of [3_000, 2_999]) {
      await expect(f.pool.connect(f.asTrigger).applyLoss(bad)).to.be.revertedWithCustomError(f.pool, "LossNotIncreasing").withArgs(3_000, bad);
    }
  });

  it("sponsor credit follows floor(U * L / 10000) and each LossApplied carries only the increment", async () => {
    const f = await loadFixture(wiredMockPool);
    await travelTo(f.s.riskStart);
    await expect(f.pool.connect(f.asTrigger).applyLoss(3_333)).to.emit(f.pool, "LossApplied").withArgs(0, 3_333, (U * 3_333n) / BPS);
    await expect(f.pool.connect(f.asTrigger).applyLoss(10_000))
      .to.emit(f.pool, "LossApplied")
      .withArgs(3_333, 10_000, U - (U * 3_333n) / BPS);
    expect(await f.pool.sponsorCredited()).to.equal(U);
    expect(await f.pool.appliedLossBps()).to.equal(10_000);
  });
});
