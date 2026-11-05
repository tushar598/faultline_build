// PART 2 STAND-IN. The pool part replaces this file with the real FaultlinePool fixtures (reference
// test/helpers/pool.ts). Until then MockPool (contracts/mocks/MockPool.sol, local tests only) stands in for the pool,
// with the same schedule, signer layout and unit amounts as the reference fixtures, so the trigger tests keep their shape.
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { DAY, YEAR, now } from "./time";

export const BPS = 10_000n;
const USD = (whole: number | bigint) => BigInt(whole) * 10n ** 6n; // 6 decimals, as in the reference fixtures
/** Odd unit amounts so every floor actually rounds (same as the reference). */
export const A_UNITS = USD(1234) + 567n;
export const B_UNITS = USD(2000) + 1n;

export type Schedule = { issuanceStart: bigint; issuanceEnd: bigint; riskStart: bigint; maturity: bigint; grace: bigint };

/** MockPool with the reference schedule and U = A_UNITS + B_UNITS issued; not wired. Chain time is before issuanceStart. */
export async function deployPoolFixture() {
  // Same signer indices as the reference fixtures (admin 0, investor 1, other 2, sponsor 3, investor2 4, buyer 5, stranger 6).
  const [admin, investor, other, sponsor, investor2, buyer, stranger] = await ethers.getSigners();
  const t0 = await now();
  const s: Schedule = {
    issuanceStart: t0 + 1000n,
    issuanceEnd: t0 + 1000n + DAY,
    riskStart: t0 + 1000n + 2n * DAY,
    maturity: t0 + 1000n + 2n * DAY + YEAR,
    grace: 30n * DAY,
  };
  const pool = await ethers.deployContract("MockPool", [s.riskStart, s.maturity, s.grace, A_UNITS + B_UNITS]);
  return { admin, investor, other, sponsor, investor2, buyer, stranger, s, pool };
}

export type PoolWorld = Awaited<ReturnType<typeof deployPoolFixture>>;

/** Wires the pool to `triggerAddress` (D5: pool → trigger → initialize). */
export async function wirePool(f: PoolWorld, triggerAddress: string) {
  await f.pool.initialize(triggerAddress);
}

/** Sends the next transaction at exactly `ts`. */
export async function atTime(ts: bigint): Promise<void> {
  await time.setNextBlockTimestamp(ts);
}
