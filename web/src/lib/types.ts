import type { EventStatus } from "./abi";
import type { AdvisoryMessage, AttestationMessage, Terms, UsgsFeature } from "./shared";

/** Every number the dashboard shows about one bond, read from the chain in one poll. */
export type BondSnapshot = {
  chainId: number;
  blockNumber: number;
  /** Chain time used for every rule below (pending block when the node offers one, else the latest block). */
  chainTime: number;
  /** Wall clock (ms) when this snapshot was read; the countdowns interpolate from here. */
  readAt: number;
  addresses: { pool: string; trigger: string; stablecoin: string; bond: string; sponsor: string; oracle: string };
  symbols: { stablecoin: string; bond: string; bondName: string };
  schedule: { issuanceStart: number; issuanceEnd: number; riskStart: number; maturity: number; grace: number; submissionDeadline: number };
  terms: { couponBps: number; cap: bigint; minTicket: bigint; challengeWindow: number; termsHash: string };
  trigger: { paused: boolean; pauseStart: number; totalPausedSeconds: number; pendingCount: number; effectiveTime: number };
  books: {
    unitsIssued: bigint;
    unitsRedeemed: bigint;
    appliedLossBps: number;
    sponsorCredited: bigint;
    couponReserve: bigint;
    couponReserveLeft: bigint;
    collateralLeft: bigint;
    principalPaid: bigint;
    couponPaid: bigint;
    totalClaimable: bigint;
    isSolvent: boolean;
    poolBalance: bigint;
    bondSupply: bigint;
    requiredReserveForCap: bigint;
  };
};

/** The connected wallet's position and permissions. */
export type AccountSnapshot = {
  address: string;
  bondBalance: bigint;
  principal: bigint;
  coupon: bigint;
  claimable: bigint;
  stableBalance: bigint;
  allowance: bigint;
  stableKyc: boolean | null;
  bondKyc: boolean | null;
  isSponsor: boolean;
  isTrustee: boolean;
  isAdmin: boolean;
};

export type ChainEventRecord = {
  eventId: string;
  status: EventStatus;
  lossBps: number;
  magnitudeX100: number;
  observedAt: number;
  usgsUpdatedAt: number;
  nonce: number;
  dataHash: string;
  windowStart: number;
  windowEndsAt: number;
  windowRemaining: number;
};

/** One decoded log with where and when it happened. */
export type LogEntry = {
  contract: "pool" | "trigger" | "bond";
  name: string;
  args: Record<string, unknown>;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  timestamp: number | null;
};

export type HcsEntry = {
  sequenceNumber: number;
  consensusTimestamp: string;
  payer: string | null;
  message: AttestationMessage | AdvisoryMessage | null;
  /** Why the bytes could not be read as a Faultline message (other topics share nothing with us, so this is rare). */
  parseError: string | null;
  /** In-payload signature recovers to trigger.oracle() (D16); null when there is nothing to check. */
  signedByOracle: boolean | null;
};

/** Terms as loaded from a terms file, with the result of checking termsHash against the chain. */
export type VerifiedTerms = { terms: Terms; matchesChain: boolean };

/** A USGS record from /api/usgs/[id]: live API, saved real fixture, or a SYNTHETIC fixture (never shown as real). */
export type UsgsRecord = { source: "live" | "saved" | "synthetic"; file: string | null; feature: UsgsFeature };
