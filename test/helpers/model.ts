// An independent model of FaultlinePool + FaultlineTrigger + the holder surface of MockBond, in plain bigint, for the stateful
// fuzz (test/invariants.fuzz.test.ts). Every method takes the block time of the transaction, returns the error the chain must
// revert with (null when it must succeed) and changes the model only on success. The contracts are not read here: a wrong
// guard order, a wrong rounding direction or a missing checkpoint shows up as a disagreement with the chain.
export const BPS = 10_000n;
const YEAR = 365n * 24n * 3600n;
const SCALE = 10n ** 18n;

export const Status = { None: 0, Pending: 1, Vetoed: 2, Executed: 3, Superseded: 4 } as const;

export type ModelConfig = {
  issuanceStart: bigint;
  issuanceEnd: bigint;
  riskStart: bigint;
  maturity: bigint;
  grace: bigint;
  couponBps: bigint;
  cap: bigint;
  minTicket: bigint;
  window: bigint;
};

export type Att = { eventId: string; lossBps: bigint; observedAt: bigint; usgsUpdatedAt: bigint; nonce: bigint };
export type EventState = { status: number; lossBps: bigint; nonce: bigint; usgsUpdatedAt: bigint; windowStart: bigint };
type Err = string | null;

export class Model {
  U = 0n;
  R = 0n;
  L = 0n;
  credited = 0n;
  reserve = 0n;
  index = 0n;
  last: bigint;
  principalPaid = 0n;
  couponPaid = 0n;
  totalClaimable = 0n;
  poolUsd = 0n;
  supply = 0n;
  paused = false;
  pauseStart = 0n;
  totalPaused = 0n;
  pending = 0n;
  /** Flows, counted apart from the pool's books. */
  burned = 0n;
  donated = 0n;
  claimedOut = 0n;
  claimable = new Map<string, bigint>();
  bond = new Map<string, bigint>();
  usd = new Map<string, bigint>();
  events = new Map<string, EventState>();

  constructor(readonly c: ModelConfig, readonly bondKyc: Set<string>, readonly sponsor: string) {
    this.last = c.riskStart;
  }

  private add(map: Map<string, bigint>, who: string, delta: bigint) {
    map.set(who, (map.get(who) ?? 0n) + delta);
  }
  units(who: string) {
    return this.bond.get(who) ?? 0n;
  }
  credit(who: string) {
    return this.claimable.get(who) ?? 0n;
  }
  money(who: string) {
    return this.usd.get(who) ?? 0n;
  }

  required(units: bigint) {
    const den = BPS * YEAR;
    return (units * this.c.couponBps * (this.c.maturity - this.c.riskStart) + den - 1n) / den;
  }
  deadline(t: bigint) {
    return this.c.maturity + this.c.grace + this.totalPaused + (this.paused ? t - this.pauseStart : 0n);
  }
  effective(t: bigint) {
    return (this.paused ? this.pauseStart : t) - this.totalPaused;
  }
  indexAt(at: bigint): [bigint, bigint] {
    const t = at < this.c.riskStart ? this.c.riskStart : at > this.c.maturity ? this.c.maturity : at;
    if (t <= this.last) return [this.index, this.last];
    return [this.index + ((BPS - this.L) * this.c.couponBps * (t - this.last) * SCALE) / (BPS * BPS * YEAR), t];
  }
  private accrue(t: bigint) {
    [this.index, this.last] = this.indexAt(t);
  }
  private creditTo(who: string, amount: bigint) {
    this.add(this.claimable, who, amount);
    this.totalClaimable += amount;
  }
  /** Principal and coupon owed for `units` at the index if accrual ran to maturity. */
  owedAtMaturity(units: bigint) {
    return (units * (BPS - this.L)) / BPS + (units * this.indexAt(this.c.maturity)[0]) / SCALE;
  }
  private surplus(reserved: bigint) {
    return this.poolUsd > reserved ? this.poolUsd - reserved : 0n;
  }
  private redemptionGate(t: bigint): Err {
    if (t <= this.deadline(t)) return "RedemptionNotOpen";
    return this.pending !== 0n ? "EventPending" : null;
  }
  private pull(from: string, amount: bigint): boolean {
    if (this.money(from) < amount) return false;
    this.add(this.usd, from, -amount);
    this.poolUsd += amount;
    return true;
  }

  fund(by: string, amount: bigint, t: bigint): Err {
    if (by !== this.sponsor) return "OnlySponsor";
    if (t >= this.c.issuanceEnd) return "IssuanceClosed";
    if (amount === 0n) return "ZeroAmount";
    if (!this.pull(by, amount)) return "EMPTY";
    this.reserve += amount;
    return null;
  }

  invest(who: string, units: bigint, t: bigint): Err {
    if (t < this.c.issuanceStart) return "IssuanceNotOpen";
    if (t >= this.c.issuanceEnd) return "IssuanceClosed";
    if (units < this.c.minTicket) return "BelowMinTicket";
    if (this.U + units > this.c.cap) return "CapExceeded";
    if (this.reserve < this.required(this.U + units)) return "CouponReserveInsufficient";
    if (this.supply > this.U - this.R) return "SupplyMismatch";
    if (this.money(who) < units) return "EMPTY";
    if (!this.bondKyc.has(who)) return "InvalidKycStatus";
    this.pull(who, units);
    this.U += units;
    this.add(this.bond, who, units);
    this.supply += units;
    return null;
  }

  transfer(from: string, to: string, units: bigint): Err {
    if (!this.bondKyc.has(from) || !this.bondKyc.has(to)) return "InvalidKycStatus";
    if (this.units(from) < units) return "InsufficientBalance";
    this.add(this.bond, from, -units);
    this.add(this.bond, to, units);
    return null;
  }

  burn(who: string, units: bigint): Err {
    if (!this.bondKyc.has(who)) return "InvalidKycStatus";
    if (this.units(who) === 0n) return "InvalidPartition";
    if (this.units(who) < units) return "InsufficientBalance";
    this.add(this.bond, who, -units);
    this.supply -= units;
    this.burned += units;
    return null;
  }

  submit(a: Att, t: bigint): Err {
    if (this.paused) return "IsPaused";
    if (t > this.deadline(t)) return "SubmissionClosed";
    if (a.observedAt < this.c.riskStart || a.observedAt > (t < this.c.maturity ? t : this.c.maturity)) return "ObservedOutsideRiskPeriod";
    if (a.lossBps === 0n || a.lossBps > BPS) return "LossOutOfRange";
    const e = this.events.get(a.eventId);
    const status = e?.status ?? Status.None;
    if (status === Status.Pending) {
      if (a.nonce <= e!.nonce || a.usgsUpdatedAt <= e!.usgsUpdatedAt) return "StaleRevision";
    } else if (status !== Status.None) return "EventFinalised";
    if (this.L >= BPS) return "FullyWrittenDown";
    if (status === Status.None) this.pending++;
    this.events.set(a.eventId, { status: Status.Pending, lossBps: a.lossBps, nonce: a.nonce, usgsUpdatedAt: a.usgsUpdatedAt, windowStart: this.effective(t) });
    return null;
  }

  veto(eventId: string, isTrustee: boolean, t: bigint): Err {
    if (!isTrustee) return "AccessControlUnauthorizedAccount";
    const e = this.events.get(eventId);
    if (e?.status !== Status.Pending) return "NotPending";
    if (this.effective(t) >= e.windowStart + this.c.window) return "WindowClosed";
    e.status = Status.Vetoed;
    this.pending--;
    return null;
  }

  execute(eventId: string, t: bigint): Err {
    if (this.paused) return "IsPaused";
    const e = this.events.get(eventId);
    if (e?.status !== Status.Pending) return "NotPending";
    if (this.effective(t) < e.windowStart + this.c.window) return "WindowOpen";
    this.pending--;
    if (this.L >= BPS) {
      e.status = Status.Superseded;
      return null;
    }
    e.status = Status.Executed;
    this.accrue(t);
    this.L = this.L + e.lossBps > BPS ? BPS : this.L + e.lossBps;
    const credited = (this.U * this.L) / BPS;
    this.creditTo(this.sponsor, credited - this.credited);
    this.credited = credited;
    return null;
  }

  pause(isTrustee: boolean, t: bigint): Err {
    if (!isTrustee) return "AccessControlUnauthorizedAccount";
    if (this.paused) return "IsPaused";
    this.paused = true;
    this.pauseStart = t;
    return null;
  }

  unpause(isAdmin: boolean, t: bigint): Err {
    if (!isAdmin) return "AccessControlUnauthorizedAccount";
    if (!this.paused) return "NotPaused";
    this.totalPaused += t - this.pauseStart;
    this.paused = false;
    return null;
  }

  redeem(who: string, t: bigint): Err {
    const gate = this.redemptionGate(t);
    if (gate) return gate;
    if (this.supply > this.U - this.R) return "SupplyMismatch";
    const units = this.units(who);
    if (units === 0n) return "NothingToRedeem";
    this.accrue(t);
    const principal = (units * (BPS - this.L)) / BPS;
    const coupon = (units * this.index) / SCALE;
    this.R += units;
    this.principalPaid += principal;
    this.couponPaid += coupon;
    this.creditTo(who, principal + coupon);
    this.bond.set(who, 0n);
    this.supply -= units;
    return null;
  }

  claim(who: string): Err {
    const amount = this.credit(who);
    if (amount === 0n) return "NothingToClaim";
    this.claimable.set(who, 0n);
    this.totalClaimable -= amount;
    this.poolUsd -= amount;
    this.add(this.usd, who, amount);
    this.claimedOut += amount;
    return null;
  }

  sweepExcess(t: bigint): Err {
    const gate = this.redemptionGate(t);
    if (gate) return gate;
    if (this.supply > this.U - this.R) return "SupplyMismatch";
    this.accrue(t);
    const out = this.U - this.R;
    const owed = (out * (BPS - this.L)) / BPS + (out * this.index) / SCALE;
    this.creditTo(this.sponsor, this.surplus(this.totalClaimable + owed));
    return null;
  }

  sweepDust(t: bigint): Err {
    const gate = this.redemptionGate(t);
    if (gate) return gate;
    if (this.supply !== 0n) return "SupplyNotZero";
    this.creditTo(this.sponsor, this.surplus(this.totalClaimable));
    return null;
  }

  donate(from: string, amount: bigint) {
    this.add(this.usd, from, -amount);
    this.poolUsd += amount;
    this.donated += amount;
  }
}
