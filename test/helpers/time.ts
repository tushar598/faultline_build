// Time-travel helpers (local Hardhat chain only; time moves forward only).
import { time } from "@nomicfoundation/hardhat-network-helpers";

export { time };

/** Latest block timestamp as bigint. */
export async function now(): Promise<bigint> {
  return BigInt(await time.latest());
}

/** Moves the chain forward by `seconds` and mines a block. */
export async function advance(seconds: number | bigint): Promise<void> {
  await time.increase(seconds);
}

/** Moves the chain to `timestamp` and mines a block. */
export async function travelTo(timestamp: number | bigint): Promise<void> {
  await time.increaseTo(timestamp);
}

export const HOUR = 3600n;
export const DAY = 24n * HOUR;
export const YEAR = 365n * DAY;
