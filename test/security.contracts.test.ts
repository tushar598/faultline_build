// Security review (HANDOVER §10 step 8, docs/SECURITY-REVIEW.md). Owner decisions of 2026-10-27:
//   SEC-01, SEC-03, SEC-04 fixed in the contracts (D17) → the PoCs are now regression tests;
//   SEC-02 accepted by design (D4 prefers a lock to a drain) → the PoC documents the accepted behaviour;
//   SEC-06 accepted and documented (finality is the first execute after the window) → characterisation test.
// Boundary tests for SEC-03 and the claim tests for SEC-04 also live in test/{trigger,pool}.setup and pool.claim.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { advance, travelTo } from "./helpers/time";
import { EV_A, Status, WINDOW, makeAtt, submit, triggerFixture } from "./helpers/trigger";

describe("Security review — contract regressions and accepted behaviour", () => {
  describe("SEC-01 (fixed, D17): the trigger admin can no longer take the veto away", () => {
    it("admin cannot revoke the trustee; even after it rotates the oracle to its own key, the trustee vetoes the forged event", async () => {
      const f = await loadFixture(triggerFixture);
      const TRUSTEE_ROLE = await f.trigger.TRUSTEE_ROLE();
      const [, , , , , , , , , , , attacker] = await ethers.getSigners();
      await expect(f.trigger.connect(f.admin).revokeRole(TRUSTEE_ROLE, f.trustee.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
      await expect(f.trigger.connect(f.admin).grantRole(TRUSTEE_ROLE, attacker.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
      await f.trigger.connect(f.admin).setOracle(attacker.address); // the admin keeps oracle rotation
      await submit(f, makeAtt(f, { lossBps: 10_000n }), attacker);
      await f.trigger.connect(f.trustee).veto(EV_A);
      await advance(WINDOW);
      await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "NotPending");
      expect(await f.pool.appliedLossBps()).to.equal(0);
    });
    it("a backup trustee added by the primary can veto and pause on its own", async () => {
      const f = await loadFixture(triggerFixture);
      const TRUSTEE_ROLE = await f.trigger.TRUSTEE_ROLE();
      const [, , , , , , , , , , , , backup] = await ethers.getSigners();
      await f.trigger.connect(f.trustee).grantRole(TRUSTEE_ROLE, backup.address);
      await submit(f, makeAtt(f));
      await f.trigger.connect(backup).pause();
      await f.trigger.connect(backup).veto(EV_A);
      expect((await f.trigger.getEventRecord(EV_A)).status).to.equal(Status.Vetoed);
    });
  });

  describe("SEC-02 (accepted, D4): a foreign mint or ATS balance adjustment locks redemption instead of draining it", () => {
    it("after one foreign unit, redeem and sweepExcess revert SupplyMismatch for everyone; sweepDust needs supply 0", async () => {
      const f = await loadFixture(triggerFixture);
      await f.bond.test_adjustBalance(f.stranger.address, 1n); // stands in for a re-granted ROLE_ISSUER or adjustBalances
      await travelTo((await f.trigger.submissionDeadline()) + 1n);
      for (const who of [f.investor, f.investor2]) await expect(f.pool.connect(who).redeem()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch");
      await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch");
      await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "SupplyNotZero");
      // Burning the foreign unit again (the bond admin restores the supply) reopens redemption.
      await f.bond.test_adjustBalance(f.stranger.address, -1n);
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    });
  });

  describe("SEC-03 (fixed, D17): schedule bounds keep the window and deadline maths from overflowing", () => {
    it("a 2^64 - 1 challenge window no longer deploys (it used to freeze a pending event for ever)", async () => {
      const f = await loadFixture(triggerFixture);
      const factory = await ethers.getContractFactory("FaultlineTrigger");
      await expect(factory.deploy(f.pool.getAddress(), ethers.ZeroHash, 2n ** 64n - 1n, f.oracle.address, f.admin.address, f.trustee.address)).to.be.revertedWithCustomError(factory, "InvalidSchedule");
    });
  });

  describe("SEC-04 (fixed, D17): claim pre-checks the pool's own stablecoin KYC", () => {
    it("with the pool's KYC revoked, claim reports NotKycForToken(pool) instead of an empty revert", async () => {
      const f = await loadFixture(triggerFixture);
      await submit(f, makeAtt(f));
      await advance(WINDOW);
      await f.trigger.execute(EV_A);
      await f.usd.revokeKyc(await f.pool.getAddress());
      await expect(f.pool.connect(f.sponsor).claim()).to.be.revertedWithCustomError(f.pool, "NotKycForToken").withArgs(await f.pool.getAddress());
    });
  });

  describe("SEC-06 (accepted, documented): a revision after the window ended but before execute restarts the window", () => {
    it("revision first: submit accepts nonce 2 after the window is complete, execute must wait a full new window and applies the revised loss", async () => {
      const f = await loadFixture(triggerFixture);
      const first = makeAtt(f, { lossBps: 7_000n });
      await submit(f, first);
      await advance(WINDOW + 10n);
      expect(await f.trigger.windowRemaining(EV_A)).to.equal(0);
      await submit(f, { ...first, nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt + 1n, lossBps: 2_000n });
      expect(await f.trigger.windowRemaining(EV_A)).to.equal(WINDOW);
      expect((await f.trigger.getEventRecord(EV_A)).status).to.equal(Status.Pending);
      await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen");
      await advance(WINDOW);
      await f.trigger.execute(EV_A);
      expect(await f.pool.appliedLossBps()).to.equal(2_000);
    });
    it("execute first: the original loss is final and the late revision reverts EventFinalised", async () => {
      const f = await loadFixture(triggerFixture);
      const first = makeAtt(f, { lossBps: 7_000n });
      await submit(f, first);
      await advance(WINDOW + 10n);
      await f.trigger.execute(EV_A);
      expect(await f.pool.appliedLossBps()).to.equal(7_000);
      await expect(submit(f, { ...first, nonce: 2n, usgsUpdatedAt: first.usgsUpdatedAt + 1n, lossBps: 2_000n }))
        .to.be.revertedWithCustomError(f.trigger, "EventFinalised")
        .withArgs(EV_A, Status.Executed);
    });
  });
});
