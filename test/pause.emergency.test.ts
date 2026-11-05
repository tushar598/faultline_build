// Task 2E: pause and emergency behaviour on the D18 build. Mock-tested, except that spike S2 and the full demo proved the
// bond-pause revert and a pause-veto-unpause cycle on testnet. Not repeated here: the pause clock and D2 deadline (test/trigger.pause),
// lost keys and repeated pauses (test/trigger.griefing, SEC-19), bond state changes (test/pool.bondstate).
import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { fingerprint } from "./helpers/state";
import { DAY, advance, travelTo } from "./helpers/time";
import { MIN_TICKET, deployPoolFixture, wirePool } from "./helpers/pool";
import { EV_A, EV_B, Status, TERMS, WINDOW, deployTriggerFixture, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

type World = Awaited<ReturnType<typeof triggerFixture>>;
const ROOT = path.join(__dirname, "..");
const accountsOf = (f: World) => [f.sponsor, f.investor, f.investor2, f.buyer, f.stranger, f.admin].map((a) => a.address);

/** Event A executed at 3000 bps (sponsor credit waiting), event B pending, and the trigger paused before the deadline. */
async function pausedWithCreditFixture() {
  const f = await triggerFixture();
  await submit(f, makeAtt(f, { lossBps: 3_000n }));
  await travelTo((await f.trigger.windowEndsAt(EV_A)) + 1n);
  await f.trigger.execute(EV_A);
  await submit(f, makeAtt(f, { eventId: EV_B, lossBps: 1_000n }));
  await f.trigger.connect(f.trustee).pause();
  return f;
}

/** The whole lifecycle done, except the trigger is paused after the deadline with nothing pending. */
async function pausedAfterDeadlineFixture() {
  const f = await triggerFixture();
  await travelTo((await f.trigger.submissionDeadline()) + 1n);
  await f.trigger.connect(f.trustee).pause();
  return f;
}

describe("Pause and emergency (task 2E)", () => {
  describe("while paused before the deadline: what stops", () => {
    const stopped: [string, (f: World) => Promise<unknown>, string][] = [
      ["submit", async (f) => submit(f, makeAtt(f, { eventId: ethers.id("new") })), "IsPaused"],
      ["execute, even past the window", async (f) => { await advance(WINDOW * 2n); return f.trigger.execute(EV_B); }, "IsPaused"],
      ["redeem", async (f) => f.pool.connect(f.investor).redeem(), "RedemptionNotOpen"],
      ["sweepExcess", async (f) => f.pool.sweepExcess(), "RedemptionNotOpen"],
      ["sweepDust", async (f) => f.pool.sweepDust(), "RedemptionNotOpen"],
      ["a second pause", async (f) => f.trigger.connect(f.trustee).pause(), "IsPaused"],
    ];
    for (const [name, op, error] of stopped) {
      it(`${name} reverts ${error}, and leaves every stored value as it was`, async () => {
        const f = await loadFixture(pausedWithCreditFixture);
        const before = await fingerprint(f, accountsOf(f), [EV_A, EV_B]);
        await expect(op(f)).to.be.revertedWithCustomError(name === "redeem" || name.startsWith("sweep") ? f.pool : f.trigger, error);
        expect(await fingerprint(f, accountsOf(f), [EV_A, EV_B])).to.equal(before);
      });
    }
    it("redeem stays closed long after the original deadline, for as long as the pause runs", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await travelTo(f.deadline + 400n * DAY);
      await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "RedemptionNotOpen");
    });
  });

  describe("while paused: what stays available", () => {
    it("the sponsor claims a write-down credit already earned", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      const credit = await f.pool.claimable(f.sponsor.address);
      expect(credit).to.be.gt(0n);
      await expect(f.pool.connect(f.sponsor).claim()).to.emit(f.pool, "Claimed").withArgs(f.sponsor.address, credit);
    });
    it("the trustee vetoes", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await f.trigger.connect(f.trustee).veto(EV_B);
      expect((await f.trigger.getEventRecord(EV_B)).status).to.equal(Status.Vetoed);
      expect(await f.trigger.pendingCount()).to.equal(0n);
    });
    it("holders transfer their units: the pause never touches the bond", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await f.bond.connect(f.investor).transfer(f.buyer.address, USD(1));
      expect(await f.bond.balanceOf(f.buyer.address)).to.equal(USD(1));
      expect(await f.bond.paused()).to.equal(false);
    });
    it("the views answer: effective value, solvency, deadline", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await advance(10n);
      const [principal] = await f.pool.effectiveValue(f.investor.address);
      expect(principal).to.be.gt(0n);
      expect(await f.pool.isSolvent()).to.equal(true);
      expect(await f.trigger.submissionDeadline()).to.be.gt(f.deadline);
    });
    it("the admin rotates the oracle and trustees add a backup", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await f.trigger.connect(f.admin).setOracle(f.oracle2.address);
      await f.trigger.connect(f.trustee).grantRole(await f.trigger.TRUSTEE_ROLE(), f.oracle2.address);
      expect(await f.trigger.oracle()).to.equal(f.oracle2.address);
    });
    it("invest and fundCoupons keep working during issuance: the pause guards events, not subscriptions", async () => {
      const f = await loadFixture(deployTriggerFixture);
      await travelTo(f.s.issuanceStart);
      await f.trigger.connect(f.trustee).pause();
      await f.pool.connect(f.investor).invest(MIN_TICKET);
      await f.pool.connect(f.sponsor).fundCoupons(1n);
      expect(await f.pool.unitsIssued()).to.equal(MIN_TICKET);
    });
    it("a pause begun after the deadline leaves redeem, claim and both sweeps open, and submit closed", async () => {
      const f = await loadFixture(pausedAfterDeadlineFixture);
      await f.pool.connect(f.investor).redeem();
      await f.pool.connect(f.investor).claim();
      await f.pool.sweepExcess();
      await f.pool.connect(f.investor2).redeem();
      await f.pool.sweepDust();
      await expect(submit(f, makeAtt(f))).to.be.revertedWithCustomError(f.trigger, "IsPaused");
    });
  });

  describe("authorisation", () => {
    it("every non-trustee is refused pause, and every non-admin is refused unpause, oracle sponsor and investor included", async () => {
      const f = await loadFixture(triggerFixture);
      for (const who of [f.admin, f.oracle, f.sponsor, f.investor, f.stranger, f.relayer]) {
        await expect(f.trigger.connect(who).pause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
      }
      await f.trigger.connect(f.trustee).pause();
      for (const who of [f.trustee, f.oracle, f.sponsor, f.investor, f.stranger, f.relayer]) {
        await expect(f.trigger.connect(who).unpause()).to.be.revertedWithCustomError(f.trigger, "AccessControlUnauthorizedAccount");
      }
      expect(await f.trigger.paused()).to.equal(true);
    });
    it("the pool's admin holds no pause: neither it nor anyone else can pause the pool", async () => {
      const f = await loadFixture(triggerFixture);
      expect(f.pool.interface.fragments.some((x) => x.type === "function" && /pause/i.test(x.format()))).to.equal(false);
    });
    it("a paused trigger unpaused by the admin picks up where it stopped: the pending event executes after its remaining window", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await advance(10n * DAY);
      await f.trigger.connect(f.admin).unpause();
      await travelTo((await f.trigger.windowEndsAt(EV_B)) + (await f.trigger.totalPausedSeconds()) + 1n);
      await expect(f.trigger.execute(EV_B)).to.emit(f.trigger, "EventExecuted");
    });
  });

  describe("no partial state after a failed operation", () => {
    it("redeem with the bond's burn failing: no credit, no books, no index move", async () => {
      const f = await loadFixture(triggerFixture);
      await travelTo((await f.trigger.submissionDeadline()) + 1n);
      await f.bond.revokeRole(ROLES.CONTROLLER, await f.pool.getAddress());
      const before = await fingerprint(f, accountsOf(f));
      await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.bond, "AccountHasNoRoles");
      expect(await fingerprint(f, accountsOf(f))).to.equal(before);
    });
    it("invest with the bond's mint failing: the stablecoin pull is undone", async () => {
      const f = await loadFixture(deployTriggerFixture);
      await travelTo(f.s.issuanceStart);
      await f.bond.revokeRole(ROLES.ISSUER, await f.pool.getAddress());
      const before = await fingerprint(f, accountsOf(f));
      await expect(f.pool.connect(f.investor).invest(MIN_TICKET)).to.be.revertedWithCustomError(f.bond, "AccountHasNoRoles");
      expect(await fingerprint(f, accountsOf(f))).to.equal(before);
    });
    it("claim with a frozen recipient: the credit survives, totals unchanged", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      await f.usd.freeze(f.sponsor.address);
      const before = await fingerprint(f, accountsOf(f));
      await expect(f.pool.connect(f.sponsor).claim()).to.be.reverted;
      expect(await fingerprint(f, accountsOf(f))).to.equal(before);
    });
    it("execute with a mis-wired pool: the event stays Pending and the count stays, so nothing is half done", async () => {
      const f = await loadFixture(deployPoolFixture);
      const signers = await ethers.getSigners();
      const [oracle] = [signers[7]];
      const wrong = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), TERMS, WINDOW, oracle.address, f.admin.address, signers[8].address]);
      await wirePool(f, await f.trigger.getAddress());
      await travelTo(f.s.riskStart + DAY);
      const att = { eventId: EV_A, lossBps: 1_000n, magnitudeX100: 700n, observedAt: f.s.riskStart, usgsUpdatedAt: f.s.riskStart, nonce: 1n, termsHash: TERMS, dataHash: ethers.ZeroHash, deadline: f.deadline };
      await wrong.submit(att, await sign(oracle, att, await wrong.getAddress()));
      await advance(WINDOW);
      await expect(wrong.execute(EV_A)).to.be.revertedWithCustomError(f.pool, "OnlyTrigger");
      expect((await wrong.getEventRecord(EV_A)).status).to.equal(Status.Pending);
      expect(await wrong.pendingCount()).to.equal(1n);
    });
  });

  describe("no asset extraction through emergency paths", () => {
    it("the public write surface is exactly this list: no rescue, withdraw, recover or emergency function exists", async () => {
      const f = await loadFixture(triggerFixture);
      const writes = (c: typeof f.pool | typeof f.trigger) =>
        c.interface.fragments.filter((x) => x.type === "function" && !["view", "pure"].includes((x as unknown as { stateMutability: string }).stateMutability)).map((x) => (x as unknown as { name: string }).name).sort();
      const roles = ["grantRole", "renounceRole", "revokeRole"];
      expect(writes(f.pool)).to.deep.equal([...roles, "applyLoss", "claim", "fundCoupons", "initialize", "invest", "redeem", "sweepDust", "sweepExcess"].sort());
      expect(writes(f.trigger)).to.deep.equal([...roles, "execute", "pause", "setOracle", "submit", "unpause", "veto"].sort());
    });
    it("the stablecoin leaves the pool at one place only, claim, and only to msg.sender", async () => {
      const source = fs.readFileSync(path.join(ROOT, "contracts", "FaultlinePool.sol"), "utf8");
      expect(source.match(/safeTransfer\(/g)).to.have.length(1);
      expect(source).to.include("stablecoin.safeTransfer(msg.sender, amount);");
      expect(fs.readFileSync(path.join(ROOT, "contracts", "FaultlineTrigger.sol"), "utf8")).to.not.match(/transfer\(/i);
    });
    it("a stranger running the sweeps gets nothing: every sweep credits the sponsor", async () => {
      const f = await loadFixture(pausedAfterDeadlineFixture);
      const before = await f.usd.balanceOf(f.stranger.address);
      await f.pool.connect(f.stranger).sweepExcess();
      expect(await f.pool.claimable(f.stranger.address)).to.equal(0n);
      expect(await f.pool.claimable(f.sponsor.address)).to.be.gt(0n);
      expect(await f.usd.balanceOf(f.stranger.address)).to.equal(before);
    });
    it("the trustee and the admin, with every pause and rotation they hold, take nothing: their stablecoin balances and credits stay zero-sum", async () => {
      const f = await loadFixture(pausedWithCreditFixture);
      const poolBalance = await f.usd.balanceOf(await f.pool.getAddress());
      await f.trigger.connect(f.admin).unpause();
      await f.trigger.connect(f.trustee).pause();
      await f.trigger.connect(f.admin).unpause();
      await f.trigger.connect(f.admin).setOracle(f.oracle2.address);
      await f.pool.grantRole(ethers.id("anything"), f.admin.address);
      for (const who of [f.admin, f.trustee, f.oracle, f.oracle2]) {
        expect(await f.pool.claimable(who.address)).to.equal(0n);
        await expect(f.pool.connect(who).claim()).to.be.revertedWithCustomError(f.pool, "NothingToClaim");
      }
      expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(poolBalance);
    });
    it("pause by itself moves no value: every pool, bond and stablecoin figure is identical across a pause and unpause", async () => {
      const f = await loadFixture(triggerFixture);
      const books = { pool: f.pool, usd: f.usd, bond: f.bond };
      const before = await fingerprint(books, accountsOf(f));
      await f.trigger.connect(f.trustee).pause();
      expect(await fingerprint(books, accountsOf(f))).to.equal(before);
      await f.trigger.connect(f.admin).unpause();
      expect(await fingerprint(books, accountsOf(f))).to.equal(before);
    });
  });

  describe("no Faultline code ever pauses the ATS bond", () => {
    it("IAtsBond has no pause, neither contract holds ROLE_PAUSER, the pool's bytecode has no pause() selector, and the trigger has no bond at all", async () => {
      const f = await loadFixture(triggerFixture);
      const iface = fs.readFileSync(path.join(ROOT, "contracts", "interfaces", "IAtsBond.sol"), "utf8");
      expect(iface).to.not.match(/function\s+(un)?pause\b/);
      expect(await f.bond.hasRole(ROLES.PAUSER, await f.pool.getAddress())).to.equal(false);
      expect(await f.bond.hasRole(ROLES.PAUSER, await f.trigger.getAddress())).to.equal(false);
      const pauseSelector = ethers.id("pause()").slice(2, 10);
      expect(await ethers.provider.getCode(await f.pool.getAddress())).to.not.include(pauseSelector);
      expect(fs.readFileSync(path.join(ROOT, "contracts", "FaultlineTrigger.sol"), "utf8")).to.not.include("IAtsBond");
    });
    it("no script, oracle or web module calls pause on a bond; the trigger's own pause is the only caller in the repo", async () => {
      const roots = ["scripts", "oracle/src", "web/src", "shared/ts"];
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(e.name)) files.push(p);
        }
      };
      for (const r of roots) walk(path.join(ROOT, r));
      expect(files.length).to.be.gt(20);
      for (const file of files) expect(fs.readFileSync(file, "utf8"), file).to.not.match(/bond[\w.]*\.(connect\([^)]*\)\.)?pause\(/i);
    });
    it("a full pause, veto, unpause and execute cycle leaves the bond unpaused at every step, and the pool's burn keeps working", async () => {
      const f = await loadFixture(triggerFixture);
      const check = async () => expect(await f.bond.paused()).to.equal(false);
      await submit(f, makeAtt(f));
      await f.trigger.connect(f.trustee).pause();
      await check();
      await f.trigger.connect(f.trustee).veto(EV_A);
      await check();
      await f.trigger.connect(f.admin).unpause();
      await check();
      await travelTo((await f.trigger.submissionDeadline()) + 1n);
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.bond, "ControllerRedemption");
      await check();
    });
  });
});
