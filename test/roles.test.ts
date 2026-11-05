// RT-19: the role surface inherited from OpenZeppelin AccessControl on the pool and the trigger. Mock-tested.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { EV_A, WINDOW, makeAtt, submit, triggerFixture } from "./helpers/trigger";
import { advance, travelTo } from "./helpers/time";

const ANY_ROLE = ethers.id("ANY_ROLE");
const ADMIN = ethers.ZeroHash;

describe("Inherited role surface (RT-19)", () => {
  for (const name of ["pool", "trigger"] as const) {
    describe(name, () => {
      it("a stranger can neither grant nor revoke any role", async () => {
        const f = await loadFixture(triggerFixture);
        const c = f[name];
        for (const role of [ADMIN, ANY_ROLE]) {
          await expect(c.connect(f.stranger).grantRole(role, f.stranger.address))
            .to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount")
            .withArgs(f.stranger.address, ADMIN);
          await expect(c.connect(f.stranger).revokeRole(role, f.admin.address)).to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount");
        }
      });
      it("renounceRole needs the caller's own address as confirmation", async () => {
        const f = await loadFixture(triggerFixture);
        const c = f[name];
        await expect(c.connect(f.stranger).renounceRole(ADMIN, f.admin.address)).to.be.revertedWithCustomError(c, "AccessControlBadConfirmation");
        await expect(c.connect(f.admin).renounceRole(ADMIN, f.stranger.address)).to.be.revertedWithCustomError(c, "AccessControlBadConfirmation");
        expect(await c.hasRole(ADMIN, f.admin.address)).to.equal(true);
      });
    });
  }

  it("the pool's admin has no power over funds: after initialize its role touches no book, and neither does any role it grants itself", async () => {
    const f = await loadFixture(triggerFixture);
    await f.pool.connect(f.admin).grantRole(ANY_ROLE, f.admin.address);
    await expect(f.pool.connect(f.admin).applyLoss(1)).to.be.revertedWithCustomError(f.pool, "OnlyTrigger");
    await expect(f.pool.connect(f.admin).fundCoupons(USD(1))).to.be.revertedWithCustomError(f.pool, "OnlySponsor");
    await expect(f.pool.connect(f.admin).claim()).to.be.revertedWithCustomError(f.pool, "NothingToClaim");
    await expect(f.pool.connect(f.admin).initialize(await f.trigger.getAddress())).to.be.revertedWithCustomError(f.pool, "AlreadyInitialized");
    await expect(f.pool.connect(f.admin).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
  });

  it("the pool's admin can renounce after initialize and the whole lifecycle still completes", async () => {
    const f = await loadFixture(triggerFixture);
    await f.pool.connect(f.admin).renounceRole(ADMIN, f.admin.address);
    await submit(f, makeAtt(f));
    await advance(WINDOW);
    await f.trigger.execute(EV_A);
    await travelTo((await f.trigger.submissionDeadline()) + 1n);
    for (const who of [f.investor, f.investor2]) await f.pool.connect(who).redeem();
    await f.pool.sweepDust();
    for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
    expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
  });

  it("the trigger's admin cannot execute early, veto, or pause: only unpause and setOracle (D17)", async () => {
    const f = await loadFixture(triggerFixture);
    await submit(f, makeAtt(f));
    await expect(f.trigger.connect(f.admin).veto(EV_A)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.admin).pause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.admin).execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "WindowOpen");
  });

  it("strangers cannot call the admin or trustee functions of the trigger", async () => {
    const f = await loadFixture(triggerFixture);
    await expect(f.trigger.connect(f.stranger).setOracle(f.stranger.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.stranger).unpause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.stranger).pause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
    await expect(f.trigger.connect(f.oracle).veto(EV_A)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
  });

  it("a role with no admin path stays empty: the trustee role cannot be reached through DEFAULT_ADMIN_ROLE", async () => {
    const f = await loadFixture(triggerFixture);
    const TRUSTEE = await f.trigger.TRUSTEE_ROLE();
    expect(await f.trigger.getRoleAdmin(TRUSTEE)).to.equal(TRUSTEE);
    await expect(f.trigger.connect(f.admin).grantRole(TRUSTEE, f.admin.address)).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
  });
});
