// FaultlinePool fixtures (on top of the mocks) and the invariant checks of docs/ARCHITECTURE.md §5 that every pool
// test runs after its state-changing steps. MockTrigger stands in for FaultlineTrigger.
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MAX_SUPPLY, USD, deployMocksFixture, onboardUsd } from "./fixtures";
import { ROLES } from "./roles";
import { DAY, YEAR, now, travelTo } from "./time";
import type { FaultlinePool } from "../../typechain-types";

export const BPS = 10_000n;
export const SCALE = 10n ** 18n;
export const COUPON_BPS = 800n; // 8 % a year
export const MIN_TICKET = USD(10);
export const CAP = MAX_SUPPLY; // 10,000 USD, same as the MockBond max supply
/** Odd unit amounts so every floor actually rounds. */
export const A_UNITS = USD(1234) + 567n;
export const B_UNITS = USD(2000) + 1n;
/** Half a coupon year, in seconds. */
export const YEAR_HALF = YEAR / 2n;

export type Schedule = { issuanceStart: bigint; issuanceEnd: bigint; riskStart: bigint; maturity: bigint; grace: bigint };

/** Coupon index growth for `dt` seconds at loss `L` (same integer maths as ARCHITECTURE §3.4). */
export const accrual = (L: bigint, dt: bigint) => ((BPS - L) * COUPON_BPS * dt * SCALE) / (BPS * BPS * YEAR);
/** `ceil(units * couponBps * term / (10000 * YEAR))`. */
export const reserveFor = (units: bigint, s: Schedule) => {
  const num = units * COUPON_BPS * (s.maturity - s.riskStart);
  const den = BPS * YEAR;
  return (num + den - 1n) / den;
};

/** Pool + MockTrigger deployed; nothing initialized or onboarded. Chain time is before `issuanceStart`. */
export async function deployPoolFixture() {
  const m = await deployMocksFixture();
  const [, , , , investor2, buyer, stranger] = await ethers.getSigners();
  const t0 = await now();
  const s: Schedule = {
    issuanceStart: t0 + 1000n,
    issuanceEnd: t0 + 1000n + DAY,
    riskStart: t0 + 1000n + 2n * DAY,
    maturity: t0 + 1000n + 2n * DAY + YEAR,
    grace: 30n * DAY,
  };
  const params: FaultlinePool.ParamsStruct = {
    admin: m.admin.address,
    stablecoin: await m.usd.getAddress(),
    bond: await m.bond.getAddress(),
    sponsor: m.sponsor.address,
    ...s,
    couponBps: COUPON_BPS,
    cap: CAP,
    minTicket: MIN_TICKET,
  };
  const pool = await ethers.deployContract("FaultlinePool", [params]);
  const trigger = await ethers.deployContract("MockTrigger", [await pool.getAddress()]);
  const deadline = s.maturity + s.grace;
  await trigger.test_setSubmissionDeadline(deadline);
  return { ...m, investor2, buyer, stranger, s, params, pool, trigger, deadline };
}

/**
 * Initialized and wired, coupon reserve NOT funded: pool associated + KYC'd on the stablecoin and holding
 * ROLE_ISSUER + ROLE_CONTROLLER on the bond; sponsor, investor, investor2, buyer onboarded on both tokens with
 * 5,000 USD each and an unlimited approval; `stranger` onboarded on the stablecoin only (no bond KYC).
 */
export async function wiredPoolFixture() {
  const f = await deployPoolFixture();
  await wirePool(f, await f.trigger.getAddress());
  return f;
}

/** The wiring of `wiredPoolFixture`, with any trigger (MockTrigger or the real FaultlineTrigger). */
export async function wirePool(f: PoolWorld, triggerAddress: string) {
  const poolAddr = await f.pool.getAddress();
  await f.pool.initialize(triggerAddress);
  await f.usd.grantKyc(poolAddr);
  await f.bond.grantRole(ROLES.ISSUER, poolAddr);
  await f.bond.grantRole(ROLES.CONTROLLER, poolAddr);
  for (const who of [f.sponsor, f.investor, f.investor2, f.buyer, f.stranger]) {
    await onboardUsd(f.usd, who, USD(5_000));
    await f.usd.connect(who).approve(poolAddr, ethers.MaxUint256);
  }
  for (const who of [f.investor, f.investor2, f.buyer]) await f.bond.grantKyc(who.address, "vc", 0, 2n ** 64n, f.admin.address);
}

/** Wired + the sponsor funded the full-term reserve for the whole cap. */
export async function readyPoolFixture() {
  const f = await wiredPoolFixture();
  await f.pool.connect(f.sponsor).fundCoupons(await f.pool.requiredReserve(CAP));
  return f;
}

/** Ready + investor bought `A_UNITS`, investor2 `B_UNITS`; chain time is exactly `riskStart`. */
export async function investedPoolFixture() {
  const f = await readyPoolFixture();
  await travelTo(f.s.issuanceStart);
  await f.pool.connect(f.investor).invest(A_UNITS);
  await f.pool.connect(f.investor2).invest(B_UNITS);
  await travelTo(f.s.riskStart);
  return f;
}

export type PoolWorld = Awaited<ReturnType<typeof deployPoolFixture>>;

/** Sends the next transaction at exactly `ts`. */
export async function atTime(ts: bigint): Promise<void> {
  await time.setNextBlockTimestamp(ts);
}

/** Loss through the trigger (the only allowed caller). */
export function loss(f: PoolWorld, bps: bigint | number) {
  return f.trigger.forwardApplyLoss(bps);
}

/**
 * ARCHITECTURE §5 invariants, checked from on-chain state:
 * 1. `balance >= totalClaimable + floor(out*(10000-L)/10000) + floor(out*maxIndex/1e18)` (always), where
 *    `out = min(unitsIssued - unitsRedeemed, totalSupply)` (D18), and `balance >= collateralLeft + couponReserveLeft +
 *    totalClaimable` (until the first sweep); `isSolvent()`.
 * 3. `sponsorCredited == floor(U*L/10000)`.
 * 4. `bond.totalSupply() <= unitsIssued - unitsRedeemed` (D18), and `==` unless `opts.burned` says a holder burned; skipped
 *    when a test raised the supply on purpose (`supplyBroken`).
 * Also: `totalClaimable` equals the sum of the known accounts' `claimable`, and `L <= 10000`.
 */
export async function expectInvariants(f: Omit<PoolWorld, "trigger">, opts: { swept?: boolean; supplyBroken?: boolean; burned?: boolean } = {}) {
  const { pool, usd, bond } = f;
  const poolAddr = await pool.getAddress();
  const [bal, U, R, L, credited, totalClaimable, idx, last, collLeft, resLeft, supply] = await Promise.all([
    usd.balanceOf(poolAddr),
    pool.unitsIssued(),
    pool.unitsRedeemed(),
    pool.appliedLossBps(),
    pool.sponsorCredited(),
    pool.totalClaimable(),
    pool.couponIndex(),
    pool.lastAccrual(),
    pool.collateralLeft(),
    pool.couponReserveLeft(),
    bond.totalSupply(),
  ]);
  const books = U - R;
  const out = supply < books ? supply : books;
  const maxIndex = idx + (f.s.maturity > last ? accrual(L, f.s.maturity - last) : 0n);
  expect(L <= BPS, "L <= 10000").to.equal(true);
  expect(bal, "invariant 1 (always form)").to.be.gte(totalClaimable + (out * (BPS - L)) / BPS + (out * maxIndex) / SCALE);
  expect(await pool.isSolvent(), "isSolvent()").to.equal(true);
  if (!opts.swept) expect(bal, "invariant 1 (until sweepExcess)").to.be.gte(collLeft + resLeft + totalClaimable);
  expect(credited, "invariant 3").to.equal((U * L) / BPS);
  if (!opts.supplyBroken) {
    expect(supply, "invariant 4").to.be.lte(books);
    if (!opts.burned) expect(supply, "invariant 4 (nobody burned)").to.equal(books);
  }
  const accounts = [f.sponsor, f.investor, f.investor2, f.buyer, f.stranger, f.admin, f.other];
  const sum = (await Promise.all(accounts.map((a) => pool.claimable(a.address)))).reduce((x, y) => x + y, 0n);
  expect(sum, "totalClaimable == sum(claimable)").to.equal(totalClaimable);
}
