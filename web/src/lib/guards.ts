// Why an action is disabled, in plain words, from the last snapshot (the same rules as the contracts, ARCHITECTURE
// §3.3 and §4.3). The UI also runs a staticCall right before sending, so a stale snapshot can never send a doomed tx;
// these checks only explain the state up front.
import { formatUsd } from "./format";
import type { AccountSnapshot, BondSnapshot, ChainEventRecord } from "./types";

export type Guard = { ok: true } | { ok: false; reason: string };
const OK: Guard = { ok: true };
const no = (reason: string): Guard => ({ ok: false, reason });

const YEAR = 365n * 86_400n;

/** Mirrors FaultlinePool.requiredReserve: ceil(units * couponBps * term / (10000 * YEAR)). */
export function requiredReserve(units: bigint, couponBps: number, riskStart: number, maturity: number): bigint {
  const num = units * BigInt(couponBps) * BigInt(maturity - riskStart);
  const den = 10_000n * YEAR;
  return (num + den - 1n) / den;
}

export type WalletState = { connected: boolean; rightChain: boolean };

function wallet(w: WalletState, a: AccountSnapshot | null): Guard {
  if (!w.connected || !a) return no("Sign in with a wallet first.");
  if (!w.rightChain) return no("Switch the wallet to this dashboard's network.");
  return OK;
}

/** invest(units): issuance window, minimum ticket, cap, funded reserve, KYC on both tokens, balance. */
export function canInvest(s: BondSnapshot, a: AccountSnapshot | null, w: WalletState, units: bigint | null, now: number): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (now < s.schedule.issuanceStart) return no("The issuance window has not opened yet.");
  if (now >= s.schedule.issuanceEnd) return no("The issuance window is closed.");
  const left = s.terms.cap - s.books.unitsIssued;
  if (left <= 0n) return no("The bond is fully subscribed (cap reached).");
  if (a!.bondKyc === false) return no("This wallet does not have KYC on the bond.");
  if (a!.stableKyc === false) return no("This wallet does not have KYC for the stablecoin.");
  if (units === null || units <= 0n) return no("Enter an amount.");
  if (units < s.terms.minTicket) return no(`The minimum ticket is ${formatUsd(s.terms.minTicket)}.`);
  if (units > left) return no(`Only ${formatUsd(left)} of units are left under the cap.`);
  const need = requiredReserve(s.books.unitsIssued + units, s.terms.couponBps, s.schedule.riskStart, s.schedule.maturity);
  if (s.books.couponReserve < need) return no(`The sponsor's coupon reserve does not cover this subscription yet (needs ${formatUsd(need)}).`);
  if (a!.stableBalance < units) return no(`The wallet holds only ${formatUsd(a!.stableBalance)}.`);
  return OK;
}

/** Redemption opens after submissionDeadline(), never while paused, never with a pending event (D2). */
export function redemptionGuard(s: BondSnapshot, now: number): Guard {
  if (s.trigger.paused) return no("The trigger is paused. Redemption stays closed until the admin unpauses.");
  if (now <= s.schedule.submissionDeadline) return no("Redemption opens after the submission deadline (maturity plus grace plus any paused time).");
  if (s.trigger.pendingCount > 0) return no("An event is pending in its challenge window. Redemption waits until it is vetoed or executed.");
  return OK;
}

export function canRedeem(s: BondSnapshot, a: AccountSnapshot | null, w: WalletState, now: number): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  const r = redemptionGuard(s, now);
  if (!r.ok) return r;
  if (a!.bondBalance === 0n) return no("This wallet holds no bond units.");
  return OK;
}

export function canClaim(a: AccountSnapshot | null, w: WalletState): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (a!.claimable === 0n) return no("Nothing to claim for this wallet.");
  if (a!.stableKyc === false) return no("This wallet does not have KYC for the stablecoin.");
  return OK;
}

/** fundCoupons(amount): sponsor only, before issuanceEnd (D6). */
export function canFundCoupons(s: BondSnapshot, a: AccountSnapshot | null, w: WalletState, amount: bigint | null, now: number): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (!a!.isSponsor) return no("Only the sponsor wallet can fund the coupon reserve.");
  if (now >= s.schedule.issuanceEnd) return no("Coupon funding closed at the end of issuance.");
  if (a!.stableKyc === false) return no("This wallet does not have KYC for the stablecoin.");
  if (amount === null || amount <= 0n) return no("Enter an amount.");
  if (a!.stableBalance < amount) return no(`The wallet holds only ${formatUsd(a!.stableBalance)}.`);
  return OK;
}

/** sweepExcess / sweepDust: anyone, after the submission deadline, not paused, nothing pending (D3). */
export function canSweep(s: BondSnapshot, w: WalletState, a: AccountSnapshot | null, now: number, dust: boolean): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  const r = redemptionGuard(s, now);
  if (!r.ok) return r;
  if (dust && s.books.bondSupply > 0n) return no("Units are still outstanding. Dust can be swept only after every unit is redeemed.");
  return OK;
}

/** veto: trustee only, Pending, inside the window; allowed while paused. */
export function canVeto(e: ChainEventRecord, remaining: number, a: AccountSnapshot | null, w: WalletState): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (!a!.isTrustee) return no("Only the trustee can veto.");
  if (e.status !== "Pending") return no(`The event is ${e.status}, not pending.`);
  if (remaining <= 0) return no("The challenge window has ended.");
  return OK;
}

/** execute: anyone, not paused, Pending, window complete. */
export function canExecute(s: BondSnapshot, e: ChainEventRecord, remaining: number, a: AccountSnapshot | null, w: WalletState): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (e.status !== "Pending") return no(`The event is ${e.status}, not pending.`);
  if (s.trigger.paused) return no("The trigger is paused.");
  if (remaining > 0) return no("The challenge window is still running.");
  return OK;
}

export function canPause(s: BondSnapshot, a: AccountSnapshot | null, w: WalletState): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (!a!.isTrustee) return no("Only the trustee can pause.");
  if (s.trigger.paused) return no("The trigger is already paused.");
  return OK;
}

export function canUnpause(s: BondSnapshot, a: AccountSnapshot | null, w: WalletState): Guard {
  const g = wallet(w, a);
  if (!g.ok) return g;
  if (!a!.isAdmin) return no("Only the admin can unpause.");
  if (!s.trigger.paused) return no("The trigger is not paused.");
  return OK;
}

/** Seconds left in an event's window at wall time `nowMs`: the chain value counts down between polls unless the
 *  trigger is paused (effective time is frozen then, D2). */
export function remainingAt(e: ChainEventRecord, s: BondSnapshot, nowMs: number): number {
  if (e.status !== "Pending") return 0;
  if (s.trigger.paused) return e.windowRemaining;
  return Math.max(0, e.windowRemaining - Math.floor((nowMs - s.readAt) / 1000));
}
