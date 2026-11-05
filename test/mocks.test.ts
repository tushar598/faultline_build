// One test per mock rule. Each rule copies a behaviour measured in spikes S1–S3 (labels in the NatSpec).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HTS_ADDRESS, MAX_SUPPLY, USD, deployMocksFixture, onboardUsd } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { YEAR, advance } from "./helpers/time";

const selector = (sig: string) => ethers.id(sig).slice(0, 10);

/** Bond world: investor KYC'd on the bond, `minter` holds ROLE_ISSUER, `controller` holds ROLE_CONTROLLER. */
async function bondFixture() {
  const f = await deployMocksFixture();
  const [, , , , minter, controller, agent] = await ethers.getSigners();
  await f.bond.grantRole(ROLES.ISSUER, minter.address);
  await f.bond.grantRole(ROLES.CONTROLLER, controller.address);
  await f.bond.grantKyc(f.investor.address, "vc-investor", 0, 2n ** 64n, f.admin.address);
  return { ...f, minter, controller, agent };
}

describe("MockBond (ATS v8 stand-in)", () => {
  describe("ATS error selectors match the ones seen on testnet", () => {
    it("AccountHasNoRoles 0x90e55392, IsPaused 0x1309a563, InvalidKycStatus 0xfc855b1b, TokenIsNotControllable 0xf4b7b072, MaxSupplyReached(uint256)", async () => {
      const { bond } = await loadFixture(bondFixture);
      const sel = (n: string) => bond.interface.getError(n)!.selector;
      expect(sel("AccountHasNoRoles")).to.equal("0x90e55392");
      expect(sel("IsPaused")).to.equal("0x1309a563");
      expect(sel("InvalidKycStatus")).to.equal("0xfc855b1b");
      expect(sel("TokenIsNotControllable")).to.equal("0xf4b7b072");
      expect(sel("MaxSupplyReached")).to.equal(selector("MaxSupplyReached(uint256)"));
      expect(bond.interface.getError("AccountHasNoRoles")!.format("sighash")).to.equal("AccountHasNoRoles(address,bytes32[])");
    });
  });

  describe("mint / issue", () => {
    it("ROLE_ISSUER mints and issues to a KYC'd holder (S1)", async () => {
      const { bond, minter, investor } = await loadFixture(bondFixture);
      await expect(bond.connect(minter).mint(investor.address, USD(1))).to.emit(bond, "Issued").withArgs(minter.address, investor.address, USD(1), "0x");
      await bond.connect(minter).issue(investor.address, USD(1), "0x1234");
      expect(await bond.balanceOf(investor.address)).to.equal(USD(2));
      expect(await bond.totalSupply()).to.equal(USD(2));
    });

    it("ROLE_AGENT can mint too", async () => {
      const { bond, agent, investor } = await loadFixture(bondFixture);
      await bond.grantRole(ROLES.AGENT, agent.address);
      await bond.connect(agent).mint(investor.address, 1n);
      expect(await bond.totalSupply()).to.equal(1n);
    });

    it("caller without ROLE_ISSUER / ROLE_AGENT reverts AccountHasNoRoles(caller, [ISSUER, AGENT]) (S1)", async () => {
      const { bond, admin, investor } = await loadFixture(bondFixture);
      await expect(bond.mint(investor.address, 1n)).to.be.revertedWithCustomError(bond, "AccountHasNoRoles").withArgs(admin.address, [ROLES.ISSUER, ROLES.AGENT]);
      await expect(bond.issue(investor.address, 1n, "0x")).to.be.revertedWithCustomError(bond, "AccountHasNoRoles");
    });

    it("recipient without bond KYC reverts InvalidKycStatus (S1, simulated)", async () => {
      const { bond, minter, other } = await loadFixture(bondFixture);
      await expect(bond.connect(minter).mint(other.address, 1n)).to.be.revertedWithCustomError(bond, "InvalidKycStatus");
    });

    it("above max supply reverts MaxSupplyReached(maxSupply)", async () => {
      const { bond, minter, investor } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, MAX_SUPPLY);
      await expect(bond.connect(minter).mint(investor.address, 1n)).to.be.revertedWithCustomError(bond, "MaxSupplyReached").withArgs(MAX_SUPPLY);
    });

    it("while paused reverts IsPaused, before the role check (S2)", async () => {
      const { bond, minter, admin, investor } = await loadFixture(bondFixture);
      await bond.pause();
      await expect(bond.connect(minter).mint(investor.address, 1n)).to.be.revertedWithCustomError(bond, "IsPaused");
      await expect(bond.connect(admin).mint(investor.address, 1n)).to.be.revertedWithCustomError(bond, "IsPaused");
    });
  });

  describe("controllerRedeem", () => {
    it("burns from a holder WITHOUT KYC and AFTER any time has passed (S1 steps 8-9)", async () => {
      const { bond, minter, controller, investor } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, USD(2));
      await bond.revokeKyc(investor.address);
      expect(await bond.getKycStatusFor(investor.address)).to.equal(0n);
      await expect(bond.connect(controller).controllerRedeem(investor.address, 1n, "0x", "0x"))
        .to.emit(bond, "ControllerRedemption").withArgs(controller.address, investor.address, 1n, "0x", "0x");
      await advance(10n * YEAR); // the mock has no maturity, like ATS controllerRedeem
      await bond.connect(controller).controllerRedeem(investor.address, 1n, "0x", "0x");
      expect(await bond.balanceOf(investor.address)).to.equal(USD(2) - 2n);
      expect(await bond.totalSupply()).to.equal(USD(2) - 2n);
    });

    it("ROLE_AGENT can controllerRedeem; anyone else reverts AccountHasNoRoles(caller, [CONTROLLER, AGENT]) (S0/S1)", async () => {
      const { bond, minter, agent, investor, other } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, 5n);
      await bond.grantRole(ROLES.AGENT, agent.address);
      await bond.connect(agent).controllerRedeem(investor.address, 1n, "0x", "0x");
      await expect(bond.connect(other).controllerRedeem(investor.address, 1n, "0x", "0x"))
        .to.be.revertedWithCustomError(bond, "AccountHasNoRoles").withArgs(other.address, [ROLES.CONTROLLER, ROLES.AGENT]);
    });

    it("while paused reverts IsPaused (S2)", async () => {
      const { bond, minter, controller, investor } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, 5n);
      await bond.pause();
      await expect(bond.connect(controller).controllerRedeem(investor.address, 1n, "0x", "0x")).to.be.revertedWithCustomError(bond, "IsPaused");
      await bond.unpause();
      await bond.connect(controller).controllerRedeem(investor.address, 1n, "0x", "0x");
    });

    it("non-controllable bond reverts TokenIsNotControllable", async () => {
      const [admin, , , , , controller] = await ethers.getSigners();
      const bond = await ethers.deployContract("MockBond", [admin.address, 0, false]);
      await bond.grantRole(ROLES.CONTROLLER, controller.address);
      expect(await bond.isControllable()).to.equal(false);
      await expect(bond.connect(controller).controllerRedeem(admin.address, 0n, "0x", "0x")).to.be.revertedWithCustomError(bond, "TokenIsNotControllable");
    });

    it("more than the balance reverts InsufficientBalance(holder, balance, value, DEFAULT_PARTITION)", async () => {
      const { bond, minter, controller, investor } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, 5n);
      await expect(bond.connect(controller).controllerRedeem(investor.address, 6n, "0x", "0x"))
        .to.be.revertedWithCustomError(bond, "InsufficientBalance").withArgs(investor.address, 5n, 6n, await bond.DEFAULT_PARTITION());
    });
  });

  describe("holder transfers", () => {
    it("works between KYC'd holders; non-KYC recipient or sender reverts InvalidKycStatus (S1, simulated)", async () => {
      const { bond, minter, investor, other, admin } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, 10n);
      await expect(bond.connect(investor).transfer(other.address, 1n)).to.be.revertedWithCustomError(bond, "InvalidKycStatus");
      await bond.grantKyc(other.address, "vc-other", 0, 2n ** 64n, admin.address);
      await bond.connect(investor).transfer(other.address, 3n);
      expect(await bond.balanceOf(other.address)).to.equal(3n);
      await bond.revokeKyc(other.address);
      await expect(bond.connect(other).transfer(investor.address, 1n)).to.be.revertedWithCustomError(bond, "InvalidKycStatus");
    });

    it("while paused reverts IsPaused", async () => {
      const { bond, minter, investor, admin } = await loadFixture(bondFixture);
      await bond.connect(minter).mint(investor.address, 10n);
      await bond.pause();
      await expect(bond.connect(investor).transfer(admin.address, 1n)).to.be.revertedWithCustomError(bond, "IsPaused");
    });
  });

  describe("KYC, pause and roles", () => {
    it("grantKyc needs ROLE_KYC and status NOT_GRANTED; revokeKyc resets it (S1)", async () => {
      const { bond, other, investor, admin } = await loadFixture(bondFixture);
      await expect(bond.connect(other).grantKyc(other.address, "vc", 0, 1, admin.address)).to.be.revertedWithCustomError(bond, "AccountHasNoRole").withArgs(other.address, ROLES.KYC);
      await expect(bond.grantKyc(investor.address, "vc", 0, 1, admin.address)).to.be.revertedWithCustomError(bond, "InvalidKycStatus");
      await bond.revokeKyc(investor.address);
      expect(await bond.getKycStatusFor(investor.address)).to.equal(0n);
      await bond.grantKyc(investor.address, "vc", 0, 1, admin.address);
      expect(await bond.getKycStatusFor(investor.address)).to.equal(1n);
    });

    it("pause / unpause need ROLE_PAUSER; unpause while unpaused reverts IsUnpaused (S2)", async () => {
      const { bond, other } = await loadFixture(bondFixture);
      await expect(bond.connect(other).pause()).to.be.revertedWithCustomError(bond, "AccountHasNoRole").withArgs(other.address, ROLES.PAUSER);
      await expect(bond.unpause()).to.be.revertedWithCustomError(bond, "IsUnpaused");
      await bond.pause();
      expect(await bond.paused()).to.equal(true);
      await bond.unpause();
      expect(await bond.paused()).to.equal(false);
    });

    it("grantRole / revokeRole need DEFAULT_ADMIN_ROLE and keep member counts (S0/S1)", async () => {
      const { bond, minter, other } = await loadFixture(bondFixture);
      expect(await bond.getRoleMemberCount(ROLES.ISSUER)).to.equal(1n);
      expect(await bond.getRoleMemberCount(ROLES.AGENT)).to.equal(0n);
      expect(await bond.getRoleMemberCount(ROLES.ADJUSTMENT_BALANCE)).to.equal(0n);
      await expect(bond.connect(other).grantRole(ROLES.ISSUER, other.address)).to.be.revertedWithCustomError(bond, "AccountHasNoRole").withArgs(other.address, ROLES.DEFAULT_ADMIN);
      await expect(bond.grantRole(ROLES.ISSUER, minter.address)).to.be.revertedWithCustomError(bond, "AccountAssignedToRole");
      await bond.revokeRole(ROLES.ISSUER, minter.address);
      expect(await bond.hasRole(ROLES.ISSUER, minter.address)).to.equal(false);
      expect(await bond.getRoleMemberCount(ROLES.ISSUER)).to.equal(0n);
      await expect(bond.revokeRole(ROLES.ISSUER, minter.address)).to.be.revertedWithCustomError(bond, "AccountNotAssignedToRole");
    });

    it("decimals 6, controllable, admin holds DEFAULT_ADMIN_ROLE (S1)", async () => {
      const { bond, admin } = await loadFixture(bondFixture);
      expect(await bond.decimals()).to.equal(6n);
      expect(await bond.isControllable()).to.equal(true);
      expect(await bond.hasRole(ROLES.DEFAULT_ADMIN, admin.address)).to.equal(true);
      expect(await bond.getMaxSupply()).to.equal(MAX_SUPPLY);
    });
  });

  it("test hook test_adjustBalance moves a balance and totalSupply outside the pool (for the D4 supply guard)", async () => {
    const { bond, minter, investor, other } = await loadFixture(bondFixture);
    await bond.connect(minter).mint(investor.address, 10n);
    await bond.test_adjustBalance(other.address, 7n);
    expect(await bond.totalSupply()).to.equal(17n);
    await bond.test_adjustBalance(investor.address, -4n);
    expect(await bond.balanceOf(investor.address)).to.equal(6n);
    expect(await bond.totalSupply()).to.equal(13n);
  });
});

describe("MockUSD (HTS stablecoin + facade stand-in)", () => {
  it("treasury is associated and KYC'd at creation; 6 decimals (S3)", async () => {
    const { usd, admin } = await loadFixture(deployMocksFixture);
    expect(await usd.decimals()).to.equal(6n);
    expect(await usd.associatedOf(admin.address)).to.equal(true);
    expect(await usd.kycGranted(admin.address)).to.equal(true);
    expect(await usd.balanceOf(admin.address)).to.equal(USD(1_000_000));
  });

  it("associate() returns 22 the first time and 194 afterwards, without reverting (S3)", async () => {
    const { usd, investor } = await loadFixture(deployMocksFixture);
    expect(await usd.connect(investor).associate.staticCall()).to.equal(22n);
    await expect(usd.connect(investor).associate()).to.emit(usd, "Associated").withArgs(investor.address, 22n);
    expect(await usd.connect(investor).associate.staticCall()).to.equal(194n);
    await expect(usd.connect(investor).associate()).to.emit(usd, "Associated").withArgs(investor.address, 194n);
    expect(await usd.connect(investor).isAssociated()).to.equal(true);
  });

  it("a contract associates itself: isAssociated() answers for msg.sender (S3 vault)", async () => {
    const { usd, caller, other } = await loadFixture(deployMocksFixture);
    const data = usd.interface.encodeFunctionData("associate");
    const [ok, ret] = await caller.exec.staticCall(await usd.getAddress(), data);
    expect(ok).to.equal(true);
    expect(usd.interface.decodeFunctionResult("associate", ret)[0]).to.equal(22n);
    await caller.exec(await usd.getAddress(), data);
    const [, ret2] = await caller.exec.staticCall(await usd.getAddress(), data);
    expect(usd.interface.decodeFunctionResult("associate", ret2)[0]).to.equal(194n);
    const [, assoc] = await caller.exec.staticCall(await usd.getAddress(), usd.interface.encodeFunctionData("isAssociated"));
    expect(usd.interface.decodeFunctionResult("isAssociated", assoc)[0]).to.equal(true);
    expect(await usd.connect(other).isAssociated()).to.equal(false);
  });

  it("grantKyc before association reverts (real HTS: 184, S3); after association it works; admin only", async () => {
    const { usd, investor, other } = await loadFixture(deployMocksFixture);
    await expect(usd.grantKyc(investor.address)).to.be.revertedWithCustomError(usd, "TokenNotAssociatedToAccount").withArgs(investor.address);
    await usd.connect(investor).associate();
    await expect(usd.connect(other).grantKyc(investor.address)).to.be.revertedWithCustomError(usd, "NotAdmin");
    await usd.grantKyc(investor.address);
    expect(await usd.kycGranted(investor.address)).to.equal(true);
  });

  it("transfer returns true on success (S3)", async () => {
    const { usd, investor } = await loadFixture(deployMocksFixture);
    await onboardUsd(usd, investor, 0n);
    expect(await usd.transfer.staticCall(investor.address, USD(10))).to.equal(true);
    await expect(usd.transfer(investor.address, USD(10))).to.changeTokenBalances(usd, [investor], [USD(10)]);
  });

  it("transfer to a non-associated account reverts with EMPTY data, seen by a calling contract (S3)", async () => {
    const { usd, caller, other } = await loadFixture(deployMocksFixture);
    const token = await usd.getAddress();
    await caller.exec(token, usd.interface.encodeFunctionData("associate"));
    await usd.grantKyc(await caller.getAddress());
    await usd.transfer(await caller.getAddress(), USD(5));
    const [ok, ret] = await caller.exec.staticCall(token, usd.interface.encodeFunctionData("transfer", [other.address, 1n]));
    expect(ok).to.equal(false);
    expect(ethers.dataLength(ret)).to.equal(0);
    await expect(usd.transfer(other.address, 1n)).to.be.revertedWithoutReason();
  });

  it("transfer to an associated account without KYC reverts with empty data (S3: 176 in the trace)", async () => {
    const { usd, caller, other } = await loadFixture(deployMocksFixture);
    const token = await usd.getAddress();
    await caller.exec(token, usd.interface.encodeFunctionData("associate"));
    await usd.grantKyc(await caller.getAddress());
    await usd.transfer(await caller.getAddress(), USD(5));
    await usd.connect(other).associate();
    const [ok, ret] = await caller.exec.staticCall(token, usd.interface.encodeFunctionData("transfer", [other.address, 1n]));
    expect(ok).to.equal(false);
    expect(ethers.dataLength(ret)).to.equal(0);
  });

  it("transfer to or from a frozen account reverts with empty data; unfreeze restores it (S3, frozen simulated)", async () => {
    const { usd, investor, admin } = await loadFixture(deployMocksFixture);
    await onboardUsd(usd, investor, USD(10));
    await usd.freeze(investor.address);
    expect(await usd.frozen(investor.address)).to.equal(true);
    await expect(usd.transfer(investor.address, 1n)).to.be.revertedWithoutReason();
    await expect(usd.connect(investor).transfer(admin.address, 1n)).to.be.revertedWithoutReason();
    await usd.unfreeze(investor.address);
    await usd.transfer(investor.address, 1n);
  });

  it("transferFrom pulls into a KYC'd contract with allowance; no KYC on the spender's account or no allowance reverts with empty data (S3 vault)", async () => {
    const { usd, caller, investor } = await loadFixture(deployMocksFixture);
    const token = await usd.getAddress();
    const vault = await caller.getAddress();
    await onboardUsd(usd, investor, USD(100));
    await caller.exec(token, usd.interface.encodeFunctionData("associate"));
    await usd.connect(investor).approve(vault, USD(100));
    const pull = usd.interface.encodeFunctionData("transferFrom", [investor.address, vault, USD(100)]);
    let [ok, ret] = await caller.exec.staticCall(token, pull); // vault associated but no KYC (S3 step 05)
    expect([ok, ethers.dataLength(ret)]).to.deep.equal([false, 0]);
    await usd.grantKyc(vault);
    [ok, ret] = await caller.exec.staticCall(token, pull); // S3 step 06
    expect(ok).to.equal(true);
    expect(usd.interface.decodeFunctionResult("transferFrom", ret)[0]).to.equal(true);
    await caller.exec(token, pull);
    expect(await usd.balanceOf(vault)).to.equal(USD(100));
    [ok, ret] = await caller.exec.staticCall(token, usd.interface.encodeFunctionData("transferFrom", [investor.address, vault, 1n]));
    expect([ok, ethers.dataLength(ret)]).to.deep.equal([false, 0]);
  });

  it("revokeKyc / freeze / unfreeze on a non-associated account revert", async () => {
    const { usd, other } = await loadFixture(deployMocksFixture);
    await expect(usd.revokeKyc(other.address)).to.be.revertedWithCustomError(usd, "TokenNotAssociatedToAccount");
    await expect(usd.freeze(other.address)).to.be.revertedWithCustomError(usd, "TokenNotAssociatedToAccount");
    await expect(usd.unfreeze(other.address)).to.be.revertedWithCustomError(usd, "TokenNotAssociatedToAccount");
  });

  it("dissociate returns 184 when not associated, 195 with a balance, 22 otherwise", async () => {
    const { usd, investor, other } = await loadFixture(deployMocksFixture);
    expect(await usd.connect(other).dissociate.staticCall()).to.equal(184n);
    await onboardUsd(usd, investor, 1n);
    expect(await usd.connect(investor).dissociate.staticCall()).to.equal(195n);
    await usd.connect(other).associate();
    expect(await usd.connect(other).dissociate.staticCall()).to.equal(22n);
  });

  it("test hook test_setTransferFee makes the recipient receive less (balance-delta check)", async () => {
    const { usd, investor, admin } = await loadFixture(deployMocksFixture);
    await onboardUsd(usd, investor, USD(100));
    await usd.test_setTransferFee(100); // 1 %
    await expect(usd.connect(investor).transfer(admin.address, USD(10))).to.changeTokenBalances(usd, [investor, admin], [-USD(10), USD(10)]);
    await usd.connect(investor).associate();
    await usd.transfer(investor.address, USD(10));
    expect(await usd.balanceOf(investor.address)).to.equal(USD(90) + USD(10) - USD(10) / 100n);
    await expect(usd.test_setTransferFee(10_001)).to.be.revertedWithCustomError(usd, "FeeTooHigh");
  });

  it("test hook test_mint needs an associated recipient", async () => {
    const { usd, other } = await loadFixture(deployMocksFixture);
    await expect(usd.test_mint(other.address, 1n)).to.be.revertedWithoutReason();
    await usd.connect(other).associate();
    await usd.test_mint(other.address, 5n);
    expect(await usd.balanceOf(other.address)).to.equal(5n);
  });
});

describe("MockHTS at 0x167", () => {
  it("isKyc: KYC'd → (22, true); associated without KYC → (22, false); never associated → (22, false), not 184 (D11, simulated)", async () => {
    const { hts, usd, investor, other, sponsor } = await loadFixture(deployMocksFixture);
    const token = await usd.getAddress();
    await onboardUsd(usd, investor, 0n);
    await usd.connect(other).associate();
    expect(await hts.isKyc.staticCall(token, investor.address)).to.deep.equal([22n, true]);
    expect(await hts.isKyc.staticCall(token, other.address)).to.deep.equal([22n, false]);
    expect(await hts.isKyc.staticCall(token, sponsor.address)).to.deep.equal([22n, false]);
  });

  it("isFrozen follows MockUSD freeze; callable from a contract through 0x167", async () => {
    const { hts, usd, investor, caller } = await loadFixture(deployMocksFixture);
    const token = await usd.getAddress();
    await onboardUsd(usd, investor, 0n);
    expect(await hts.isFrozen.staticCall(token, investor.address)).to.deep.equal([22n, false]);
    await usd.freeze(investor.address);
    const [ok, ret] = await caller.exec.staticCall(HTS_ADDRESS, hts.interface.encodeFunctionData("isFrozen", [token, investor.address]));
    expect(ok).to.equal(true);
    expect(hts.interface.decodeFunctionResult("isFrozen", ret).toArray()).to.deep.equal([22n, true]);
    expect(await ethers.provider.getCode(HTS_ADDRESS)).to.not.equal("0x");
  });
});

describe("MockTrigger", () => {
  it("serves pool(), settable pendingCount / submissionDeadline, and forwards applyLoss as the trigger", async () => {
    const recorder = await ethers.deployContract("ApplyLossRecorder");
    const trigger = await ethers.deployContract("MockTrigger", [await recorder.getAddress()]);
    expect(await trigger.pool()).to.equal(await recorder.getAddress());
    await trigger.test_setPendingCount(2);
    await trigger.test_setSubmissionDeadline(1_900_000_000);
    expect(await trigger.pendingCount()).to.equal(2n);
    expect(await trigger.submissionDeadline()).to.equal(1_900_000_000n);
    await trigger.forwardApplyLoss(2500);
    expect(await recorder.lastCaller()).to.equal(await trigger.getAddress());
    expect(await recorder.lastBps()).to.equal(2500n);
  });
});
