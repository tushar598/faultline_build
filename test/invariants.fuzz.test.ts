// Task 3 (RT-06): financial invariants under random operation sequences. Real FaultlinePool and FaultlineTrigger on a local
// Hardhat chain with MockBond, MockUSD and MockHTS: mock-tested, and real ATS and HTS are not in the loop. Every operation is first
// predicted by an independent bigint model (test/helpers/model.ts), then sent as a mined transaction with an exact block time,
// so a revert costs a block as it would on a chain. After every step the chain must equal the model field by field.
// The numbers in the test titles are the invariants of docs/SECURITY-TEST-REPORT.md "Financial invariants".
//   FC_RUNS (sequences), FC_OPS (operations per phase), FC_SEED (replay). The seed is printed before each property runs.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import fc from "fast-check";
import type { ContractTransactionReceipt, ContractTransactionResponse } from "ethers";
import { USD, onboardUsd } from "./helpers/fixtures";
import { BPS, Model, Status, type Att } from "./helpers/model";
import { DAY } from "./helpers/time";
import { COUPON_BPS, CAP, MIN_TICKET, deployPoolFixture, wirePool } from "./helpers/pool";
import { TERMS, WINDOW, sign } from "./helpers/trigger";

const FC_RUNS = Number(process.env.FC_RUNS ?? 8);
const FC_OPS = Number(process.env.FC_OPS ?? 14);
const SPLITS = FC_RUNS * 500;
const seedOf = (name: string) => {
  const seed = Number(process.env.FC_SEED ?? Date.now() & 0x7fffffff);
  console.log(`      ${name}: fast-check seed ${seed}, runs ${FC_RUNS}, ops per phase up to ${FC_OPS} (FC_SEED, FC_RUNS, FC_OPS)`);
  return seed;
};

async function fuzzFixture() {
  const f = await deployPoolFixture();
  const signers = await ethers.getSigners();
  const [oracle, trustee, relayer] = [signers[7], signers[8], signers[10]];
  const trigger = await ethers.deployContract("FaultlineTrigger", [await f.pool.getAddress(), TERMS, WINDOW, oracle.address, f.admin.address, trustee.address]);
  await wirePool(f, await trigger.getAddress());
  await onboardUsd(f.usd, f.other, USD(5_000));
  await f.usd.connect(f.other).approve(await f.pool.getAddress(), ethers.MaxUint256);
  await f.bond.grantKyc(f.other.address, "vc", 0, 2n ** 64n, f.admin.address);
  return { ...f, trigger, oracle, trustee, relayer };
}
type World = Awaited<ReturnType<typeof fuzzFixture>>;

/** Two holders subscribed, one day into the risk period. A fixture of its own: chain time follows the wall clock between tests. */
async function subscribedFixture() {
  const w = await fuzzFixture();
  await w.pool.connect(w.sponsor).fundCoupons(await w.pool.requiredReserve(CAP));
  await time.increaseTo(w.s.issuanceStart);
  await w.pool.connect(w.investor).invest(USD(1_234) + 567n);
  await w.pool.connect(w.investor2).invest(USD(2_000) + 1n);
  await time.increaseTo(w.s.riskStart + DAY);
  return w;
}

// ---------------------------------------------------------------- operations

const EVENT_IDS = ["e0", "e1", "e2", "e3"].map((x) => ethers.id(`fuzz:${x}`));
const Investor = fc.integer({ min: 0, max: 3 });
const Actor = fc.integer({ min: 0, max: 4 }); // 4 is `stranger`: stablecoin KYC, no bond KYC
const Pct = fc.oneof(fc.constantFrom(0, 1, 50, 100), fc.integer({ min: 0, max: 100 }));
const LossArb = fc.oneof(fc.constantFrom(0n, 1n, 9_999n, 10_000n, 10_000n, 10_001n), fc.bigInt({ min: 1n, max: 10_000n }));
const Amount = fc.oneof(fc.constantFrom(0n, 1n, MIN_TICKET - 1n, MIN_TICKET), fc.bigInt({ min: MIN_TICKET, max: USD(4_000) }));
const Dt = fc.oneof(fc.bigInt({ min: 1n, max: 3_600n }), fc.constantFrom(WINDOW - 1n, WINDOW, WINDOW + 1n, DAY, 40n * DAY));

const Op = fc.oneof(
  { weight: 3, arbitrary: fc.record({ k: fc.constant("warp"), dt: Dt }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant("invest"), who: Actor, units: Amount }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("fund"), byStranger: fc.boolean(), amount: fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: USD(300) })) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("transfer"), from: Actor, to: Actor, pct: Pct, extra: fc.constantFrom(0n, 0n, 1n) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("burn"), who: Actor, pct: Pct, extra: fc.constantFrom(0n, 0n, 1n) }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant("submit"), ev: fc.nat(3), lossBps: LossArb, back: fc.bigInt({ min: 0n, max: 2n * DAY }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("replay"), ev: fc.nat(3) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("veto"), ev: fc.nat(3), byStranger: fc.constantFrom(false, false, false, true) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("execute"), ev: fc.nat(3) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("edge"), ev: fc.nat(3), act: fc.constantFrom("veto", "execute"), d: fc.constantFrom(-2n, -1n, 0n) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("pauseCycle"), ev: fc.nat(3), dt: fc.bigInt({ min: 1n, max: 2n * WINDOW }), act: fc.constantFrom("veto", "execute"), d: fc.constantFrom(-2n, -1n, 0n) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("pause"), byStranger: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("unpause"), byStranger: fc.boolean() }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("redeem"), who: Actor }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("claim"), who: fc.integer({ min: 0, max: 5 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("sweepExcess") }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("sweepDust") }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("donate"), amount: fc.bigInt({ min: 1n, max: USD(5) }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("forgeLoss"), bps: fc.integer({ min: 0, max: 10_001 }) }) },
);
type Op = { k: string } & Record<string, never | unknown>;

const Sequence = fc.record({
  // Most runs fund the reserve in full so subscriptions land; some leave it short to reach CouponReserveInsufficient.
  initialFund: fc.oneof({ weight: 5, arbitrary: fc.constant(USD(800)) }, { weight: 1, arbitrary: fc.bigInt({ min: 0n, max: USD(400) }) }),
  subscriptions: fc.array(fc.record({ who: Investor, units: fc.bigInt({ min: MIN_TICKET, max: USD(2_400) }) }), { minLength: 2, maxLength: 5 }),
  before: fc.array(Op, { maxLength: 3 }),
  issuance: fc.array(Op, { maxLength: FC_OPS }),
  risk: fc.array(Op, { maxLength: FC_OPS }),
  grace: fc.array(Op, { maxLength: FC_OPS }),
  after: fc.array(Op, { maxLength: FC_OPS }),
});

// ---------------------------------------------------------------- one run

class Run {
  m: Model;
  t: bigint;
  actors: World["investor"][];
  last = new Map<number, Att & { sig: string; magnitudeX100: bigint; termsHash: string; dataHash: string; deadline: bigint }>();
  statuses = new Map<string, number>();
  maxL = 0n;
  reverted = 0;
  succeeded = new Map<string, number>();
  errors = new Set<string>();
  fp = "";
  fromBlock = 0;

  constructor(readonly w: World, now: bigint) {
    const { s } = w;
    this.t = now;
    this.actors = [w.investor, w.investor2, w.buyer, w.other, w.stranger, w.sponsor];
    this.m = new Model(
      { ...s, couponBps: COUPON_BPS, cap: CAP, minTicket: MIN_TICKET, window: WINDOW },
      new Set([w.investor, w.investor2, w.buyer, w.other].map((a) => a.address)),
      w.sponsor.address,
    );
  }

  addr(i: number) {
    return this.actors[i].address;
  }

  async init() {
    for (const a of [...this.actors, this.w.admin]) this.m.usd.set(a.address, await this.w.usd.balanceOf(a.address));
    this.fromBlock = await ethers.provider.getBlockNumber();
    this.fp = await this.fingerprint();
  }

  /** Mines `tx` at the next second and compares its outcome with the model's prediction. */
  async send(label: string, expected: () => string | null, tx: () => Promise<ContractTransactionResponse>): Promise<ContractTransactionReceipt | undefined> {
    this.t += 1n;
    await time.setNextBlockTimestamp(this.t);
    const before = this.fp;
    const want = expected();
    let got: string | null = null;
    let receipt: ContractTransactionReceipt | undefined;
    try {
      receipt = (await (await tx()).wait()) ?? undefined;
    } catch (e) {
      const m = String((e as Error).message);
      got = /custom error '(\w+)\(/.exec(m)?.[1] ?? (/without a reason/.test(m) ? "EMPTY" : null);
      if (!got) throw e;
    }
    expect(got, `${label}: chain vs model at t=${this.t}`).to.equal(want);
    this.fp = await this.fingerprint();
    if (got) {
      this.reverted++;
      this.errors.add(got);
      expect(this.fp, `invariant 11: ${label} reverted ${got} and left state behind`).to.equal(before);
    } else this.succeeded.set(label, (this.succeeded.get(label) ?? 0) + 1);
    await this.checkInvariants(label);
    return receipt;
  }

  async warpTo(target: bigint) {
    if (target <= this.t) return;
    this.t = target;
    await time.increaseTo(target);
  }

  /** Every stored value that must survive a revert, and that the model must equal. */
  async chain() {
    const { pool, usd, bond, trigger } = this.w;
    const poolAddr = await pool.getAddress();
    const accounts = [...this.actors, this.w.admin].map((a) => a.address);
    const [U, R, L, credited, reserve, index, last, principalPaid, couponPaid, totalClaimable, poolUsd, supply, paused, pauseStart, totalPaused, pending] = await Promise.all([
      pool.unitsIssued(), pool.unitsRedeemed(), pool.appliedLossBps(), pool.sponsorCredited(), pool.couponReserve(), pool.couponIndex(), pool.lastAccrual(), pool.principalPaid(), pool.couponPaid(),
      pool.totalClaimable(), usd.balanceOf(poolAddr), bond.totalSupply(), trigger.paused(), trigger.pauseStart(), trigger.totalPausedSeconds(), trigger.pendingCount(),
    ]);
    const perAccount = await Promise.all(accounts.map(async (a) => ({ a, claimable: await pool.claimable(a), units: await bond.balanceOf(a), usd: await usd.balanceOf(a) })));
    const records = await Promise.all(
      EVENT_IDS.map(async (id) => {
        const r = await trigger.getEventRecord(id);
        return { id, status: r.status, lossBps: r.lossBps, nonce: r.nonce, usgsUpdatedAt: r.usgsUpdatedAt, windowStart: r.windowStart, observedAt: r.observedAt, dataHash: r.dataHash };
      }),
    );
    return { U, R, L: BigInt(L), credited, reserve, index, last: BigInt(last), principalPaid, couponPaid, totalClaimable, poolUsd, supply, paused, pauseStart, totalPaused, pending, perAccount, records };
  }

  async fingerprint() {
    return JSON.stringify(await this.chain(), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }

  async checkInvariants(label: string) {
    const { m } = this;
    const c = await this.chain();
    const eq = (a: unknown, b: unknown, what: string) => expect(a, `${what} after ${label}`).to.equal(b);
    for (const k of ["U", "R", "L", "credited", "reserve", "index", "last", "principalPaid", "couponPaid", "totalClaimable", "poolUsd", "supply", "paused", "totalPaused", "pending"] as const) eq(c[k], m[k], `chain vs model: ${k}`);

    // 1. supply <= issued - redeemed, == when nobody burned
    expect(c.supply <= c.U - c.R, `invariant 1 after ${label}`).to.equal(true);
    eq(c.U - c.R - c.supply, m.burned, "invariant 1: the gap is exactly what holders burned");
    // 2. L never exceeds 10,000, and never falls
    expect(c.L <= BPS && c.L >= this.maxL, `invariant 2 after ${label}`).to.equal(true);
    this.maxL = c.L;

    // 3 and 13: status moves only None -> Pending -> terminal; terminal never changes; L is the capped sum of Executed losses
    let executed = 0n;
    let pending = 0n;
    for (const r of c.records) {
      const before = this.statuses.get(r.id as string) ?? Status.None;
      const now = Number(r.status);
      const legal = now === before || (before === Status.None && now === Status.Pending) || (before === Status.Pending && now > Status.Pending);
      expect(legal, `invariant 13: status ${before} -> ${now} after ${label}`).to.equal(true);
      this.statuses.set(r.id as string, now);
      eq(now, m.events.get(r.id as string)?.status ?? Status.None, "chain vs model: status");
      if (now === Status.Executed) executed += BigInt(r.lossBps);
      if (now === Status.Pending) pending++;
    }
    eq(c.L, executed > BPS ? BPS : executed, "invariant 3: L is the capped sum of executed losses");
    eq(c.pending, pending, "pendingCount == number of Pending events");

    // 5. the aggregate never exceeds the pool's allocation
    const allocation = (c.U * (BPS - c.L)) / BPS;
    expect(c.principalPaid <= allocation, `invariant 5: principal ${c.principalPaid} above ${allocation} after ${label}`).to.equal(true);
    expect(c.couponPaid <= m.required(c.U) && c.couponPaid <= c.reserve, `invariant 5: coupon after ${label}`).to.equal(true);

    // 6 and 12: token balances agree with internal accounting
    eq(c.poolUsd, m.reserve + (c.U * 1n) + m.donated - m.claimedOut, "invariant 6: pool balance == deposits + reserve + stray - claims");
    let sum = 0n;
    let floors = 0n;
    for (const p of c.perAccount) {
      eq(p.claimable, m.credit(p.a), "chain vs model: claimable");
      eq(p.units, m.units(p.a), "chain vs model: bond balance");
      eq(p.usd, m.money(p.a), "chain vs model: stablecoin balance");
      sum += p.claimable;
      floors += (p.units * (BPS - c.L)) / BPS;
    }
    eq(sum, c.totalClaimable, "invariant 12: totalClaimable == sum of claimable");

    // 7. no sweep ever removes what is still owed
    const out = c.U - c.R < c.supply ? c.U - c.R : c.supply;
    expect(c.poolUsd >= c.totalClaimable + m.owedAtMaturity(out), `invariant 7: solvency after ${label}`).to.equal(true);
    eq(await this.w.pool.isSolvent(), true, "invariant 7: isSolvent()");

    // 10. sponsor credit plus every floored redemption, past and future, never exceeds the units issued
    expect(c.credited + c.principalPaid + floors <= c.U, `invariant 10 after ${label}`).to.equal(true);
  }

  async step(op: Op): Promise<unknown> {
    const { m, w } = this;
    const at = () => this.t;
    const gas = { gasLimit: 1_500_000 };
    switch (op.k) {
      case "warp":
        return this.warpTo(this.t + (op.dt as bigint));
      case "invest": {
        const a = this.actors[op.who as number];
        const units = op.units as bigint;
        return this.send("invest", () => m.invest(a.address, units, at()), () => w.pool.connect(a).invest(units, gas));
      }
      case "fund": {
        const a = op.byStranger ? w.stranger : w.sponsor;
        const amount = op.amount as bigint;
        return this.send("fund", () => m.fund(a.address, amount, at()), () => w.pool.connect(a).fundCoupons(amount, gas));
      }
      case "transfer": {
        const [from, to] = [this.actors[op.from as number], this.actors[op.to as number]];
        const units = (m.units(from.address) * BigInt(op.pct as number)) / 100n + (op.extra as bigint);
        return this.send("transfer", () => m.transfer(from.address, to.address, units), () => w.bond.connect(from).transfer(to.address, units, gas));
      }
      case "burn": {
        const a = this.actors[op.who as number];
        const units = (m.units(a.address) * BigInt(op.pct as number)) / 100n + (op.extra as bigint);
        return this.send("burn", () => m.burn(a.address, units), () => w.bond.connect(a).redeem(units, "0x", gas));
      }
      case "submit": {
        const ev = op.ev as number;
        const id = EVENT_IDS[ev];
        const e = m.events.get(id);
        const upper = this.t + 1n < w.s.maturity ? this.t + 1n : w.s.maturity;
        const back = op.back as bigint;
        const att = {
          eventId: id, lossBps: op.lossBps as bigint, magnitudeX100: 720n, observedAt: upper > back ? upper - back : 0n, usgsUpdatedAt: (e?.usgsUpdatedAt ?? 0n) + 1n, nonce: (e?.nonce ?? 0n) + 1n,
          termsHash: TERMS, dataHash: ethers.id(`record:${ev}`), deadline: 2n ** 63n,
        };
        const sig = await sign(w.oracle, att, await w.trigger.getAddress());
        const r = await this.send("submit", () => m.submit(att, at()), () => w.trigger.connect(w.relayer).submit(att, sig, gas));
        if (r) this.last.set(ev, { ...att, sig });
        return undefined;
      }
      case "replay": {
        const saved = this.last.get(op.ev as number);
        if (!saved) return undefined;
        const { sig, ...att } = saved;
        return this.send("replay", () => m.submit(att, at()), () => w.trigger.connect(w.stranger).submit(att, sig, gas));
      }
      case "veto": {
        const by = op.byStranger ? w.stranger : w.trustee;
        const id = EVENT_IDS[op.ev as number];
        const r = await this.send("veto", () => m.veto(id, !op.byStranger, at()), () => w.trigger.connect(by).veto(id, gas));
        if (r) await this.step({ k: "replay", ev: op.ev } as unknown as Op); // 3. a vetoed signature stays dead
        return undefined;
      }
      case "execute": {
        const id = EVENT_IDS[op.ev as number];
        const r = await this.send("execute", () => m.execute(id, at()), () => w.trigger.connect(w.stranger).execute(id, gas));
        // 3. a finalised event cannot apply twice, by execute or by a replay of its signature
        if (r) {
          await this.send("execute twice", () => m.execute(id, at()), () => w.trigger.connect(w.stranger).execute(id, gas));
          await this.step({ k: "replay", ev: op.ev } as unknown as Op);
        }
        return undefined;
      }
      case "edge": {
        // The second before, at and after the window's end: `warpTo` mines, so the action lands one second later.
        const e = m.events.get(EVENT_IDS[op.ev as number]);
        if (e?.status !== Status.Pending || m.paused) return undefined;
        await this.warpTo(e.windowStart + WINDOW + m.totalPaused + (op.d as bigint));
        return this.step({ k: op.act as string, ev: op.ev, byStranger: false } as unknown as Op);
      }
      case "pauseCycle": {
        // A pause in the middle of a pending event's window, then an action at the edge the pause must have moved.
        if (m.paused || m.events.get(EVENT_IDS[op.ev as number])?.status !== Status.Pending) return undefined;
        await this.step({ k: "pause", byStranger: false } as unknown as Op);
        await this.warpTo(this.t + (op.dt as bigint));
        await this.step({ k: "unpause", byStranger: false } as unknown as Op);
        return this.step({ k: "edge", ev: op.ev, act: op.act, d: op.d } as unknown as Op);
      }
      case "pause": {
        const by = op.byStranger ? w.stranger : w.trustee;
        return this.send("pause", () => m.pause(!op.byStranger, at()), () => w.trigger.connect(by).pause(gas));
      }
      case "unpause": {
        const by = op.byStranger ? w.stranger : w.admin;
        return this.send("unpause", () => m.unpause(!op.byStranger, at()), () => w.trigger.connect(by).unpause(gas));
      }
      case "redeem": {
        const a = this.actors[op.who as number];
        const r = await this.send("redeem", () => m.redeem(a.address, at()), () => w.pool.connect(a).redeem(gas));
        // 5. a holder cannot redeem twice
        if (r) await this.send("redeem twice", () => m.redeem(a.address, at()), () => w.pool.connect(a).redeem(gas));
        return undefined;
      }
      case "claim": {
        const a = this.actors[op.who as number];
        const r = await this.send("claim", () => m.claim(a.address), () => w.pool.connect(a).claim(gas));
        // 4. a claim cannot be consumed twice
        if (r) await this.send("claim twice", () => m.claim(a.address), () => w.pool.connect(a).claim(gas));
        return undefined;
      }
      case "sweepExcess":
      case "sweepDust": {
        const name = op.k as "sweepExcess" | "sweepDust";
        const r = await this.send(name, () => m[name](at()), () => w.pool.connect(w.stranger)[name](gas));
        if (r) {
          // 7. residue cannot be taken twice: the repeat credits exactly 0
          const before = m.credit(w.sponsor.address);
          await this.send(`${name} twice`, () => m[name](at()), () => w.pool.connect(w.stranger)[name](gas));
          expect(m.credit(w.sponsor.address), `invariant 7: ${name} twice`).to.equal(before);
        }
        return undefined;
      }
      case "donate": {
        const amount = op.amount as bigint;
        return this.send("donate", () => (m.donate(w.admin.address, amount), null), () => w.usd.transfer(w.pool.getAddress(), amount, gas) as Promise<ContractTransactionResponse>);
      }
      case "forgeLoss": {
        return this.send("forgeLoss", () => "OnlyTrigger", () => w.pool.connect(w.stranger).applyLoss(op.bps as number, gas));
      }
      default:
        throw new Error(`unknown op ${op.k}`);
    }
  }

  /** Clears what blocks settlement, then everyone leaves. Every obligation must still be payable (invariants 5, 7, 8). */
  async settle() {
    const { m, w } = this;
    const gas = { gasLimit: 1_500_000 };
    const at = () => this.t;
    if (m.paused) await this.send("unpause", () => m.unpause(true, at()), () => w.trigger.connect(w.admin).unpause(gas));
    for (const id of EVENT_IDS) {
      const e = m.events.get(id);
      if (e?.status !== Status.Pending) continue;
      await this.warpTo(e.windowStart + WINDOW + m.totalPaused);
      await this.send("execute", () => m.execute(id, at()), () => w.trigger.execute(id, gas));
    }
    // The exact edge of the deadline: closed at D, open at D + 1, and sweepDust refuses while units are outstanding.
    await this.warpTo(m.deadline(this.t) - 1n);
    const holder = this.actors.slice(0, 4).find((a) => m.units(a.address) > 0n);
    if (holder) await this.send("redeem at the edge", () => m.redeem(holder.address, at()), () => w.pool.connect(holder).redeem(gas));
    if (m.supply > 0n) await this.send("sweepDust at the edge", () => m.sweepDust(at()), () => w.pool.sweepDust(gas));
    await this.warpTo(m.deadline(this.t) + 1n);
    const finalL = m.L;
    for (let i = 0; i < 4; i++) {
      const a = this.actors[i];
      const units = m.units(a.address);
      if (units === 0n) continue;
      const index = m.indexAt(this.t + 1n)[0];
      const before = m.credit(a.address);
      await this.send("redeem", () => m.redeem(a.address, at()), () => w.pool.connect(a).redeem(gas));
      // 5 and 8: each holder gets exactly its proportional floor, whatever the others did
      expect(m.credit(a.address) - before, "invariants 5 and 8: redemption entitlement").to.equal((units * (BPS - finalL)) / BPS + (units * index) / 10n ** 18n);
    }
    await this.send("sweepExcess", () => m.sweepExcess(at()), () => w.pool.sweepExcess(gas));
    for (let i = 0; i < 4; i++) {
      const a = this.actors[i];
      if (m.credit(a.address) > 0n) await this.send("claim", () => m.claim(a.address), () => w.pool.connect(a).claim(gas));
    }
    await this.send("sweepDust", () => m.sweepDust(at()), () => w.pool.sweepDust(gas));
    if (m.credit(w.sponsor.address) > 0n) await this.send("claim", () => m.claim(w.sponsor.address), () => w.pool.connect(w.sponsor).claim(gas));
    const c = await this.chain();
    expect(c.supply, "settlement: supply").to.equal(0n);
    expect(c.poolUsd, "settlement: invariant 6, the pool ends at exactly zero").to.equal(0n);
    expect(c.totalClaimable, "settlement: nothing left to claim").to.equal(0n);
    expect(m.claimedOut, "invariant 6: paid out == everything that came in").to.equal(c.U + c.reserve + m.donated);
  }

  /** 12. the event log alone rebuilds the stored books. */
  async reconcileLogs() {
    const { pool, trigger } = this.w;
    const c = await this.chain();
    const from = this.fromBlock + 1;
    const logs = async (e: unknown) => (await pool.queryFilter(e as never, from)) as unknown as { args: Record<string, bigint> }[];
    const total = (rows: { args: Record<string, bigint> }[], f: string) => rows.reduce((x, r) => x + r.args[f], 0n);
    const [invested, funded, applied, redeemed, claimed, excess, dust] = await Promise.all([
      logs(pool.filters.Invested), logs(pool.filters.CouponsFunded), logs(pool.filters.LossApplied), logs(pool.filters.Redeemed), logs(pool.filters.Claimed), logs(pool.filters.ExcessSwept), logs(pool.filters.DustSwept),
    ]);
    expect(total(invested, "units"), "invariant 12: Invested logs == unitsIssued").to.equal(c.U);
    expect(total(funded, "amount"), "invariant 12: CouponsFunded logs == couponReserve").to.equal(c.reserve);
    expect(total(applied, "sponsorCredit"), "invariant 12: LossApplied logs == sponsorCredited").to.equal(c.credited);
    expect(applied.length === 0 ? 0n : BigInt(applied[applied.length - 1].args.newBps), "invariant 12: last LossApplied == L").to.equal(c.L);
    expect(total(redeemed, "units"), "invariant 12: Redeemed logs == unitsRedeemed").to.equal(c.R);
    expect(total(redeemed, "principal"), "invariant 12: Redeemed logs == principalPaid").to.equal(c.principalPaid);
    expect(total(redeemed, "coupon"), "invariant 12: Redeemed logs == couponPaid").to.equal(c.couponPaid);
    expect(total(claimed, "amount"), "invariant 12: Claimed logs == claims paid").to.equal(this.m.claimedOut);
    expect(c.credited + total(excess, "amount") + total(dust, "amount") + c.principalPaid + c.couponPaid, "invariant 12: credits in logs == claims paid").to.equal(this.m.claimedOut);
    const count = async (e: unknown) => (await trigger.queryFilter(e as never, from)).length;
    const statuses = [...this.statuses.values()];
    expect(await count(trigger.filters.EventExecuted), "invariant 12: EventExecuted logs").to.equal(statuses.filter((s) => s === Status.Executed).length);
    expect(await count(trigger.filters.EventVetoed), "invariant 12: EventVetoed logs").to.equal(statuses.filter((s) => s === Status.Vetoed).length);
    expect(await count(trigger.filters.EventSuperseded), "invariant 12: EventSuperseded logs").to.equal(statuses.filter((s) => s === Status.Superseded).length);
  }
}

// ---------------------------------------------------------------- properties

describe("Financial invariants under random sequences (task 3, RT-06, mock-tested)", () => {
  it("invariants 1 to 8 and 10 to 13: random sequences of several investors, amounts, losses, events, burns, pauses and sweeps, across every phase, then full settlement", async function () {
    this.timeout(0);
    const seed = seedOf("sequences");
    const w = await loadFixture(fuzzFixture);
    let snapshot: string = await ethers.provider.send("evm_snapshot", []);
    const tally = { runs: 0, ops: 0, reverted: 0, burned: 0, swept: 0, errors: new Set<string>(), labels: new Map<string, number>(), statuses: new Set<number>(), finalLoss: new Set<bigint>() };
    await fc.assert(
      fc.asyncProperty(Sequence, async (seq) => {
        await ethers.provider.send("evm_revert", [snapshot]);
        snapshot = await ethers.provider.send("evm_snapshot", []);
        const run = new Run(w, BigInt(await time.latest()));
        await run.init();
        if (seq.initialFund > 0n) await run.step({ k: "fund", byStranger: false, amount: seq.initialFund } as unknown as Op);
        const phases = [
          { ops: seq.before, start: run.t },
          { ops: [...seq.subscriptions.map((x) => ({ k: "invest", ...x })), ...seq.issuance], start: w.s.issuanceStart },
          { ops: seq.risk, start: w.s.riskStart },
          { ops: seq.grace, start: w.s.maturity - DAY },
          { ops: seq.after, start: w.deadline - WINDOW },
        ];
        for (const { ops, start } of phases) {
          await run.warpTo(start);
          for (const op of ops as Op[]) await run.step(op);
        }
        await run.settle();
        await run.reconcileLogs();
        tally.runs++;
        tally.reverted += run.reverted;
        tally.burned += run.m.burned > 0n ? 1 : 0;
        tally.finalLoss.add(run.m.L);
        for (const [k, n] of run.succeeded) {
          tally.labels.set(k, (tally.labels.get(k) ?? 0) + n);
          tally.ops += n;
        }
        tally.ops += run.reverted;
        for (const e of run.errors) tally.errors.add(e);
        for (const s of run.statuses.values()) tally.statuses.add(s);
      }),
      { numRuns: FC_RUNS, seed, endOnFailure: process.env.FC_SHRINK !== "1" },
    );
    await ethers.provider.send("evm_revert", [snapshot]);
    console.log(`      sequences ${tally.runs}, transactions ${tally.ops} (${tally.reverted} reverted, each compared with the model), runs with a holder burn ${tally.burned}`);
    console.log(`      successes: ${[...tally.labels].sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
    console.log(`      revert reasons seen: ${[...tally.errors].sort().join(", ")}`);
    console.log(`      final statuses seen: ${[...tally.statuses].sort().join(", ")}; distinct final L: ${tally.finalLoss.size}`);
    expect(tally.runs).to.equal(FC_RUNS);
  });

  it("invariant 9: two events in either order give the same final loss and sponsor credit; so do three in any order", async function () {
    this.timeout(0);
    const seed = seedOf("event order");
    const w = await loadFixture(subscribedFixture);
    const oneRun = async (losses: bigint[], order: number[]) => {
      const atts = [];
      for (let i = 0; i < losses.length; i++) {
        const id = EVENT_IDS[i];
        const att = { eventId: id, lossBps: losses[i], magnitudeX100: 720n, observedAt: w.s.riskStart, usgsUpdatedAt: w.s.riskStart + 1n, nonce: 1n, termsHash: TERMS, dataHash: ethers.ZeroHash, deadline: 2n ** 63n };
        await w.trigger.connect(w.relayer).submit(att, await sign(w.oracle, att, await w.trigger.getAddress()));
        atts.push(id);
      }
      await time.increase(WINDOW);
      for (const i of order) await w.trigger.execute(atts[i]);
      return { L: await w.pool.appliedLossBps(), credited: await w.pool.sponsorCredited(), claimable: await w.pool.claimable(w.sponsor.address), pending: await w.trigger.pendingCount() };
    };
    const base: string = await ethers.provider.send("evm_snapshot", []);
    let snapshot = base;
    const restore = async () => {
      await ethers.provider.send("evm_revert", [snapshot]);
      snapshot = await ethers.provider.send("evm_snapshot", []);
    };
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    await fc.assert(
      fc.asyncProperty(fc.array(LossArb.filter((x) => x >= 1n && x <= BPS), { minLength: 2, maxLength: 3 }), async (losses) => {
        const results = [];
        for (const order of losses.length === 2 ? [[0, 1], [1, 0]] : orders) {
          await restore();
          results.push(await oneRun(losses, order));
        }
        const sum = losses.reduce((a, b) => a + b, 0n);
        const expectedL = sum > BPS ? BPS : sum;
        const U = USD(3_234) + 568n;
        for (const r of results) {
          expect(r.L, "invariant 9: final loss").to.equal(expectedL);
          expect(r.credited, "invariant 9: sponsor credit").to.equal((U * expectedL) / BPS);
          expect(r.claimable, "invariant 9: claimable").to.equal(r.credited);
          expect(r.pending).to.equal(0n);
        }
      }),
      { numRuns: Math.max(FC_RUNS * 4, 25), seed },
    );
    await ethers.provider.send("evm_revert", [snapshot]);
  });

  it("invariant 10 (maths, off-chain, FC_RUNS x 500 splits): sponsor credit plus the sum of per-holder floors never exceeds the units, and the gap is below one unit per holder", () => {
    const seed = seedOf("floors");
    const fits = (holders: bigint[], L: bigint) => {
      const U = holders.reduce((a, b) => a + b, 0n);
      const floors = holders.reduce((a, b) => a + (b * (BPS - L)) / BPS, 0n);
      const credit = (U * L) / BPS;
      return credit + floors <= U && U - credit - floors <= BigInt(holders.length);
    };
    fc.assert(fc.property(fc.array(fc.bigInt({ min: 1n, max: 10n ** 15n }), { minLength: 1, maxLength: 64 }), fc.bigInt({ min: 0n, max: BPS }), fits), { numRuns: SPLITS, seed });
  });
});
