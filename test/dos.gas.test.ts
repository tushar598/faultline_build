// Task 2F: DoS and gas on the D18 build. Mock-tested, on a local Hardhat chain with MockBond: real ATS and HTS cost more, and
// Hedera charges differently. The mined testnet numbers are in docs/TESTNET-EVIDENCE.md. So the gas figures here are
// ceilings against regressions, not predictions, and every O(1) claim compares two runs of the same build.
import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse } from "ethers";
import { USD } from "./helpers/fixtures";
import { fingerprint, trace } from "./helpers/state";
import { DAY, travelTo } from "./helpers/time";
import { A_UNITS, investedPoolFixture, loss, readyPoolFixture } from "./helpers/pool";
import { EV_A, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

const ROOT = path.join(__dirname, "..");
const HOLDERS = 60; // enough to show any per-holder cost; ceilings stay far below Hedera's 15M gas limit

const gasOf = async (tx: Promise<ContractTransactionResponse>) => (await (await tx).wait())!.gasUsed;
const traced = async (tx: Promise<ContractTransactionResponse>) => trace((await (await tx).wait())!.hash);

/** `investedPoolFixture` with one extra base unit moved to each of `n` funded, KYC'd wallets. */
async function spreadTo(f: Awaited<ReturnType<typeof investedPoolFixture>>, n: number) {
  const wallets = [];
  for (let i = 0; i < n; i++) {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await f.admin.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    await f.bond.grantKyc(w.address, "vc", 0, 2n ** 64n, f.admin.address);
    await f.bond.connect(f.investor).transfer(w.address, 1n);
    wallets.push(w);
  }
  return wallets;
}

async function spreadFixture() {
  const f = await investedPoolFixture();
  return { ...f, wallets: await spreadTo(f, HOLDERS) };
}

describe("DoS and gas (task 2F)", () => {
  describe("no loops, no arrays", () => {
    const sources = ["FaultlinePool.sol", "FaultlineTrigger.sol"].map((n) => fs.readFileSync(path.join(ROOT, "contracts", n), "utf8").replace(/\/\/.*$/gm, ""));
    it("neither contract has a for or while loop, or recursion through a loop keyword", () => {
      for (const s of sources) expect(s).to.not.match(/\b(for|while|do)\s*[({]/);
    });
    it("neither contract has a dynamic storage array: all per-account or per-event data sits in mappings", () => {
      for (const s of sources) {
        expect(s.match(/^\s+\w[\w.]*\[\]\s+(public|private|internal)/gm)).to.equal(null);
        expect(s).to.not.match(/\.push\(/);
      }
    });
  });

  describe("repeated invalid submissions", () => {
    /** Invalid `submit` calls, each sent through RawCaller so the rejection is mined and its gas measured. */
    async function rejected(f: Awaited<ReturnType<typeof triggerFixture>>, calldata: string) {
      const caller = await ethers.deployContract("RawCaller");
      const target = await f.trigger.getAddress();
      const first = await gasOf(caller.exec(target, calldata));
      expect(await caller.lastOk()).to.equal(false);
      let last = first;
      for (let i = 0; i < 30; i++) last = await gasOf(caller.exec(target, calldata));
      return { first, last };
    }
    it("thirty signatures from a stranger: every one is refused, state stays, cost stays flat", async () => {
      const f = await loadFixture(triggerFixture);
      const att = makeAtt(f);
      const sig = await sign(f.stranger, att, await f.trigger.getAddress());
      const accounts = [f.sponsor.address, f.investor.address];
      const before = await fingerprint(f, accounts, [EV_A]);
      const { first, last } = await rejected(f, f.trigger.interface.encodeFunctionData("submit", [att, sig]));
      expect(await fingerprint(f, accounts, [EV_A])).to.equal(before);
      expect(last).to.be.lte(first);
      expect(last).to.be.lt(60_000n); // far below a real submit: the signature check comes first
    });
    it("thirty replays of a valid signature after execution: EventFinalised every time, no record grows", async () => {
      const f = await loadFixture(triggerFixture);
      const att = makeAtt(f, { lossBps: 1_000n });
      const sig = await sign(f.oracle, att, await f.trigger.getAddress());
      await f.trigger.connect(f.relayer).submit(att, sig);
      await travelTo((await f.trigger.windowEndsAt(EV_A)) + 1n);
      await f.trigger.execute(EV_A);
      const before = await fingerprint(f, [f.sponsor.address], [EV_A]);
      const { first, last } = await rejected(f, f.trigger.interface.encodeFunctionData("submit", [att, sig]));
      expect(await fingerprint(f, [f.sponsor.address], [EV_A])).to.equal(before);
      expect(last).to.be.lte(first);
    });
    it("a flood of invalid calls does not delay honest work: a real event still goes through after it", async () => {
      const f = await loadFixture(triggerFixture);
      const att = makeAtt(f);
      await rejected(f, f.trigger.interface.encodeFunctionData("submit", [att, await sign(f.stranger, att, await f.trigger.getAddress())]));
      await expect(submit(f, att)).to.emit(f.trigger, "AttestationSubmitted");
    });
    it("sweepExcess spam: anyone can call it for ever, each repeat credits 0 and costs the same", async () => {
      const f = await loadFixture(investedPoolFixture);
      await travelTo(f.deadline + 1n);
      await f.pool.sweepExcess();
      const credited = await f.pool.claimable(f.sponsor.address);
      const costs = [];
      for (let i = 0; i < 20; i++) costs.push(await gasOf(f.pool.connect(f.stranger).sweepExcess()));
      expect(await f.pool.claimable(f.sponsor.address)).to.equal(credited);
      expect(new Set(costs.slice(1)).size).to.equal(1);
    });
  });

  describe("storage growth", () => {
    it("each event costs the same writes: event 2 and event 40 touch the same number of slots, and only an oracle signature can add one", async () => {
      const f = await loadFixture(triggerFixture);
      const add = async (i: number) => traced(submit(f, makeAtt(f, { eventId: ethers.id(`event-${i}`) })) as Promise<ContractTransactionResponse>);
      await add(1);
      const second = await add(2);
      for (let i = 3; i < 40; i++) await add(i);
      const fortieth = await add(40);
      expect(fortieth.slots).to.equal(second.slots);
      expect(fortieth.steps).to.equal(second.steps);
      expect(fortieth.slots).to.be.lte(5);
      expect(await f.trigger.pendingCount()).to.equal(40n);
    });
    it("forty pending events still execute one at a time at the same cost, and the count returns to zero", async () => {
      const f = await loadFixture(triggerFixture);
      for (let i = 0; i < 40; i++) await submit(f, makeAtt(f, { eventId: ethers.id(`event-${i}`), lossBps: 1n }));
      await travelTo((await f.trigger.windowEndsAt(ethers.id("event-39"))) + 1n);
      const costs = [];
      for (let i = 0; i < 40; i++) costs.push((await traced(f.trigger.execute(ethers.id(`event-${i}`)))).steps);
      expect(Math.max(...costs) - Math.min(...costs)).to.be.lte(300); // first-touch and mulDiv branch differences only
      expect(await f.trigger.pendingCount()).to.equal(0n);
      expect(await f.pool.appliedLossBps()).to.equal(40n);
    });
    it("a holder adds one claimable slot at most, however large the holder set", async () => {
      const f = await loadFixture(spreadFixture);
      await travelTo(f.deadline + 1n);
      const first = await traced(f.pool.connect(f.wallets[0]).redeem());
      const last = await traced(f.pool.connect(f.wallets[HOLDERS - 1]).redeem());
      expect(last.slots).to.equal(first.slots);
    });
  });

  describe("loss application is O(1)", () => {
    it("the same loss costs the identical opcode count with 2 holders and with 62", async () => {
      const base = await loadFixture(investedPoolFixture);
      const few = await traced(loss(base, 3_000));
      const many = await loadFixture(spreadFixture);
      const crowd = await traced(loss(many, 3_000));
      expect(crowd.steps).to.equal(few.steps);
      expect(crowd.sstores).to.equal(few.sstores);
      expect(crowd.loads).to.equal(few.loads);
    });
    it("no loss call reads a holder's balance: the steps do not change after every unit moved", async () => {
      const a = await loadFixture(investedPoolFixture);
      await a.bond.connect(a.investor).transfer(a.buyer.address, A_UNITS);
      const moved = await traced(loss(a, 2_500));
      const b = await loadFixture(investedPoolFixture);
      const still = await traced(loss(b, 2_500));
      expect(moved.steps).to.equal(still.steps);
    });
    it("the tenth loss costs no more than the second: nothing accumulates", async () => {
      const f = await loadFixture(investedPoolFixture);
      await loss(f, 100);
      await travelTo(f.s.riskStart + DAY);
      const second = await traced(loss(f, 200));
      let tenth = second;
      for (let i = 3; i <= 10; i++) {
        await travelTo(f.s.riskStart + BigInt(i) * DAY);
        tenth = await traced(loss(f, i * 100));
      }
      expect(tenth.steps).to.be.lte(second.steps + 100); // constant-size arithmetic, mulDiv branch noise only
      expect(tenth.slots).to.equal(second.slots);
    });
    it("redeem is O(1) in the holder count: holder 1 and holder 60 cost the same", async () => {
      const f = await loadFixture(spreadFixture);
      await travelTo(f.deadline + 1n);
      await f.pool.connect(f.wallets[0]).redeem();
      const a = await traced(f.pool.connect(f.wallets[1]).redeem());
      const b = await traced(f.pool.connect(f.wallets[HOLDERS - 1]).redeem());
      expect(b.steps).to.equal(a.steps);
    });
  });

  describe("gas ceilings for the main operations (mock bond and stablecoin)", () => {
    // Measured on this path + about 20 %, so a change that adds real work fails. First-write paths cost more; the report has the peaks.
    const CEILING = {
      fundCoupons: 90_000n,
      invest: 195_000n,
      submit: 165_000n,
      veto: 46_000n,
      execute: 172_000n,
      redeem: 200_000n,
      claim: 81_000n,
      sweepExcess: 78_000n,
      sweepDust: 61_000n,
    };
    it("a full lifecycle stays under every ceiling, and each figure is printed for the report", async () => {
      const used: Record<string, bigint> = {};
      const ready = await loadFixture(readyPoolFixture);
      used.fundCoupons = await gasOf(ready.pool.connect(ready.sponsor).fundCoupons(USD(1)));
      await travelTo(ready.s.issuanceStart);
      used.invest = await gasOf(ready.pool.connect(ready.investor).invest(USD(100)));
      const vetoed = await loadFixture(triggerFixture);
      await submit(vetoed, makeAtt(vetoed));
      used.veto = await gasOf(vetoed.trigger.connect(vetoed.trustee).veto(EV_A));
      const f = await loadFixture(triggerFixture);
      used.submit = await gasOf(submit(f, makeAtt(f)) as Promise<ContractTransactionResponse>);
      await travelTo((await f.trigger.windowEndsAt(EV_A)) + 1n);
      used.execute = await gasOf(f.trigger.execute(EV_A));
      await travelTo((await f.trigger.submissionDeadline()) + 1n);
      used.redeem = await gasOf(f.pool.connect(f.investor).redeem());
      used.claim = await gasOf(f.pool.connect(f.investor).claim());
      used.sweepExcess = await gasOf(f.pool.sweepExcess());
      await f.pool.connect(f.investor2).redeem();
      used.sweepDust = await gasOf(f.pool.sweepDust());
      console.log(`      gas (mocks): ${Object.entries(used).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      for (const [k, max] of Object.entries(CEILING)) expect(used[k], k).to.be.lte(max);
      for (const v of Object.values(used)) expect(v).to.be.lt(15_000_000n); // Hedera's per-transaction limit
    });
  });
});
