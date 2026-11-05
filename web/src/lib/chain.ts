// Read-only chain access: one JsonRpcProvider per network, no keys. Static facts (addresses, schedule, terms) are read
// once per trigger; the books, the trigger state and the connected account are read on every poll.
import { Contract, JsonRpcProvider, ZeroHash, getAddress, type Provider } from "ethers";
import type { NetworkConfig } from "@/config/networks";
import { BOND_ABI, ERC20_ABI, HTS_ABI, HTS_ADDRESS, POOL_ABI, STATUS, TRIGGER_ABI } from "./abi";
import type { AccountSnapshot, BondSnapshot, ChainEventRecord } from "./types";

export function makeProvider(net: NetworkConfig): JsonRpcProvider {
  // Hashio's batch support is not verified (it answered 502 to a batch during step 7), so testnet sends one call per request.
  return new JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true, batchMaxCount: net.id === "local" ? 100 : 1, polling: false });
}

const n = (x: bigint) => Number(x);
const fn = (c: Contract, name: string) => c.getFunction(name);

export type StaticFacts = Pick<BondSnapshot, "addresses" | "symbols" | "terms"> & { schedule: Omit<BondSnapshot["schedule"], "submissionDeadline"> };

export async function readStatic(p: Provider, triggerAddress: string): Promise<StaticFacts> {
  if ((await p.getCode(triggerAddress)) === "0x") throw new Error(`No contract at the trigger address ${triggerAddress} on this network.`);
  const trigger = new Contract(triggerAddress, TRIGGER_ABI, p);
  const [poolAddr, termsHash, challengeWindow, oracle] = await Promise.all([fn(trigger, "pool")(), fn(trigger, "termsHash")(), fn(trigger, "challengeWindow")(), fn(trigger, "oracle")()]);
  const pool = new Contract(poolAddr, POOL_ABI, p);
  const [stablecoin, bond, sponsor, issuanceStart, issuanceEnd, riskStart, maturity, grace, couponBps, cap, minTicket] = await Promise.all(
    ["stablecoin", "bond", "sponsor", "issuanceStart", "issuanceEnd", "riskStart", "maturity", "grace", "couponBps", "cap", "minTicket"].map((k) => fn(pool, k)()),
  );
  const meta = async (addr: string, k: "symbol" | "name") => {
    try {
      return String(await fn(new Contract(addr, ERC20_ABI, p), k)());
    } catch {
      return "";
    }
  };
  const [stableSymbol, bondSymbol, bondName] = await Promise.all([meta(stablecoin, "symbol"), meta(bond, "symbol"), meta(bond, "name")]);
  return {
    addresses: { pool: getAddress(poolAddr), trigger: getAddress(triggerAddress), stablecoin: getAddress(stablecoin), bond: getAddress(bond), sponsor: getAddress(sponsor), oracle: getAddress(oracle) },
    symbols: { stablecoin: stableSymbol, bond: bondSymbol, bondName },
    schedule: { issuanceStart: n(issuanceStart), issuanceEnd: n(issuanceEnd), riskStart: n(riskStart), maturity: n(maturity), grace: n(grace) },
    terms: { couponBps: n(couponBps), cap, minTicket, challengeWindow: n(challengeWindow), termsHash },
  };
}

/** Chain time for the rules: the pending block's timestamp on a Hardhat node (what the next tx will see, also after
 *  time travel), the latest block elsewhere. */
async function chainClock(p: JsonRpcProvider): Promise<{ time: number; block: number }> {
  const latest = await p.getBlock("latest");
  if (!latest) throw new Error("The node returned no latest block.");
  try {
    const pending = (await p.send("eth_getBlockByNumber", ["pending", false])) as { timestamp?: string } | null;
    if (pending?.timestamp) return { time: Math.max(Number(BigInt(pending.timestamp)), latest.timestamp), block: latest.number };
  } catch {
    /* no pending block on this node */
  }
  return { time: latest.timestamp, block: latest.number };
}

export async function readSnapshot(p: JsonRpcProvider, s: StaticFacts): Promise<BondSnapshot> {
  const trigger = new Contract(s.addresses.trigger, TRIGGER_ABI, p);
  const pool = new Contract(s.addresses.pool, POOL_ABI, p);
  const stable = new Contract(s.addresses.stablecoin, ERC20_ABI, p);
  const bond = new Contract(s.addresses.bond, ERC20_ABI, p);
  const [clock, oracle, paused, pauseStart, totalPausedSeconds, pendingCount, effectiveTime, submissionDeadline] = await Promise.all([
    chainClock(p),
    fn(trigger, "oracle")(),
    ...["paused", "pauseStart", "totalPausedSeconds", "pendingCount", "effectiveTime", "submissionDeadline"].map((k) => fn(trigger, k)()),
  ]);
  const keys = ["unitsIssued", "unitsRedeemed", "appliedLossBps", "sponsorCredited", "couponReserve", "couponReserveLeft", "collateralLeft", "principalPaid", "couponPaid", "totalClaimable", "isSolvent"] as const;
  const values: unknown[] = await Promise.all(keys.map((k) => fn(pool, k)()));
  const v = (k: (typeof keys)[number]) => values[keys.indexOf(k)] as bigint;
  const b = { ...Object.fromEntries(keys.map((k) => [k, v(k)])), isSolvent: values[keys.indexOf("isSolvent")] as boolean } as Record<Exclude<(typeof keys)[number], "isSolvent">, bigint> & { isSolvent: boolean };
  const [poolBalance, bondSupply, requiredReserveForCap] = await Promise.all([fn(stable, "balanceOf")(s.addresses.pool), fn(bond, "totalSupply")(), fn(pool, "requiredReserve")(s.terms.cap)]);
  return {
    ...s,
    addresses: { ...s.addresses, oracle: getAddress(oracle) },
    chainId: Number((await p.getNetwork()).chainId),
    blockNumber: clock.block,
    chainTime: clock.time,
    readAt: Date.now(),
    schedule: { ...s.schedule, submissionDeadline: n(submissionDeadline) },
    trigger: { paused: Boolean(paused), pauseStart: n(pauseStart), totalPausedSeconds: n(totalPausedSeconds), pendingCount: n(pendingCount), effectiveTime: n(effectiveTime) },
    books: {
      unitsIssued: b.unitsIssued,
      unitsRedeemed: b.unitsRedeemed,
      appliedLossBps: Number(b.appliedLossBps),
      sponsorCredited: b.sponsorCredited,
      couponReserve: b.couponReserve,
      couponReserveLeft: b.couponReserveLeft,
      collateralLeft: b.collateralLeft,
      principalPaid: b.principalPaid,
      couponPaid: b.couponPaid,
      totalClaimable: b.totalClaimable,
      isSolvent: b.isSolvent,
      poolBalance,
      bondSupply,
      requiredReserveForCap,
    },
  };
}

/** KYC through HTS 0x167 isKyc (the pool's own D11 pre-check); null when the call is not available. */
async function htsKyc(p: Provider, token: string, account: string): Promise<boolean | null> {
  try {
    const [code, granted] = (await fn(new Contract(HTS_ADDRESS, HTS_ABI, p), "isKyc").staticCall(token, account)) as [bigint, boolean];
    return code === 22n ? granted : null;
  } catch {
    return null;
  }
}

async function bondKyc(p: Provider, bond: string, account: string): Promise<boolean | null> {
  try {
    return Number(await fn(new Contract(bond, BOND_ABI, p), "getKycStatusFor")(account)) === 1;
  } catch {
    return null;
  }
}

export async function readAccount(p: Provider, s: BondSnapshot, address: string): Promise<AccountSnapshot> {
  const trigger = new Contract(s.addresses.trigger, TRIGGER_ABI, p);
  const pool = new Contract(s.addresses.pool, POOL_ABI, p);
  const stable = new Contract(s.addresses.stablecoin, ERC20_ABI, p);
  const bond = new Contract(s.addresses.bond, ERC20_ABI, p);
  const [trusteeRole, bondBalance, value, claimable, stableBalance, allowance, stableKyc, kyc] = await Promise.all([
    fn(trigger, "TRUSTEE_ROLE")(),
    fn(bond, "balanceOf")(address),
    fn(pool, "effectiveValue")(address),
    fn(pool, "claimable")(address),
    fn(stable, "balanceOf")(address),
    fn(stable, "allowance")(address, s.addresses.pool),
    htsKyc(p, s.addresses.stablecoin, address),
    bondKyc(p, s.addresses.bond, address),
  ]);
  const [isTrustee, isAdmin] = await Promise.all([fn(trigger, "hasRole")(trusteeRole, address), fn(trigger, "hasRole")(ZeroHash, address)]);
  return {
    address: getAddress(address),
    bondBalance,
    principal: value[0],
    coupon: value[1],
    claimable,
    stableBalance,
    allowance,
    stableKyc,
    bondKyc: kyc,
    isSponsor: getAddress(address) === s.addresses.sponsor,
    isTrustee: Boolean(isTrustee),
    isAdmin: Boolean(isAdmin),
  };
}

export async function readEventRecords(p: Provider, triggerAddress: string, eventIds: string[]): Promise<ChainEventRecord[]> {
  const t = new Contract(triggerAddress, TRIGGER_ABI, p);
  return Promise.all(
    eventIds.map(async (eventId) => {
      const [r, endsAt, remaining] = await Promise.all([fn(t, "getEventRecord")(eventId), fn(t, "windowEndsAt")(eventId), fn(t, "windowRemaining")(eventId)]);
      return {
        eventId,
        status: STATUS[Number(r.status)] ?? "None",
        lossBps: Number(r.lossBps),
        magnitudeX100: Number(r.magnitudeX100),
        observedAt: Number(r.observedAt),
        usgsUpdatedAt: Number(r.usgsUpdatedAt),
        nonce: Number(r.nonce),
        dataHash: r.dataHash as string,
        windowStart: Number(r.windowStart),
        windowEndsAt: Number(endsAt),
        windowRemaining: Number(remaining),
      };
    }),
  );
}

export type HolderRow = { address: string; bondBalance: bigint; principal: bigint; coupon: bigint };

export async function readHolders(p: Provider, s: BondSnapshot, holders: string[]): Promise<HolderRow[]> {
  const pool = new Contract(s.addresses.pool, POOL_ABI, p);
  const bond = new Contract(s.addresses.bond, ERC20_ABI, p);
  return Promise.all(
    holders.map(async (address) => {
      const [bondBalance, value] = await Promise.all([fn(bond, "balanceOf")(address), fn(pool, "effectiveValue")(address)]);
      return { address, bondBalance, principal: value[0], coupon: value[1] };
    }),
  );
}
