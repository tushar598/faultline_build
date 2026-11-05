// Deploy-script mitigation for the deployer's DEFAULT_ADMIN_ROLE on the bond (SEC-02, accepted). Spike S2 already proved on
// testnet that a paused bond reverts controllerRedeem and mint, so that is not re-proved here. Mock-tested.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DEFAULT_ADMIN_ROLE, FORBIDDEN_ROLES, auditBondRoles, handOverBondAdmin } from "../scripts/lib/bondAudit";
import { ROLES } from "./helpers/roles";
import { deployMocksFixture } from "./helpers/fixtures";
import { wiredPoolFixture } from "./helpers/pool";

/** Wired pool, minus the PAUSER the mock fixture gives its admin for the bond-pause tests. */
async function auditedFixture() {
  const f = await wiredPoolFixture();
  await f.bond.revokeRole(ROLES.PAUSER, f.admin.address);
  return f;
}

describe("Bond role audit and admin handover (SEC-02 mitigation)", () => {
  it("a correctly wired bond passes", async () => {
    const f = await loadFixture(auditedFixture);
    expect(await auditBondRoles(f.bond, await f.pool.getAddress())).to.deep.equal([]);
  });

  for (const [name, { id }] of Object.entries(FORBIDDEN_ROLES)) {
    it(`reports ${name} on any account`, async () => {
      const f = await loadFixture(auditedFixture);
      await f.bond.grantRole(id, f.stranger.address);
      const problems = await auditBondRoles(f.bond, await f.pool.getAddress());
      expect(problems).to.have.length(1);
      expect(problems[0]).to.contain(name);
    });
  }

  it("reports a second issuer, and a pool with no controller role", async () => {
    const f = await loadFixture(auditedFixture);
    const pool = await f.pool.getAddress();
    await f.bond.grantRole(ROLES.ISSUER, f.stranger.address);
    await f.bond.revokeRole(ROLES.CONTROLLER, pool);
    const problems = await auditBondRoles(f.bond, pool);
    expect(problems.some((p) => p.includes("ROLE_ISSUER"))).to.equal(true);
    expect(problems.some((p) => p.includes("ROLE_CONTROLLER"))).to.equal(true);
  });

  it("reports a bond that is not controllable", async () => {
    const f = await loadFixture(auditedFixture);
    const bond = await ethers.deployContract("MockBond", [f.admin.address, 0, false]);
    const pool = await f.pool.getAddress();
    await bond.grantRole(ROLES.ISSUER, pool);
    await bond.grantRole(ROLES.CONTROLLER, pool);
    expect(await auditBondRoles(bond, pool)).to.deep.equal(["the bond is not controllable, so redeem can never work"]);
  });

  it("the handover leaves exactly one admin, the new one; the deployer loses every admin power", async () => {
    const { bond, admin, other } = await loadFixture(deployMocksFixture);
    await handOverBondAdmin(bond, admin.address, other.address);
    expect(await bond.hasRole(DEFAULT_ADMIN_ROLE, other.address)).to.equal(true);
    expect(await bond.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(false);
    expect(await bond.getRoleMemberCount(DEFAULT_ADMIN_ROLE)).to.equal(1n);
    await expect(bond.grantRole(ROLES.ISSUER, admin.address)).to.be.revertedWithCustomError(bond, "AccountHasNoRole");
  });

  it("the handover refuses a no-op, which would have revoked the only admin", async () => {
    const { bond, admin } = await loadFixture(deployMocksFixture);
    await expect(handOverBondAdmin(bond, admin.address, admin.address)).to.be.rejectedWith("must differ");
  });

  it("the role table still passes after the handover", async () => {
    const f = await loadFixture(auditedFixture);
    await handOverBondAdmin(f.bond, f.admin.address, f.other.address);
    expect(await auditBondRoles(f.bond, await f.pool.getAddress())).to.deep.equal([]);
  });
});
