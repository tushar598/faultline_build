// Whole-state fingerprint for "a failed operation leaves nothing behind", and raw trace counts for the DoS tests. Time-dependent
// views (effective time, accrued index) are left out on purpose: a mined revert still moves the clock.
import { ethers } from "hardhat";
import type { Addressable } from "ethers";

type Pool = Awaited<ReturnType<typeof ethers.deployContract>> & Record<string, (...a: unknown[]) => Promise<unknown>>;
type World = { pool: unknown; usd: unknown; bond: unknown; trigger?: unknown };

const POOL_GETTERS = [
  "trigger", "appliedLossBps", "lastAccrual", "unitsIssued", "unitsRedeemed", "sponsorCredited", "couponReserve", "couponIndex",
  "principalPaid", "couponPaid", "totalClaimable", "collateralLeft", "couponReserveLeft",
];
const TRIGGER_GETTERS = ["oracle", "paused", "pauseStart", "totalPausedSeconds", "pendingCount"];

/** Every stored value of the pool, the trigger (when it is the real one) and the bond and stablecoin books of `accounts`. */
export async function fingerprint(f: World, accounts: string[], eventIds: string[] = []): Promise<string> {
  const pool = f.pool as Pool;
  const bond = f.bond as Pool;
  const usd = f.usd as Pool;
  const poolAddr = await (pool as unknown as Addressable).getAddress();
  const reads: Promise<unknown>[] = POOL_GETTERS.map((g) => pool[g]());
  reads.push(usd.balanceOf(poolAddr), bond.totalSupply(), bond.paused());
  for (const a of accounts) reads.push(pool.claimable(a), bond.balanceOf(a), usd.balanceOf(a));
  const trigger = f.trigger as Pool | undefined;
  if (trigger?.getEventRecord) {
    for (const g of TRIGGER_GETTERS) reads.push(trigger[g]());
    for (const id of eventIds) reads.push(trigger.getEventRecord(id));
  }
  return JSON.stringify(await Promise.all(reads), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

type StructLog = { op: string; storage?: Record<string, string>; depth: number };

/** Opcode trace of a mined transaction: step count, SSTORE count and the distinct slots it wrote. */
export async function trace(txHash: string): Promise<{ steps: number; sstores: number; slots: number; loads: number }> {
  const r = (await ethers.provider.send("debug_traceTransaction", [txHash, { disableMemory: true, disableStack: false }])) as { structLogs: (StructLog & { stack?: string[] })[] };
  const written = new Set<string>();
  let sstores = 0;
  let loads = 0;
  for (const l of r.structLogs) {
    if (l.op === "SLOAD") loads++;
    if (l.op === "SSTORE") {
      sstores++;
      written.add(`${l.depth}:${l.stack?.[l.stack.length - 1]}`);
    }
  }
  return { steps: r.structLogs.length, sstores, slots: written.size, loads };
}
