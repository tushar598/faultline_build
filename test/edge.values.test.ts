// RT-18: arithmetic and calldata extremes. Each must end in a clean revert with no state change. Mock-tested.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { travelTo } from "./helpers/time";
import { CAP, MIN_TICKET, deployPoolFixture, readyPoolFixture } from "./helpers/pool";
import { TERMS, WINDOW, makeAtt, sign, triggerFixture } from "./helpers/trigger";

describe("Extreme values (RT-18)", () => {
  describe("invest", () => {
    it("invest(MaxUint256) on an empty pool reverts CapExceeded", async () => {
      const f = await loadFixture(readyPoolFixture);
      await travelTo(f.s.issuanceStart);
      await expect(f.pool.connect(f.investor).invest(ethers.MaxUint256)).to.be.revertedWithCustomError(f.pool, "CapExceeded").withArgs(ethers.MaxUint256, CAP);
    });
    it("invest(MaxUint256) after a first ticket overflows issued + units: a checked-arithmetic panic, no state change", async () => {
      const f = await loadFixture(readyPoolFixture);
      await travelTo(f.s.issuanceStart);
      await f.pool.connect(f.investor).invest(MIN_TICKET);
      await expect(f.pool.connect(f.investor).invest(ethers.MaxUint256)).to.be.revertedWithPanic(0x11);
      expect(await f.pool.unitsIssued()).to.equal(MIN_TICKET);
    });
    it("exactly the cap works, one more base unit does not", async () => {
      const f = await loadFixture(readyPoolFixture);
      await travelTo(f.s.issuanceStart);
      await f.pool.connect(f.investor).invest(USD(5_000));
      await f.pool.connect(f.investor2).invest(USD(5_000));
      await expect(f.pool.connect(f.buyer).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.pool, "CapExceeded").withArgs(MIN_TICKET, 0);
    });
  });

  describe("associate() response codes", () => {
    it("a code at or above 2^63 reverts in SafeCast, not as a wrong response code", async () => {
      const f = await loadFixture(deployPoolFixture);
      const usd = await ethers.deployContract("MockTokenVariant", [6, 2n ** 63n]);
      const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await usd.getAddress() }]);
      const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
      await expect(pool.initialize(await trigger.getAddress())).to.be.revertedWithCustomError(pool, "SafeCastOverflowedIntDowncast");
      expect(await pool.trigger()).to.equal(ethers.ZeroAddress);
    });
    it("initialize with a trigger address that has no code reverts without reason", async () => {
      const f = await loadFixture(deployPoolFixture);
      await expect(f.pool.initialize(f.stranger.address)).to.be.revertedWithoutReason();
      expect(await f.pool.trigger()).to.equal(ethers.ZeroAddress);
    });
    it("a code at or above 2^255 reverts in SafeCast too", async () => {
      const f = await loadFixture(deployPoolFixture);
      const usd = await ethers.deployContract("MockTokenVariant", [6, 2n ** 255n]);
      const pool = await ethers.deployContract("FaultlinePool", [{ ...f.params, stablecoin: await usd.getAddress() }]);
      const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
      await expect(pool.initialize(await trigger.getAddress())).to.be.revertedWithCustomError(pool, "SafeCastOverflowedUintToInt");
    });
  });

  describe("constructors", () => {
    it("pool: a bond or stablecoin address with no code reverts without reason (decimals() has nothing to answer)", async () => {
      const f = await loadFixture(deployPoolFixture);
      const factory = await ethers.getContractFactory("FaultlinePool");
      await expect(factory.deploy({ ...f.params, bond: f.stranger.address })).to.be.revertedWithoutReason();
      await expect(factory.deploy({ ...f.params, stablecoin: f.stranger.address })).to.be.revertedWithoutReason();
    });
    it("pool: riskStart after maturity, and riskStart equal to maturity, revert InvalidSchedule", async () => {
      const f = await loadFixture(deployPoolFixture);
      const factory = await ethers.getContractFactory("FaultlinePool");
      await expect(factory.deploy({ ...f.params, riskStart: f.s.maturity + 1n })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
      await expect(factory.deploy({ ...f.params, riskStart: f.s.maturity })).to.be.revertedWithCustomError(factory, "InvalidSchedule");
    });
    it("trigger: a pool address with no code reverts without reason", async () => {
      const f = await loadFixture(deployPoolFixture);
      const factory = await ethers.getContractFactory("FaultlineTrigger");
      await expect(factory.deploy(f.stranger.address, TERMS, WINDOW, f.stranger.address, f.admin.address, f.admin.address)).to.be.revertedWithoutReason();
    });
  });

  describe("calldata", () => {
    /** Valid `submit` calldata with word 2 (lossBps) replaced by `word`. */
    async function submitCalldata(f: Awaited<ReturnType<typeof triggerFixture>>, word: string) {
      const att = makeAtt(f);
      const sig = await sign(f.oracle, att, await f.trigger.getAddress());
      const data = f.trigger.interface.encodeFunctionData("submit", [att, sig]);
      const bytes = ethers.getBytes(data);
      bytes.set(ethers.getBytes(word), 4 + 32); // selector + eventId
      return { data, dirty: ethers.hexlify(bytes) };
    }
    it("submit with a dirty uint16 (a high bit set in lossBps) reverts in the ABI decoder, and nothing is stored", async () => {
      const f = await loadFixture(triggerFixture);
      const caller = await ethers.deployContract("RawCaller");
      const { dirty } = await submitCalldata(f, ethers.zeroPadValue("0x011388", 32)); // 0x1388 = 5000, plus a dirty byte
      await caller.exec(await f.trigger.getAddress(), dirty);
      expect(await caller.lastOk()).to.equal(false);
      expect(await caller.lastData()).to.equal("0x");
      expect(await f.trigger.pendingCount()).to.equal(0n);
    });
    it("control: the same call with a clean word succeeds through the same caller", async () => {
      const f = await loadFixture(triggerFixture);
      const caller = await ethers.deployContract("RawCaller");
      const { dirty } = await submitCalldata(f, ethers.zeroPadValue("0x1388", 32));
      await caller.exec(await f.trigger.getAddress(), dirty);
      expect(await caller.lastOk()).to.equal(true);
      expect(await f.trigger.pendingCount()).to.equal(1n);
    });
    it("applyLoss with a dirty uint16 reverts in the decoder before any check", async () => {
      const f = await loadFixture(deployPoolFixture);
      const caller = await ethers.deployContract("RawCaller");
      const data = f.pool.interface.encodeFunctionData("applyLoss", [1]);
      const dirty = data.slice(0, 10) + ethers.zeroPadValue("0x010001", 32).slice(2);
      await caller.exec(await f.pool.getAddress(), dirty);
      expect(await caller.lastOk()).to.equal(false);
      expect(await caller.lastData()).to.equal("0x");
    });
  });
});
