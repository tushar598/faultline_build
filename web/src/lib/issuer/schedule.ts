// Issuer page, step b: schedule and economics of a new bond, checked against the constructor rules of FaultlinePool and
// FaultlineTrigger before anything is sent (contracts/FaultlinePool.sol constructor, FaultlineTrigger.sol constructor,
// D17 bounds), plus the coupon reserve the sponsor must fund for a full subscription (pool.requiredReserve(cap)).
// Pure: unit-tested in test/issuer.schedule.test.ts.
import { DECIMALS, parseUsd } from "@/lib/format";
import { requiredReserve } from "@/lib/guards";

export const DAY = 86_400;
/** FaultlinePool YEAR (ARCHITECTURE §3.4). */
export const YEAR = 365 * DAY;
/** D17: FaultlinePool MAX_GRACE. */
export const MAX_GRACE_SEC = 365 * DAY;
/** D17: FaultlineTrigger MAX_CHALLENGE_WINDOW. */
export const MAX_WINDOW_SEC = 30 * DAY;
const UINT16_MAX = 65_535;
/** SEC-22: `maturity + grace + paused time` is uint64 on chain; dates past 2200 are refused long before that. */
const LATEST_SEC = 7_258_118_400; // 2200-01-01T00:00:00Z
const EARLIEST_SEC = 946_684_800; // 2000-01-01T00:00:00Z

export type ScheduleDraft = {
  issuanceStart: number;
  issuanceEnd: number;
  riskStart: number;
  maturity: number;
  graceSec: number;
  challengeWindowSec: number;
  couponBps: string;
  cap: string;
  minTicket: string;
};

export type ScheduleField = keyof ScheduleDraft;
export type ScheduleErrors = Partial<Record<ScheduleField, string>>;

/** Constructor-ready values (uint64 / uint16 / uint256 as bigint or number). */
export type Schedule = {
  issuanceStart: bigint;
  issuanceEnd: bigint;
  riskStart: bigint;
  maturity: bigint;
  grace: bigint;
  challengeWindow: bigint;
  couponBps: number;
  cap: bigint;
  minTicket: bigint;
};


/** Profiles the page offers as a starting point (ARCHITECTURE §12.1). Local: time travel, so a production-like year;
 *  testnet: the demo-only wall-clock profile (60 s window would be too tight for a wallet, so 120 s as in step 9). */
export function defaultScheduleDraft(nowSec: number, mode: "local" | "testnet"): ScheduleDraft {
  if (mode === "local") {
    const issuanceStart = nowSec + 60;
    const issuanceEnd = issuanceStart + DAY;
    return { issuanceStart, issuanceEnd, riskStart: issuanceEnd, maturity: issuanceEnd + YEAR, graceSec: 30 * DAY, challengeWindowSec: 2 * DAY, couponBps: "600", cap: "10000", minTicket: "100" };
  }
  // Testnet: issuance opens 25 min from now so the bond, the pool, the wiring and the two ops/ steps land first (about 12
  // wallet steps of a minute or two each through the relay; 10 min was too tight in the owner's browser run,
  // 2026-11-06); 20 min issuance, 30 min risk period, 3 min grace, 120 s window. Demo-only.
  const issuanceStart = nowSec + 25 * 60;
  const issuanceEnd = issuanceStart + 20 * 60;
  return { issuanceStart, issuanceEnd, riskStart: issuanceEnd, maturity: issuanceEnd + 30 * 60, graceSec: 180, challengeWindowSec: 120, couponBps: "600", cap: "10000", minTicket: "100" };
}

const isWhole = (n: number) => Number.isSafeInteger(n);

/** Every constructor rule, field by field. `nowSec` only feeds warnings (a past issuance start is allowed on chain). */
export function validateSchedule(d: ScheduleDraft): { ok: true; value: Schedule; requiredReserve: bigint } | { ok: false; errors: ScheduleErrors } {
  const errors: ScheduleErrors = {};
  for (const f of ["issuanceStart", "issuanceEnd", "riskStart", "maturity"] as const) {
    if (!isWhole(d[f])) errors[f] = "Pick a date and time.";
    else if (d[f] < EARLIEST_SEC || d[f] > LATEST_SEC) errors[f] = "Must be between 2000 and 2200.";
  }
  if (!errors.issuanceStart && !errors.issuanceEnd && d.issuanceStart >= d.issuanceEnd) errors.issuanceEnd = "Issuance must end after it starts (issuanceStart < issuanceEnd).";
  if (!errors.issuanceEnd && !errors.riskStart && d.issuanceEnd > d.riskStart) errors.riskStart = "The risk period starts when issuance has closed (issuanceEnd <= riskStart).";
  if (!errors.riskStart && !errors.maturity && d.riskStart >= d.maturity) errors.maturity = "Maturity must be after the risk period starts (riskStart < maturity).";
  if (!isWhole(d.graceSec) || d.graceSec <= 0 || d.graceSec > MAX_GRACE_SEC) errors.graceSec = "Grace must be above 0 and at most 365 days (D17).";
  if (!isWhole(d.challengeWindowSec) || d.challengeWindowSec <= 0 || d.challengeWindowSec > MAX_WINDOW_SEC) errors.challengeWindowSec = "The challenge window must be above 0 and at most 30 days (D17).";

  const bps = d.couponBps.trim();
  const couponBps = /^\d{1,5}$/.test(bps) ? Number(bps) : NaN;
  if (!(couponBps > 0 && couponBps <= UINT16_MAX)) errors.couponBps = "A whole number of basis points above 0 (at most 65,535).";
  const cap = parseUsd(d.cap);
  if (cap === null || cap <= 0n) errors.cap = `A USD amount above 0 with at most ${DECIMALS} decimals.`;
  const minTicket = parseUsd(d.minTicket);
  if (minTicket === null || minTicket <= 0n) errors.minTicket = `A USD amount above 0 with at most ${DECIMALS} decimals.`;
  else if (cap !== null && cap > 0n && minTicket > cap) errors.minTicket = "Above the cap: no investment could ever pass (the contract does not check this; the page does).";

  if (Object.keys(errors).length) return { ok: false, errors };
  const value: Schedule = {
    issuanceStart: BigInt(d.issuanceStart),
    issuanceEnd: BigInt(d.issuanceEnd),
    riskStart: BigInt(d.riskStart),
    maturity: BigInt(d.maturity),
    grace: BigInt(d.graceSec),
    challengeWindow: BigInt(d.challengeWindowSec),
    couponBps,
    cap: cap!,
    minTicket: minTicket!,
  };
  return { ok: true, value, requiredReserve: requiredReserve(value.cap, couponBps, d.riskStart, d.maturity) };
}

/** Non-blocking notes about a valid schedule at chain time `nowSec`. */
export function scheduleWarnings(s: Schedule, nowSec: number, mode: "local" | "testnet"): string[] {
  const w: string[] = [];
  if (s.issuanceEnd <= BigInt(nowSec)) w.push("Issuance has already closed at the current chain time: nobody could invest.");
  else if (s.issuanceStart <= BigInt(nowSec)) w.push("Issuance is already open at the current chain time; the sponsor must fund the reserve before anyone can invest.");
  if (mode === "testnet") {
    if (s.challengeWindow < 120n) w.push("A challenge window under 120 s left too little margin for the trustee on testnet (step 9). Production uses 48 to 72 hours.");
    if (s.issuanceStart < BigInt(nowSec) + 300n) w.push("On testnet the ATS bond must exist before issuance starts, and each wallet step takes a minute or two: start issuance at least 5 to 10 minutes from now.");
  }
  return w;
}

/**
 * ATS v8 bond dates for a pool schedule (testnet): the bond starts 2 minutes after it is deployed and matures 60 s before
 * the pool's submission deadline without pauses (`maturity + grace - 60`), the rule of the full demo (scripts in
 * ops/scripts/demo/lib.ts scheduleFor). Problems are returned, not thrown.
 */
export function atsBondDates(s: Schedule, deployAtSec: number): { startingDate: number; maturityDate: number; problems: string[] } {
  const startingDate = deployAtSec + 120;
  const maturityDate = Number(s.maturity + s.grace) - 60;
  const problems: string[] = [];
  if (BigInt(startingDate) > s.issuanceStart) problems.push("The ATS bond would start after issuance opens: move issuanceStart later (at least 2 minutes after the bond step).");
  if (BigInt(maturityDate) < s.issuanceEnd + 60n) problems.push("The ATS bond would mature before issuance closes.");
  return { startingDate, maturityDate, problems };
}
