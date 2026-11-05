import { describe, expect, it } from "vitest";
import { canClaim, canExecute, canFundCoupons, canInvest, canPause, canRedeem, canSweep, canUnpause, canVeto, remainingAt, requiredReserve, type Guard } from "@/lib/guards";
import { phaseAt } from "@/lib/phase";
import type { AccountSnapshot, BondSnapshot, ChainEventRecord } from "@/lib/types";

const USD = 1_000_000n;
const T = { issuanceStart: 1_000, issuanceEnd: 2_000, riskStart: 2_000, maturity: 2_000 + 365 * 86_400, grace: 30 * 86_400 };
const deadline = T.maturity + T.grace;

function snap(over: { books?: Partial<BondSnapshot["books"]>; trigger?: Partial<BondSnapshot["trigger"]>; schedule?: Partial<BondSnapshot["schedule"]> } = {}): BondSnapshot {
  return {
    chainId: 31337,
    blockNumber: 1,
    chainTime: 0,
    readAt: 1_000_000,
    addresses: { pool: "0xp", trigger: "0xt", stablecoin: "0xs", bond: "0xb", sponsor: "0xS", oracle: "0xo" },
    symbols: { stablecoin: "mUSD", bond: "mFLB", bondName: "Mock" },
    schedule: { ...T, submissionDeadline: deadline, ...over.schedule },
    terms: { couponBps: 600, cap: 10_000n * USD, minTicket: 100n * USD, challengeWindow: 172_800, termsHash: "0x" },
    trigger: { paused: false, pauseStart: 0, totalPausedSeconds: 0, pendingCount: 0, effectiveTime: 0, ...over.trigger },
    books: {
      unitsIssued: 0n, unitsRedeemed: 0n, appliedLossBps: 0, sponsorCredited: 0n, couponReserve: 600n * USD, couponReserveLeft: 600n * USD, collateralLeft: 0n,
      principalPaid: 0n, couponPaid: 0n, totalClaimable: 0n, isSolvent: true, poolBalance: 0n, bondSupply: 0n, requiredReserveForCap: 600n * USD, ...over.books,
    },
  };
}
const acct = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  address: "0xA", bondBalance: 0n, principal: 0n, coupon: 0n, claimable: 0n, stableBalance: 10_000n * USD, allowance: 0n,
  stableKyc: true, bondKyc: true, isSponsor: false, isTrustee: false, isAdmin: false, ...over,
});
const W = { connected: true, rightChain: true };
const reason = (g: Guard) => (g.ok ? "ok" : g.reason);
const ev = (over: Partial<ChainEventRecord> = {}): ChainEventRecord => ({
  eventId: "0x1", status: "Pending", lossBps: 7000, magnitudeX100: 770, observedAt: 0, usgsUpdatedAt: 0, nonce: 1, dataHash: "0x", windowStart: 0, windowEndsAt: 0, windowRemaining: 100, ...over,
});

describe("requiredReserve mirrors the pool (ceil)", () => {
  it("full year at 6% on 10,000 USD is 600 USD; rounds up", () => {
    expect(requiredReserve(10_000n * USD, 600, T.riskStart, T.maturity)).toBe(600n * USD);
    expect(requiredReserve(1n, 600, 0, 1)).toBe(1n);
  });
});

describe("invest", () => {
  const now = 1_500;
  it("wallet and window first", () => {
    expect(reason(canInvest(snap(), null, { connected: false, rightChain: false }, 100n * USD, now))).toBe("Sign in with a wallet first.");
    expect(reason(canInvest(snap(), acct(), { connected: true, rightChain: false }, 100n * USD, now))).toBe("Switch the wallet to this dashboard's network.");
    expect(reason(canInvest(snap(), acct(), W, 100n * USD, 999))).toBe("The issuance window has not opened yet.");
    expect(reason(canInvest(snap(), acct(), W, 100n * USD, 2_000))).toBe("The issuance window is closed.");
  });
  it("cap, KYC, ticket, reserve, balance", () => {
    expect(reason(canInvest(snap({ books: { unitsIssued: 10_000n * USD } }), acct(), W, 100n * USD, now))).toBe("The bond is fully subscribed (cap reached).");
    expect(reason(canInvest(snap(), acct({ bondKyc: false }), W, 100n * USD, now))).toBe("This wallet does not have KYC on the bond.");
    expect(reason(canInvest(snap(), acct({ stableKyc: false }), W, 100n * USD, now))).toBe("This wallet does not have KYC for the stablecoin.");
    expect(reason(canInvest(snap(), acct(), W, null, now))).toBe("Enter an amount.");
    expect(reason(canInvest(snap(), acct(), W, 99n * USD, now))).toBe("The minimum ticket is 100.000000 USD.");
    expect(reason(canInvest(snap({ books: { unitsIssued: 9_950n * USD } }), acct(), W, 100n * USD, now))).toBe("Only 50.000000 USD of units are left under the cap.");
    expect(reason(canInvest(snap({ books: { couponReserve: 0n } }), acct(), W, 100n * USD, now))).toMatch(/coupon reserve does not cover/);
    expect(reason(canInvest(snap(), acct({ stableBalance: 5n * USD }), W, 100n * USD, now))).toBe("The wallet holds only 5.000000 USD.");
    expect(canInvest(snap(), acct(), W, 100n * USD, now)).toEqual({ ok: true });
  });
});

describe("redeem, claim and sweeps follow D2", () => {
  const after = deadline + 1;
  it("closed before the deadline, while paused, while pending", () => {
    expect(reason(canRedeem(snap(), acct({ bondBalance: 1n }), W, deadline))).toMatch(/^Redemption opens after the submission deadline/);
    expect(reason(canRedeem(snap({ trigger: { paused: true } }), acct({ bondBalance: 1n }), W, after))).toMatch(/paused/);
    expect(reason(canRedeem(snap({ trigger: { pendingCount: 1 } }), acct({ bondBalance: 1n }), W, after))).toMatch(/pending/);
    expect(reason(canRedeem(snap(), acct(), W, after))).toBe("This wallet holds no bond units.");
    expect(canRedeem(snap(), acct({ bondBalance: 1n }), W, after)).toEqual({ ok: true });
  });
  it("claim needs a balance and stablecoin KYC", () => {
    expect(reason(canClaim(acct(), W))).toBe("Nothing to claim for this wallet.");
    expect(reason(canClaim(acct({ claimable: 1n, stableKyc: false }), W))).toMatch(/KYC/);
    expect(canClaim(acct({ claimable: 1n }), W)).toEqual({ ok: true });
  });
  it("sweepDust also needs zero supply", () => {
    expect(canSweep(snap({ books: { bondSupply: 1n } }), W, acct(), after, false)).toEqual({ ok: true });
    expect(reason(canSweep(snap({ books: { bondSupply: 1n } }), W, acct(), after, true))).toMatch(/still outstanding/);
  });
  it("fundCoupons: sponsor only, before issuanceEnd", () => {
    expect(reason(canFundCoupons(snap(), acct(), W, USD, 1_500))).toBe("Only the sponsor wallet can fund the coupon reserve.");
    expect(reason(canFundCoupons(snap(), acct({ isSponsor: true }), W, USD, 2_000))).toBe("Coupon funding closed at the end of issuance.");
    expect(canFundCoupons(snap(), acct({ isSponsor: true }), W, USD, 1_500)).toEqual({ ok: true });
  });
});

describe("trustee actions", () => {
  it("veto: trustee, pending, inside the window (also while paused)", () => {
    expect(reason(canVeto(ev(), 10, acct(), W))).toBe("Only the trustee can veto.");
    expect(reason(canVeto(ev({ status: "Executed" }), 10, acct({ isTrustee: true }), W))).toBe("The event is Executed, not pending.");
    expect(reason(canVeto(ev(), 0, acct({ isTrustee: true }), W))).toBe("The challenge window has ended.");
    expect(canVeto(ev(), 10, acct({ isTrustee: true }), W)).toEqual({ ok: true });
  });
  it("execute: anyone, after the window, not paused", () => {
    expect(reason(canExecute(snap(), ev(), 5, acct(), W))).toBe("The challenge window is still running.");
    expect(reason(canExecute(snap({ trigger: { paused: true } }), ev(), 0, acct(), W))).toBe("The trigger is paused.");
    expect(canExecute(snap(), ev(), 0, acct(), W)).toEqual({ ok: true });
  });
  it("pause by the trustee, unpause by the admin only", () => {
    expect(canPause(snap(), acct({ isTrustee: true }), W)).toEqual({ ok: true });
    expect(reason(canPause(snap({ trigger: { paused: true } }), acct({ isTrustee: true }), W))).toBe("The trigger is already paused.");
    expect(reason(canUnpause(snap({ trigger: { paused: true } }), acct({ isTrustee: true }), W))).toBe("Only the admin can unpause.");
    expect(canUnpause(snap({ trigger: { paused: true } }), acct({ isAdmin: true }), W)).toEqual({ ok: true });
  });
  it("the countdown runs on wall time between polls and freezes while paused", () => {
    const s = snap();
    expect(remainingAt(ev({ windowRemaining: 100 }), s, s.readAt + 30_500)).toBe(70);
    expect(remainingAt(ev({ windowRemaining: 100 }), s, s.readAt + 500_000)).toBe(0);
    expect(remainingAt(ev({ windowRemaining: 100 }), snap({ trigger: { paused: true } }), s.readAt + 30_000)).toBe(100);
    expect(remainingAt(ev({ status: "Vetoed" }), s, s.readAt)).toBe(0);
  });
});

describe("phase", () => {
  it("walks the lifecycle at chain time", () => {
    expect(phaseAt(snap(), 999)).toBe("before-issuance");
    expect(phaseAt(snap(), 1_000)).toBe("issuance");
    expect(phaseAt(snap(), 2_000)).toBe("risk");
    expect(phaseAt(snap(), T.maturity + 1)).toBe("grace");
    expect(phaseAt(snap({ trigger: { paused: true } }), deadline + 10)).toBe("grace");
    expect(phaseAt(snap({ trigger: { pendingCount: 1 } }), deadline + 1)).toBe("redemption-blocked");
    expect(phaseAt(snap({ books: { unitsIssued: 5n, bondSupply: 5n } }), deadline + 1)).toBe("redemption");
    expect(phaseAt(snap({ books: { unitsIssued: 5n, bondSupply: 0n } }), deadline + 1)).toBe("closed");
    expect(phaseAt(snap({ schedule: { riskStart: 3_000 } }), 2_500)).toBe("awaiting-risk");
  });
});
