// FaultlineTrigger constructor, roles and EIP-712 wiring (ARCHITECTURE §4.1, §4.2, §6.1).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ATTESTATION_SPEC, attestationDomain, attestationTypes } from "./helpers/eip712";
import { ROLES } from "./helpers/roles";
import { CHAIN_ID, TERMS, WINDOW, deployTriggerFixture, makeAtt } from "./helpers/trigger";

describe("FaultlineTrigger — constructor and roles", () => {
  it("copies the schedule from the pool and stores pool, terms, window and oracle", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const t = f.trigger;
    expect(await t.pool()).to.equal(await f.pool.getAddress());
    expect(await t.termsHash()).to.equal(TERMS);
    expect(await t.challengeWindow()).to.equal(WINDOW);
    expect(await t.riskStart()).to.equal(await f.pool.riskStart());
    expect(await t.maturity()).to.equal(await f.pool.maturity());
    expect(await t.grace()).to.equal(await f.pool.grace());
    expect(await t.oracle()).to.equal(f.oracle.address);
    expect(await t.paused()).to.equal(false);
    expect(await t.pauseStart()).to.equal(0);
    expect(await t.totalPausedSeconds()).to.equal(0);
    expect(await t.pendingCount()).to.equal(0);
    expect(await t.submissionDeadline()).to.equal(f.s.maturity + f.s.grace);
    expect(await f.pool.trigger()).to.equal(await t.getAddress());
  });

  it("grants DEFAULT_ADMIN_ROLE to admin and TRUSTEE_ROLE = keccak256('TRUSTEE_ROLE') to trustee; trustees manage trustees (D17)", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const t = f.trigger;
    const TRUSTEE = ethers.id("TRUSTEE_ROLE");
    expect(await t.TRUSTEE_ROLE()).to.equal(TRUSTEE);
    expect(await t.hasRole(ROLES.DEFAULT_ADMIN, f.admin.address)).to.equal(true);
    expect(await t.hasRole(TRUSTEE, f.trustee.address)).to.equal(true);
    expect(await t.hasRole(TRUSTEE, f.admin.address)).to.equal(false);
    expect(await t.getRoleAdmin(TRUSTEE)).to.equal(TRUSTEE);
    // D17 (SEC-01): the admin can neither add nor remove a trustee.
    for (const call of [t.grantRole(TRUSTEE, f.other.address), t.revokeRole(TRUSTEE, f.trustee.address)]) {
      await expect(call).to.be.revertedWithCustomError(t, "AccessControlUnauthorizedAccount").withArgs(f.admin.address, TRUSTEE);
    }
    // The trustee adds a backup trustee; either can remove the other or renounce.
    await t.connect(f.trustee).grantRole(TRUSTEE, f.other.address);
    expect(await t.hasRole(TRUSTEE, f.other.address)).to.equal(true);
    await t.connect(f.other).revokeRole(TRUSTEE, f.trustee.address);
    expect(await t.hasRole(TRUSTEE, f.trustee.address)).to.equal(false);
    await t.connect(f.other).renounceRole(TRUSTEE, f.other.address);
    expect(await t.hasRole(TRUSTEE, f.other.address)).to.equal(false);
  });

  it("reverts ZeroAddress for a zero pool, oracle, admin or trustee, and InvalidSchedule for a zero window", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const factory = await ethers.getContractFactory("FaultlineTrigger");
    const args = [await f.pool.getAddress(), TERMS, WINDOW, f.oracle.address, f.admin.address, f.trustee.address] as const;
    for (const i of [0, 3, 4, 5]) {
      const bad = [...args] as unknown[];
      bad[i] = ethers.ZeroAddress;
      await expect(factory.deploy(...(bad as Parameters<typeof factory.deploy>)), `arg ${i}`).to.be.revertedWithCustomError(factory, "ZeroAddress");
    }
    const zeroWindow = [...args] as unknown[];
    zeroWindow[2] = 0n;
    await expect(factory.deploy(...(zeroWindow as Parameters<typeof factory.deploy>))).to.be.revertedWithCustomError(factory, "InvalidSchedule");
  });

  it("D17 (SEC-03): challengeWindow of exactly 30 days deploys; 30 days + 1 s reverts InvalidSchedule", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const factory = await ethers.getContractFactory("FaultlineTrigger");
    const MAX = 30n * 24n * 3600n;
    const deploy = (w: bigint) => factory.deploy(f.pool.getAddress(), TERMS, w, f.oracle.address, f.admin.address, f.trustee.address);
    expect(await (await deploy(MAX)).challengeWindow()).to.equal(MAX);
    await expect(deploy(MAX + 1n)).to.be.revertedWithCustomError(factory, "InvalidSchedule");
  });

  it("has no receive(): a plain HBAR (ETH) transfer reverts", async () => {
    const f = await loadFixture(deployTriggerFixture);
    await expect(f.admin.sendTransaction({ to: await f.trigger.getAddress(), value: 1n })).to.be.revertedWithoutReason();
  });
});

describe("FaultlineTrigger — EIP-712", () => {
  it("ATTESTATION_TYPEHASH == keccak256 of the type string built from shared/attestation.eip712.json", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const encoded = ethers.TypedDataEncoder.from(attestationTypes).encodeType(ATTESTATION_SPEC.primaryType);
    expect(await f.trigger.ATTESTATION_TYPEHASH()).to.equal(ethers.keccak256(ethers.toUtf8Bytes(encoded)));
  });

  it("hashAttestation(att) == ethers TypedDataEncoder.hash(domain, JSON types, att) — pins name, version, chainId, verifyingContract", async () => {
    const f = await loadFixture(deployTriggerFixture);
    const att = makeAtt(f);
    const domain = attestationDomain(CHAIN_ID, await f.trigger.getAddress());
    expect(domain.name).to.equal("FaultlineTrigger");
    expect(domain.version).to.equal("1");
    expect(await f.trigger.hashAttestation(att)).to.equal(ethers.TypedDataEncoder.hash(domain, attestationTypes, att));
    const d = await f.trigger.eip712Domain();
    expect([d.name, d.version, d.chainId, d.verifyingContract]).to.deep.equal(["FaultlineTrigger", "1", CHAIN_ID, await f.trigger.getAddress()]);
    // Any other domain gives a different digest.
    const other = { ...domain, chainId: 296n };
    expect(await f.trigger.hashAttestation(att)).to.not.equal(ethers.TypedDataEncoder.hash(other, attestationTypes, att));
  });
});
