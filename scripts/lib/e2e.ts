// Local end-to-end lifecycle (HANDOVER §10 step 5) on the in-process Hardhat chain or `--network localhost`:
// the REAL FaultlinePool + FaultlineTrigger with MockUSD, MockBond and MockHTS at 0x167, the REAL Bhuj record
// (usp000a8ds) and SYNTHETIC Kutch events. MOCK-TESTED, LOCAL ONLY: MockBond is not ATS and MockUSD is not HTS.
//
// Each flow deploys a fresh bond (a vetoed eventId is final, so flows cannot share one) with the LOCAL profile of
// ARCHITECTURE §12.1 relative to the latest block, and after every step asserts: the bookkeeping form of invariant 1
// (until the first sweepExcess, §5), isSolvent(), the supply guard identity and pendingCount == modelled pending
// events. Each flow ends by closing the books to the base unit: total claimed == deposits + coupon reserve, and the
// pool holds exactly 0.
import { ethers, network } from "hardhat";
import type { BaseContract, Signer } from "ethers";
import {
  assertReplayAllowed,
  buildAttestation,
  eventIdOf,
  kutchTerms,
  observedAtOf,
  signAttestation,
  termsHash,
  type Attestation,
  type Terms,
} from "../../shared/ts/attestation";
import { ROLES } from "../../test/helpers/roles";
import { auditBondRoles } from "./bondAudit";
import { BHUJ_FILE, SYNTH_72_FILE, SYNTH_73_FILE, SYNTH_75_FILE, loadFeature } from "./fixtures";
import type { FaultlinePool, FaultlineTrigger, MockBond, MockUSD } from "../../typechain-types";

// ---------------------------------------------------------------- LOCAL profile (ARCHITECTURE §12.1)

const HOUR = 3_600n;
const DAY = 24n * HOUR;
const YEAR = 365n * DAY;
export const LOCAL = {
  issuance: DAY,
  risk: YEAR,
  grace: 30n * DAY,
  challengeWindow: 48n * HOUR,
  couponBps: 600n,
  cap: 10_000_000_000n, // 10,000 USD
  minTicket: 100_000_000n, // 100 USD
  bhujAt: 10n * DAY, // Bhuj's replayed observedAt = riskStart + 10 days
} as const;
const USD = (whole: bigint) => whole * 1_000_000n;
export const TICKETS = { A: USD(5_000n), B: USD(3_000n), C: USD(2_000n) } as const;
const HTS = "0x0000000000000000000000000000000000000167";
const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"] as const;

export type Log = (line: string) => void;
type Holder = "A" | "B" | "C";

/** One fresh bond with its actors and the bookkeeping the flow keeps next to the chain. */
export type World = Awaited<ReturnType<typeof deployWorld>>;

/** Final numbers of one flow (also asserted by test/e2e.local.test.ts). */
export type FlowResult = {
  flow: string;
  L: bigint;
  units: bigint;
  sponsorCredited: bigint;
  sponsorClaimed: bigint;
  holders: Record<Holder, { units: bigint; principal: bigint; coupon: bigint }>;
  couponReserve: bigint;
  deposits: bigint;
  paidOut: bigint;
  leftover: bigint;
  executedAt: bigint[];
  riskStart: bigint;
  maturity: bigint;
};

// ---------------------------------------------------------------- small utilities

/** 1234567 → "1.234567" (USD, 6 decimals). */
export function usd(x: bigint): string {
  const neg = x < 0n;
  const v = neg ? -x : x;
  const whole = (v / 1_000_000n).toLocaleString("en-US");
  return `${neg ? "-" : ""}${whole}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`e2e assertion failed: ${msg}`);
}

export async function latest(): Promise<bigint> {
  return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
}

/** Mines a block at exactly `ts` (must be in the future). */
export async function travelTo(ts: bigint): Promise<void> {
  const now = await latest();
  assert(ts > now, `travelTo(${ts}) is not after the latest block (${now})`);
  await network.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
  await network.provider.send("evm_mine", []);
}

/** Expects `p` to revert with the custom error `name` of `c`; returns quietly if it does. */
async function expectRevert(p: Promise<unknown>, c: BaseContract, name: string): Promise<void> {
  let failure: unknown;
  try {
    await p;
  } catch (e) {
    failure = e;
  }
  assert(failure !== undefined, `expected ${name}, but the call succeeded`);
  assert(revertName(failure, c) === name, `expected ${name}, got ${revertName(failure, c) ?? String(failure)}`);
}

/**
 * Custom-error name of a failed call. In-process Hardhat gives ethers a decoded `revert`; over HTTP
 * (`--network localhost`) the error is a ProviderError whose revert data sits in a nested `data` field or only in
 * the message ("reverted with custom error 'Name(…)'" / "return data: 0x…").
 */
function revertName(err: unknown, c: BaseContract): string | undefined {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): string | undefined => {
    if (!x || typeof x !== "object" || seen.has(x) || depth > 5) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    const revert = o.revert as { name?: string } | undefined;
    if (revert?.name) return revert.name;
    if (typeof o.data === "string" && /^0x[0-9a-fA-F]{8}/.test(o.data)) {
      const parsed = c.interface.parseError(o.data);
      if (parsed) return parsed.name;
    }
    for (const k of ["data", "error", "info", "cause", "parent"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  const found = walk(err, 0);
  if (found) return found;
  const msg = String((err as { message?: string })?.message ?? err);
  const byName = /custom error '(\w+)\(/.exec(msg);
  if (byName) return byName[1];
  const byData = /return data: (0x[0-9a-fA-F]+)/.exec(msg);
  return byData ? c.interface.parseError(byData[1])?.name : undefined;
}

// ---------------------------------------------------------------- deployment (D5, D4, D11)

/** `challengeWindow` overrides the LOCAL profile's 48 h only for the dashboard demo (a window you can watch run out in
 *  real time, like the testnet demo profile of §12.1); every e2e flow uses the default. */
export async function deployWorld(flow: string, log: Log, opts: { challengeWindow?: bigint } = {}) {
  const challengeWindow = opts.challengeWindow ?? LOCAL.challengeWindow;
  // The dashboard demo leaves interval mining on (scripts/dashboard-demo-local.ts); a block mined between
  // evm_setNextBlockTimestamp and evm_mine would break time travel, so every flow starts with it off.
  await network.provider.send("evm_setIntervalMining", [0]);
  const [admin, sponsor, trustee, oracle, relayer, a, b, c, backupTrustee] = await ethers.getSigners();
  const holders: Record<Holder, Signer & { address: string }> = { A: a, B: b, C: c };
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Mocks (local only): HTS stablecoin + its 0x167 system contract, ATS bond.
  const usdToken = (await ethers.deployContract("MockUSD", [USD(1_000_000n)])) as unknown as MockUSD;
  const bond = (await ethers.deployContract("MockBond", [admin.address, LOCAL.cap, true])) as unknown as MockBond;
  const hts = await ethers.deployContract("MockHTS");
  await network.provider.send("hardhat_setCode", [HTS, await ethers.provider.getCode(await hts.getAddress())]);
  await bond.grantRole(ROLES.KYC, admin.address);

  // Schedule relative to the latest block; Bhuj replayed to riskStart + 10 days (D10).
  const t0 = await latest();
  const issuanceStart = t0 + 60n;
  const issuanceEnd = issuanceStart + LOCAL.issuance;
  const riskStart = issuanceEnd;
  const maturity = riskStart + LOCAL.risk;
  const bhuj = loadFeature(BHUJ_FILE);
  const timeOffsetSec = Number(riskStart + LOCAL.bhujAt) - Math.floor(bhuj.properties.time / 1000);
  const terms: Terms = kutchTerms("replay", timeOffsetSec);
  assert(BigInt(observedAtOf(bhuj, terms)) === riskStart + LOCAL.bhujAt, "Bhuj replay offset");

  // D5: pool → trigger (copies the schedule) → initialize (HIP-719 associate).
  const poolF = await ethers.getContractFactory("FaultlinePool");
  const pool = (await poolF.deploy({
    admin: admin.address,
    stablecoin: await usdToken.getAddress(),
    bond: await bond.getAddress(),
    sponsor: sponsor.address,
    issuanceStart,
    issuanceEnd,
    riskStart,
    maturity,
    grace: LOCAL.grace,
    couponBps: LOCAL.couponBps,
    cap: LOCAL.cap,
    minTicket: LOCAL.minTicket,
  })) as unknown as FaultlinePool;
  const poolAddr = await pool.getAddress();
  assertReplayAllowed(terms, chainId); // D14: replay terms only on 31337 / 296
  const trigger = (await ethers.deployContract("FaultlineTrigger", [
    poolAddr,
    termsHash(terms),
    challengeWindow,
    oracle.address,
    admin.address,
    trustee.address,
  ])) as unknown as FaultlineTrigger;
  await pool.initialize(await trigger.getAddress());
  // D17: TRUSTEE_ROLE is its own admin, so the primary trustee adds the backup (the admin cannot). Losing every trustee
  // key would remove veto and pause for good.
  const TRUSTEE_ROLE = await trigger.TRUSTEE_ROLE();
  await trigger.connect(trustee).grantRole(TRUSTEE_ROLE, backupTrustee.address);
  assert((await trigger.getRoleAdmin(TRUSTEE_ROLE)) === TRUSTEE_ROLE && (await trigger.hasRole(TRUSTEE_ROLE, backupTrustee.address)), "D17: trustees self-administered, backup trustee set");
  // D11 order: associate (in initialize) → KYC → fund.
  await usdToken.grantKyc(poolAddr);
  // D4: the pool is the only issuer and controller; nobody holds a role that could move the supply or stop a burn.
  await bond.grantRole(ROLES.ISSUER, poolAddr);
  await bond.grantRole(ROLES.CONTROLLER, poolAddr);
  const roleProblems = await auditBondRoles(bond, poolAddr);
  assert(roleProblems.length === 0, `D4 role audit: ${roleProblems.join("; ")}`);

  // Stablecoin onboarding (associate → KYC → fund) and bond KYC for the investors.
  for (const [who, amount] of [[sponsor, USD(1_000n)], [a, TICKETS.A], [b, TICKETS.B], [c, TICKETS.C]] as const) {
    await usdToken.connect(who).associate();
    await usdToken.grantKyc(who.address);
    await usdToken.transfer(who.address, amount);
    await usdToken.connect(who).approve(poolAddr, amount);
  }
  for (const who of [a, b, c]) await bond.grantKyc(who.address, "vc-local-e2e", 0, 2n ** 64n, admin.address);

  const w = {
    flow, log, chainId, admin, sponsor, trustee, backupTrustee, oracle, relayer, holders,
    usd: usdToken, bond, pool, trigger, terms,
    s: { issuanceStart, issuanceEnd, riskStart, maturity },
    model: {} as Record<string, number>,
    names: {} as Record<string, string>,
    swept: false,
    deposits: 0n,
    paidOut: 0n,
    sponsorClaimed: 0n,
    executedAt: [] as bigint[],
    redeemed: {} as Record<Holder, { units: bigint; principal: bigint; coupon: bigint }>,
  };
  log(`\n=== ${flow} — fresh bond (mock-tested, local only: MockBond is not ATS, MockUSD is not HTS) ===`);
  log(`  pool ${poolAddr}  trigger ${await trigger.getAddress()}  termsHash ${termsHash(terms).slice(0, 18)}…`);
  log(`  schedule: issuance ${issuanceStart}→${issuanceEnd}, risk ${riskStart}→${maturity}, grace ${LOCAL.grace / DAY} d, window ${challengeWindow % HOUR === 0n ? `${challengeWindow / HOUR} h` : `${challengeWindow} s`}; replay offset ${timeOffsetSec} s`);

  // Coupon reserve for the whole cap, then the subscription.
  await pool.connect(sponsor).fundCoupons(await pool.requiredReserve(LOCAL.cap));
  await step(w, "sponsor", `fundCoupons(${usd(await pool.couponReserve())})`);
  await travelTo(issuanceStart);
  for (const h of ["A", "B", "C"] as const) {
    await pool.connect(holders[h]).invest(TICKETS[h]);
    w.deposits += TICKETS[h];
    await step(w, `investor ${h}`, `invest(${usd(TICKETS[h])})`);
  }
  return w;
}

// ---------------------------------------------------------------- per-step checks and log

async function step(w: World, actor: string, action: string, holders = false): Promise<void> {
  const { pool, usd: token, bond, trigger } = w;
  const poolAddr = await pool.getAddress();
  const [bal, collLeft, resLeft, totalClaimable, solvent, supply, U, R, L, pending] = await Promise.all([
    token.balanceOf(poolAddr), pool.collateralLeft(), pool.couponReserveLeft(), pool.totalClaimable(), pool.isSolvent(),
    bond.totalSupply(), pool.unitsIssued(), pool.unitsRedeemed(), pool.appliedLossBps(), trigger.pendingCount(),
  ]);
  if (!w.swept) assert(bal >= collLeft + resLeft + totalClaimable, `[${action}] invariant 1: balance >= collateralLeft + couponReserveLeft + totalClaimable`);
  assert(solvent, `[${action}] isSolvent()`);
  assert(supply === U - R, `[${action}] bond.totalSupply() == unitsIssued - unitsRedeemed`);
  let modelPending = 0n;
  for (const [id, st] of Object.entries(w.model)) {
    const onChain = Number((await trigger.getEventRecord(id)).status);
    assert(onChain === st, `[${action}] status of ${w.names[id]}: chain ${STATUS[onChain]} vs model ${STATUS[st]}`);
    if (st === 1) modelPending++;
  }
  assert(pending === modelPending, `[${action}] pendingCount ${pending} == modelled ${modelPending}`);

  const t = await latest();
  const day = t >= w.s.riskStart ? `risk+${((t - w.s.riskStart) * 100n) / DAY / 100n}d` : "issuance";
  w.log(`  [${day}] ${actor}: ${action}`);
  w.log(`      pool ${usd(bal)} | L ${L} bps | claimable ${usd(totalClaimable)} | pending ${pending} | solvent ${solvent}${w.swept ? " (after sweepExcess: bookkeeping form skipped, §5)" : ""}`);
  if (holders) {
    for (const h of ["A", "B", "C"] as const) {
      const ats = await bond.balanceOf(w.holders[h].address);
      const [principal, coupon] = await pool.effectiveValue(w.holders[h].address);
      w.log(`      ${h}: ATS balance ${usd(ats)} → effective ${usd(principal)} principal + ${usd(coupon)} coupon`);
    }
  }
}

// ---------------------------------------------------------------- oracle, trigger and pool actions

/** The oracle builds and signs an attestation from a saved fixture at the current chain time. */
async function attest(w: World, file: string, nonce = 1n): Promise<{ att: Attestation; sig: string; name: string }> {
  const feature = loadFeature(file);
  const nowSec = Number(await latest());
  const att = buildAttestation({ feature, terms: w.terms, chainId: w.chainId, nonce, deadline: BigInt(nowSec) + 7n * DAY, nowSec });
  const sig = await signAttestation(w.oracle, att, w.chainId, await w.trigger.getAddress());
  const name = `${feature.id} (M${feature.properties.mag}${file.startsWith("synthetic-") ? ", SYNTHETIC" : ", real USGS"})`;
  w.names[att.eventId] = name;
  return { att, sig, name };
}

async function submit(w: World, a: { att: Attestation; sig: string; name: string }): Promise<void> {
  await w.trigger.connect(w.relayer).submit(a.att, a.sig);
  w.model[a.att.eventId] = 1;
  await step(w, "relayer", `submit ${a.name}: ${a.att.lossBps} bps, observedAt ${a.att.observedAt}`);
}

async function execute(w: World, eventId: string, expect: "Executed" | "Superseded"): Promise<void> {
  const before = await w.pool.appliedLossBps();
  await w.trigger.connect(w.relayer).execute(eventId);
  w.model[eventId] = expect === "Executed" ? 3 : 4;
  if (expect === "Executed") w.executedAt.push(await latest());
  const L = await w.pool.appliedLossBps();
  const U = await w.pool.unitsIssued();
  assert((await w.pool.sponsorCredited()) === (U * L) / 10_000n, "sponsorCredited == floor(U*L/10000)");
  await step(w, "anyone (relayer)", `execute ${w.names[eventId]} → ${expect}, L ${before} → ${L}, sponsor credited ${usd(await w.pool.sponsorCredited())}`, true);
}

async function redeemAndClaim(w: World): Promise<void> {
  for (const h of ["A", "B", "C"] as const) {
    const who = w.holders[h];
    const units = await w.bond.balanceOf(who.address);
    const [principal, coupon] = await w.pool.effectiveValue(who.address);
    await w.pool.connect(who).redeem();
    const credited = await w.pool.claimable(who.address);
    assert(credited === principal + coupon, `${h}: redeem credit == effectiveValue`);
    w.redeemed[h] = { units, principal, coupon };
    await step(w, `investor ${h}`, `redeem ${usd(units)} units → ${usd(principal)} principal + ${usd(coupon)} coupon`);
    await claim(w, who, `investor ${h}`);
  }
}

async function claim(w: World, who: Signer & { address: string }, actor: string): Promise<void> {
  const amount = await w.pool.claimable(who.address);
  if (amount === 0n) return;
  const before = await w.usd.balanceOf(who.address);
  await w.pool.connect(who).claim();
  assert((await w.usd.balanceOf(who.address)) - before === amount, `${actor}: claim paid exactly claimable`);
  w.paidOut += amount;
  if (who.address === w.sponsor.address) w.sponsorClaimed += amount;
  await step(w, actor, `claim ${usd(amount)}`);
}

/** sweepExcess → sweepDust → sponsor claims; then the books must close to the base unit. */
async function closeBooks(w: World): Promise<FlowResult> {
  await w.pool.connect(w.relayer).sweepExcess();
  w.swept = true;
  await step(w, "anyone (relayer)", `sweepExcess → sponsor claimable ${usd(await w.pool.claimable(w.sponsor.address))}`);
  await w.pool.connect(w.relayer).sweepDust();
  await step(w, "anyone (relayer)", `sweepDust → sponsor claimable ${usd(await w.pool.claimable(w.sponsor.address))}`);
  await claim(w, w.sponsor, "sponsor");

  const leftover = await w.usd.balanceOf(await w.pool.getAddress());
  const reserve = await w.pool.couponReserve();
  assert(leftover === 0n, `pool stablecoin balance ends at 0 (got ${leftover})`);
  assert((await w.pool.totalClaimable()) === 0n, "nothing left claimable");
  assert(w.paidOut === w.deposits + reserve, `books: paid out ${w.paidOut} == deposits ${w.deposits} + reserve ${reserve}`);
  assert((await w.bond.totalSupply()) === 0n, "every unit redeemed");
  const result: FlowResult = {
    flow: w.flow,
    L: await w.pool.appliedLossBps(),
    units: await w.pool.unitsIssued(),
    sponsorCredited: await w.pool.sponsorCredited(),
    sponsorClaimed: w.sponsorClaimed,
    holders: w.redeemed,
    couponReserve: reserve,
    deposits: w.deposits,
    paidOut: w.paidOut,
    leftover,
    executedAt: w.executedAt,
    riskStart: w.s.riskStart,
    maturity: w.s.maturity,
  };
  w.log(`  books closed: paid out ${usd(w.paidOut)} == deposits ${usd(w.deposits)} + reserve ${usd(reserve)}; leftover ${usd(leftover)}`);
  return result;
}

/** Waits until a just-submitted event's window is over (no pause running). */
async function passWindow(w: World, eventId: string): Promise<void> {
  const endsAt = await w.trigger.windowEndsAt(eventId);
  const realEnd = endsAt + (await w.trigger.totalPausedSeconds());
  if (realEnd > (await latest())) await travelTo(realEnd);
}

async function afterDeadline(w: World): Promise<void> {
  await travelTo((await w.trigger.submissionDeadline()) + 1n);
}

async function readyFor(w: World, files: string[]): Promise<void> {
  let t = 0n;
  for (const f of files) {
    const at = BigInt(observedAtOf(loadFeature(f), w.terms) + w.terms.coolingPeriodSec);
    if (at > t) t = at;
  }
  if (t > (await latest())) await travelTo(t + 60n);
}

// ---------------------------------------------------------------- the three flows

/** Flow A — veto and replay: the trustee pauses, vetoes while paused, the replay is rejected, 0 % loss. */
export async function flowA(log: Log = console.log): Promise<FlowResult> {
  const w = await deployWorld("Flow A (veto + replay)", log);
  await readyFor(w, [BHUJ_FILE]);
  const bhuj = await attest(w, BHUJ_FILE);
  await submit(w, bhuj);

  await w.trigger.connect(w.trustee).pause();
  const frozen = await w.trigger.effectiveTime();
  await travelTo((await latest()) + HOUR);
  assert((await w.trigger.effectiveTime()) === frozen, "effectiveTime stops while paused");
  await step(w, "trustee", `pause — effectiveTime frozen at ${frozen} one hour later`);

  await w.trigger.connect(w.trustee).veto(bhuj.att.eventId);
  w.model[bhuj.att.eventId] = 2;
  await step(w, "trustee", `veto ${bhuj.name} while paused`);

  await w.trigger.connect(w.admin).unpause();
  await step(w, "admin", `unpause (paused ${await w.trigger.totalPausedSeconds()} s; deadline moved by the same)`);

  await expectRevert(w.trigger.connect(w.relayer).submit(bhuj.att, bhuj.sig), w.trigger, "EventFinalised");
  await step(w, "relayer", "re-submit the same signature → reverts EventFinalised (vetoed is final)");

  await afterDeadline(w);
  await redeemAndClaim(w);
  return closeBooks(w);
}

/** Flow B — two events, partial loss: Bhuj 7000 then a SYNTHETIC M7.2 (2000) in grace → L = 9000. */
export async function flowB(log: Log = console.log): Promise<FlowResult> {
  const w = await deployWorld("Flow B (two events, partial loss)", log);
  await readyFor(w, [BHUJ_FILE]);
  const bhuj = await attest(w, BHUJ_FILE);
  await submit(w, bhuj);
  await passWindow(w, bhuj.att.eventId);
  await execute(w, bhuj.att.eventId, "Executed");
  const U = await w.pool.unitsIssued();
  assert((await w.pool.claimable(w.sponsor.address)) === (U * 7_000n) / 10_000n, "sponsor credited exactly floor(U*7000/10000)");

  // Second quake submitted late in grace, so its window is still open after the deadline.
  const deadline = await w.trigger.submissionDeadline();
  await travelTo(deadline - DAY);
  await readyFor(w, [SYNTH_72_FILE]);
  const second = await attest(w, SYNTH_72_FILE);
  await submit(w, second);

  await expectRevert(w.pool.connect(w.holders.A).redeem(), w.pool, "RedemptionNotOpen");
  await step(w, "investor A", "redeem before submissionDeadline() → reverts RedemptionNotOpen");
  await afterDeadline(w);
  await expectRevert(w.pool.connect(w.holders.A).redeem(), w.pool, "EventPending");
  await step(w, "investor A", "redeem after the deadline with an event pending → reverts EventPending");

  await passWindow(w, second.att.eventId);
  await execute(w, second.att.eventId, "Executed");
  assert((await w.pool.appliedLossBps()) === 9_000n, "L == 9000");

  await redeemAndClaim(w);
  await claim(w, w.sponsor, "sponsor");
  return closeBooks(w);
}

/** Flow C — cap and Superseded: Bhuj (7000) + SYNTHETIC M7.5 (5000) + SYNTHETIC M7.3 (3000) pending together. */
export async function flowC(log: Log = console.log): Promise<FlowResult> {
  const w = await deployWorld("Flow C (cap + Superseded)", log);
  const files = [BHUJ_FILE, SYNTH_75_FILE, SYNTH_73_FILE];
  await readyFor(w, files);
  const atts = [];
  for (const f of files) {
    const a = await attest(w, f);
    await submit(w, a);
    atts.push(a);
  }
  for (const a of atts) await passWindow(w, a.att.eventId);
  await execute(w, atts[0].att.eventId, "Executed");
  await execute(w, atts[1].att.eventId, "Executed");
  assert((await w.pool.appliedLossBps()) === 10_000n, "L == min(10000, 7000 + 5000) == 10000");
  await execute(w, atts[2].att.eventId, "Superseded");

  await afterDeadline(w);
  await redeemAndClaim(w);
  return closeBooks(w);
}

/** Runs the three flows in order and returns their results. */
export async function runAll(log: Log = console.log): Promise<FlowResult[]> {
  return [await flowA(log), await flowB(log), await flowC(log)];
}

/** eventId of a fixture (for tests). */
export const eventIdOfFile = (file: string) => eventIdOf(loadFeature(file).id);
