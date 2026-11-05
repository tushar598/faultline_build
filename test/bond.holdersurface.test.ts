// RT-03: the ATS v8 functions a plain holder or approved spender can call, as modelled by MockBond. Selectors and error
// selectors are the ones the real FLDMO / FLSPK bonds answered in read-only mirror-node simulations (no transaction was
// sent; docs/SECURITY-TEST-REPORT.md, parity table). Success paths that need two transactions in a row, such as
// approve then redeemFrom, follow the ATS v8.0.0 source. Everything here is mock-tested.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { now, travelTo } from "./helpers/time";
import { A_UNITS, B_UNITS, expectInvariants, investedPoolFixture } from "./helpers/pool";

const PARTITION_1 = ethers.zeroPadValue("0x01", 32);
const PARTITION_2 = ethers.zeroPadValue("0x02", 32);
const FAR = 2n ** 40n;

type World = Awaited<ReturnType<typeof investedPoolFixture>>;
const hold = (amount: bigint, escrow: string, expirationTimestamp = FAR, to = ethers.ZeroAddress) => ({ amount, expirationTimestamp, escrow, to, data: "0x" });
const holdId = (f: World, id: bigint) => ({ partition: PARTITION_1, tokenHolder: f.investor.address, holdId: id });

describe("MockBond — ATS holder surface (RT-03)", () => {
  describe("selectors equal the ones the real bond answered", () => {
    it("function selectors", async () => {
      const { bond } = await loadFixture(investedPoolFixture);
      expect(bond.interface.getFunction("redeem")!.selector).to.equal("0xe77c646d"); // calldata of the SEC-15 simulation
      expect(bond.interface.getFunction("createHoldByPartition")!.format("sighash")).to.equal("createHoldByPartition(bytes32,(uint256,uint256,address,address,bytes))");
      expect(bond.interface.getFunction("redeemByPartition")!.format("sighash")).to.equal("redeemByPartition(bytes32,uint256,bytes)");
      expect(bond.interface.getFunction("redeemFrom")!.format("sighash")).to.equal("redeemFrom(address,uint256,bytes)");
      expect(bond.interface.getFunction("operatorRedeemByPartition")!.format("sighash")).to.equal("operatorRedeemByPartition(bytes32,address,uint256,bytes,bytes)");
    });
    it("error selectors", async () => {
      const { bond } = await loadFixture(investedPoolFixture);
      const sel = (n: string) => bond.interface.getError(n)!.selector;
      expect(sel("InsufficientBalance")).to.equal("0x5d6824c4");
      expect(sel("InsufficientAllowance")).to.equal("0xf180d8f9");
      expect(sel("InvalidPartition")).to.equal("0xbf84f4ec");
      expect(sel("PartitionNotAllowedInSinglePartitionMode")).to.equal("0xb96d9539");
      expect(sel("Unauthorized")).to.equal("0x1e09743f");
      expect(sel("WrongExpirationTimestamp")).to.equal("0xe39f4776");
      expect(sel("ZeroAddressNotAllowed")).to.equal("0x8579befe");
      expect(sel("InvalidHoldAmount")).to.equal("0x352b484a");
    });
  });

  describe("redeem guards, in the order simulated on the real bond", () => {
    it("no KYC → InvalidKycStatus, even at value 0; KYC'd holder at value 0 passes and burns nothing", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.stranger).redeem(0n, "0x")).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
      const supply = await f.bond.totalSupply();
      await f.bond.connect(f.investor).redeem(0n, "0x");
      expect(await f.bond.totalSupply()).to.equal(supply);
    });
    it("over balance → InsufficientBalance, before the pause check; KYC check also comes before pause", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.pause();
      await expect(f.bond.connect(f.investor).redeem(A_UNITS + 1n, "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientBalance");
      await expect(f.bond.connect(f.stranger).redeem(1n, "0x")).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
      await expect(f.bond.connect(f.investor).redeem(1n, "0x")).to.be.revertedWithCustomError(f.bond, "IsPaused");
    });
    it("a KYC'd wallet with an empty balance → InvalidPartition", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.buyer).redeem(1n, "0x")).to.be.revertedWithCustomError(f.bond, "InvalidPartition");
    });
    it("a wrong partition → PartitionNotAllowedInSinglePartitionMode", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.investor).redeemByPartition(PARTITION_2, 1n, "0x")).to.be.revertedWithCustomError(f.bond, "PartitionNotAllowedInSinglePartitionMode");
    });
    it("redeem emits Redeemed(0, holder, value, data) and Transfer(holder, 0, value)", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.investor).redeem(5n, "0xabcd"))
        .to.emit(f.bond, "Redeemed").withArgs(ethers.ZeroAddress, f.investor.address, 5n, "0xabcd")
        .and.to.emit(f.bond, "Transfer").withArgs(f.investor.address, ethers.ZeroAddress, 5n);
    });
  });

  describe("third-party burns", () => {
    it("redeemFrom needs an allowance, for a stranger, for the holder itself and for an operator", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.stranger).redeemFrom(f.investor.address, 1n, "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
      await expect(f.bond.connect(f.investor).redeemFrom(f.investor.address, 1n, "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
      await f.bond.connect(f.investor).authorizeOperator(f.stranger.address);
      await expect(f.bond.connect(f.stranger).redeemFrom(f.investor.address, 1n, "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
    });
    it("redeemFrom consumes the allowance; the spender needs no KYC, the holder does", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).approve(f.stranger.address, 3n);
      await f.bond.connect(f.stranger).redeemFrom(f.investor.address, 2n, "0x");
      expect(await f.bond.allowance(f.investor.address, f.stranger.address)).to.equal(1n);
      await f.bond.revokeKyc(f.investor.address);
      await expect(f.bond.connect(f.stranger).redeemFrom(f.investor.address, 1n, "0x")).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
    });
    it("operatorRedeemByPartition: no authorisation fails on the allowance; an allowance alone fails Unauthorized; revoked operators are refused", async () => {
      const f = await loadFixture(investedPoolFixture);
      const op = f.bond.connect(f.stranger);
      await expect(op.operatorRedeemByPartition(PARTITION_1, f.investor.address, 1n, "0x", "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
      await f.bond.connect(f.investor).approve(f.stranger.address, 1n);
      await expect(op.operatorRedeemByPartition(PARTITION_1, f.investor.address, 1n, "0x", "0x")).to.be.revertedWithCustomError(f.bond, "Unauthorized");
      await f.bond.connect(f.investor).authorizeOperator(f.stranger.address);
      await op.operatorRedeemByPartition(PARTITION_1, f.investor.address, 1n, "0x", "0x");
      await f.bond.connect(f.investor).approve(f.stranger.address, 0n);
      await f.bond.connect(f.investor).revokeOperator(f.stranger.address);
      expect(await f.bond.isOperator(f.stranger.address, f.investor.address)).to.equal(false);
      await expect(op.operatorRedeemByPartition(PARTITION_1, f.investor.address, 1n, "0x", "0x")).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
    });
    it("a burn by an approved spender no longer locks the pool (SEC-15 fixed by D18)", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).approve(f.stranger.address, 1n);
      await f.bond.connect(f.stranger).redeemFrom(f.investor.address, 1n, "0x");
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed");
    });
  });

  describe("holds: no role, no KYC; units leave balanceOf but stay in totalSupply", () => {
    it("createHold validation, in the simulated order", async () => {
      const f = await loadFixture(investedPoolFixture);
      const b = f.bond.connect(f.investor);
      await expect(b.createHoldByPartition(PARTITION_1, hold(1n, f.investor.address, 1n))).to.be.revertedWithCustomError(f.bond, "WrongExpirationTimestamp");
      await expect(b.createHoldByPartition(PARTITION_1, hold(1n, ethers.ZeroAddress))).to.be.revertedWithCustomError(f.bond, "ZeroAddressNotAllowed");
      await expect(b.createHoldByPartition(PARTITION_2, hold(1n, f.investor.address))).to.be.revertedWithCustomError(f.bond, "PartitionNotAllowedInSinglePartitionMode");
      await expect(b.createHoldByPartition(PARTITION_1, hold(0n, f.investor.address))).to.be.revertedWithCustomError(f.bond, "InvalidHoldAmount");
      await expect(b.createHoldByPartition(PARTITION_1, hold(A_UNITS + 1n, f.investor.address))).to.be.revertedWithCustomError(f.bond, "InsufficientBalance");
      await expect(f.bond.connect(f.stranger).createHoldByPartition(PARTITION_1, hold(1n, f.stranger.address))).to.be.revertedWithCustomError(f.bond, "InvalidPartition"); // no KYC gate: it fails on the balance
      await f.bond.pause();
      await expect(b.createHoldByPartition(PARTITION_1, hold(1n, f.investor.address))).to.be.revertedWithCustomError(f.bond, "IsPaused");
    });
    it("a hold keeps totalSupply, so the supply guard stays quiet, and the pool redeems only the free balance", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).createHoldByPartition(PARTITION_1, hold(USD(100), f.investor.address));
      expect(await f.bond.balanceOf(f.investor.address)).to.equal(A_UNITS - USD(100));
      expect(await f.bond.getHeldAmountFor(f.investor.address)).to.equal(USD(100));
      expect(await f.bond.totalSupply()).to.equal(A_UNITS + B_UNITS);
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
      expect(await f.bond.balanceOf(f.investor.address)).to.equal(0n);
      expect(await f.bond.totalSupply()).to.equal(USD(100) + B_UNITS);
      await expectInvariants(f);
      // Released, the rest redeems in a second call; the holder is whole.
      await f.bond.connect(f.investor).releaseHoldByPartition(holdId(f, 1n), USD(100));
      await f.pool.connect(f.investor).redeem();
      await f.pool.connect(f.investor2).redeem();
      expect(await f.bond.totalSupply()).to.equal(0n);
      await f.pool.sweepDust();
      await expectInvariants(f, { swept: true });
    });
    it("everything held: redeem reverts NothingToRedeem and effectiveValue shows 0, for that holder only", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).createHoldByPartition(PARTITION_1, hold(A_UNITS, f.investor.address));
      const [principal] = await f.pool.effectiveValue(f.investor.address);
      expect(principal).to.equal(0n);
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "NothingToRedeem");
      await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed");
    });
    it("a hold with a dead escrow and a far expiry only delays that holder and sweepDust; sweepExcess still pays the sponsor", async () => {
      const f = await loadFixture(investedPoolFixture);
      const dead = "0x000000000000000000000000000000000000dEaD";
      await f.bond.connect(f.investor).createHoldByPartition(PARTITION_1, hold(A_UNITS, dead));
      await travelTo(f.deadline + 1n);
      await f.pool.connect(f.investor2).redeem();
      await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept");
      await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "SupplyNotZero").withArgs(A_UNITS);
      await expectInvariants(f, { swept: true });
    });
    it("release: escrow only, before expiry, within the amount; reclaim: anyone, from expiry on", async () => {
      const f = await loadFixture(investedPoolFixture);
      const expiry = (await now()) + 1000n;
      await f.bond.connect(f.investor).createHoldByPartition(PARTITION_1, hold(10n, f.investor2.address, expiry));
      await expect(f.bond.connect(f.investor).releaseHoldByPartition(holdId(f, 1n), 1n)).to.be.revertedWithCustomError(f.bond, "IsNotEscrow");
      await expect(f.bond.connect(f.investor2).releaseHoldByPartition(holdId(f, 1n), 11n)).to.be.revertedWithCustomError(f.bond, "InsufficientHoldBalance");
      await expect(f.bond.connect(f.investor2).releaseHoldByPartition(holdId(f, 2n), 1n)).to.be.revertedWithCustomError(f.bond, "WrongHoldId");
      await expect(f.bond.connect(f.stranger).reclaimHoldByPartition(holdId(f, 1n))).to.be.revertedWithCustomError(f.bond, "HoldExpirationNotReached");
      await f.bond.connect(f.investor2).releaseHoldByPartition(holdId(f, 1n), 4n);
      await travelTo(expiry);
      await expect(f.bond.connect(f.investor2).releaseHoldByPartition(holdId(f, 1n), 1n)).to.be.revertedWithCustomError(f.bond, "HoldExpirationReached");
      await f.bond.connect(f.stranger).reclaimHoldByPartition(holdId(f, 1n));
      expect(await f.bond.balanceOf(f.investor.address)).to.equal(A_UNITS);
      expect(await f.bond.getHeldAmountFor(f.investor.address)).to.equal(0n);
    });
    it("execute: the escrow moves held units to a KYC'd address, like a transfer; the destination is bound when set", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).createHoldByPartition(PARTITION_1, hold(10n, f.investor.address, FAR, f.buyer.address));
      await expect(f.bond.connect(f.investor).executeHoldByPartition(holdId(f, 1n), f.investor2.address, 1n)).to.be.revertedWithCustomError(f.bond, "InvalidDestinationAddress");
      await expect(f.bond.connect(f.investor).executeHoldByPartition(holdId(f, 1n), f.stranger.address, 1n)).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
      await expect(f.bond.connect(f.investor2).executeHoldByPartition(holdId(f, 1n), f.buyer.address, 1n)).to.be.revertedWithCustomError(f.bond, "IsNotEscrow");
      await f.bond.connect(f.investor).executeHoldByPartition(holdId(f, 1n), f.buyer.address, 10n);
      expect(await f.bond.balanceOf(f.buyer.address)).to.equal(10n);
      expect(await f.bond.totalSupply()).to.equal(A_UNITS + B_UNITS);
    });
  });

  describe("transfers change no supply and the buyer inherits the claim", () => {
    it("transferFrom needs KYC on both sides and an allowance; the supply guard stays quiet", async () => {
      const f = await loadFixture(investedPoolFixture);
      await expect(f.bond.connect(f.stranger).transferFrom(f.investor.address, f.buyer.address, 1n)).to.be.revertedWithCustomError(f.bond, "InsufficientAllowance");
      await f.bond.connect(f.investor).approve(f.stranger.address, USD(1));
      await expect(f.bond.connect(f.stranger).transferFrom(f.investor.address, f.other.address, 1n)).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
      await f.bond.connect(f.stranger).transferFrom(f.investor.address, f.buyer.address, USD(1));
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.buyer).redeem()).to.emit(f.pool, "Redeemed");
      await expectInvariants(f);
    });
  });
});
