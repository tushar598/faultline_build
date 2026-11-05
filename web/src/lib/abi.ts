// Human-readable ABI fragments the dashboard reads and writes. They are subsets of the compiled artifacts:
// test/abi.test.ts checks every pool / trigger fragment against artifacts/ (and the bond fragments against MockBond,
// which copies the ATS v8 names) so the dashboard can never drift from the contracts.
import { Interface } from "ethers";

const ATT =
  "(bytes32 eventId, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, uint64 nonce, bytes32 termsHash, bytes32 dataHash, uint64 deadline)";

export const POOL_ABI = [
  // writes
  "function invest(uint256 units)",
  "function fundCoupons(uint256 amount)",
  "function redeem()",
  "function claim()",
  "function sweepExcess()",
  "function sweepDust()",
  "function initialize(address trigger_)",
  // schedule and terms
  "function stablecoin() view returns (address)",
  "function bond() view returns (address)",
  "function sponsor() view returns (address)",
  "function trigger() view returns (address)",
  "function issuanceStart() view returns (uint64)",
  "function issuanceEnd() view returns (uint64)",
  "function riskStart() view returns (uint64)",
  "function maturity() view returns (uint64)",
  "function grace() view returns (uint64)",
  "function couponBps() view returns (uint16)",
  "function cap() view returns (uint256)",
  "function minTicket() view returns (uint256)",
  // books
  "function unitsIssued() view returns (uint256)",
  "function unitsRedeemed() view returns (uint256)",
  "function appliedLossBps() view returns (uint16)",
  "function sponsorCredited() view returns (uint256)",
  "function couponReserve() view returns (uint256)",
  "function principalPaid() view returns (uint256)",
  "function couponPaid() view returns (uint256)",
  "function claimable(address account) view returns (uint256)",
  "function totalClaimable() view returns (uint256)",
  "function effectiveValue(address holder) view returns (uint256 principal, uint256 coupon)",
  "function requiredReserve(uint256 units) view returns (uint256)",
  "function collateralLeft() view returns (uint256)",
  "function couponReserveLeft() view returns (uint256)",
  "function isSolvent() view returns (bool)",
  // events
  "event CouponsFunded(address indexed sponsor, uint256 amount)",
  "event Invested(address indexed investor, uint256 units)",
  "event LossApplied(uint16 previousBps, uint16 newBps, uint256 sponsorCredit)",
  "event Redeemed(address indexed holder, uint256 units, uint256 principal, uint256 coupon)",
  "event Claimed(address indexed account, uint256 amount)",
  "event ExcessSwept(uint256 amount)",
  "event DustSwept(uint256 amount)",
  // errors
  "error AlreadyInitialized()",
  "error NotInitialized()",
  "error ZeroAddress()",
  "error TriggerMismatch()",
  "error OnlyTrigger()",
  "error OnlySponsor()",
  "error InvalidSchedule()",
  "error SupplyMismatch(uint256 actual, uint256 expected)",
  "error ZeroAmount()",
  "error IssuanceClosed()",
  "error IssuanceNotOpen()",
  "error BelowMinTicket(uint256 units, uint256 minTicket)",
  "error CapExceeded(uint256 requested, uint256 available)",
  "error CouponReserveInsufficient(uint256 have, uint256 need)",
  "error UnexpectedTransferAmount(uint256 expected, uint256 received)",
  "error LossNotIncreasing(uint16 applied, uint16 requested)",
  "error LossOutOfRange(uint16 bps)",
  "error RedemptionStarted()",
  "error RiskPeriodNotStarted()",
  "error RedemptionNotOpen()",
  "error EventPending()",
  "error NothingToRedeem()",
  "error NothingToClaim()",
  "error SupplyNotZero(uint256 supply)",
  "error NotKycForToken(address account)",
  "error HtsCallFailed(int64 responseCode)",
] as const;

export const TRIGGER_ABI = [
  // writes
  `function submit(${ATT} att, bytes sig)`,
  "function veto(bytes32 eventId)",
  "function execute(bytes32 eventId)",
  "function pause()",
  "function unpause()",
  // views
  "function pool() view returns (address)",
  "function termsHash() view returns (bytes32)",
  "function challengeWindow() view returns (uint64)",
  "function oracle() view returns (address)",
  "function paused() view returns (bool)",
  "function pauseStart() view returns (uint64)",
  "function totalPausedSeconds() view returns (uint64)",
  "function pendingCount() view returns (uint256)",
  "function effectiveTime() view returns (uint64)",
  "function submissionDeadline() view returns (uint64)",
  "function windowEndsAt(bytes32 eventId) view returns (uint64)",
  "function windowRemaining(bytes32 eventId) view returns (uint64)",
  "function getEventRecord(bytes32 eventId) view returns ((uint8 status, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, uint64 nonce, bytes32 dataHash, uint64 windowStart))",
  "function TRUSTEE_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  // events
  "event AttestationSubmitted(bytes32 indexed eventId, uint64 nonce, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, bytes32 dataHash, uint64 windowStart)",
  "event AttestationRevised(bytes32 indexed eventId, uint64 oldNonce, uint64 newNonce, uint16 oldBps, uint16 newBps)",
  "event EventVetoed(bytes32 indexed eventId, address indexed trustee)",
  "event EventExecuted(bytes32 indexed eventId, uint16 lossBps, uint16 newCumulativeBps)",
  "event EventSuperseded(bytes32 indexed eventId, uint16 lossBps)",
  "event TriggerPaused(address indexed by)",
  "event TriggerUnpaused(address indexed by, uint64 pausedFor)",
  "event OracleRotated(address indexed oldOracle, address indexed newOracle)",
  // errors
  "error InvalidSignature()",
  "error AttestationExpired(uint64 deadline)",
  "error ObservedOutsideRiskPeriod(uint64 observedAt)",
  "error TermsMismatch(bytes32 got)",
  "error LossOutOfRange(uint16 bps)",
  "error FullyWrittenDown()",
  "error SubmissionClosed()",
  "error EventFinalised(bytes32 eventId, uint8 status)",
  "error StaleRevision()",
  "error NotPending(bytes32 eventId)",
  "error WindowOpen(uint64 endsAt)",
  "error WindowClosed()",
  "error IsPaused()",
  "error NotPaused()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
] as const;

/** ERC-20 facade of the HTS stablecoin (and the parts of the ATS bond that are ERC-20). */
export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

/** ATS v8 bond: KYC status (IKyc.KycStatus: 0 NOT_GRANTED, 1 GRANTED) and the errors a mint can raise. */
export const BOND_ABI = [
  "function getKycStatusFor(address account) view returns (uint8)",
  "error IsPaused()",
  "error InvalidKycStatus()",
  "error MaxSupplyReached(uint256 maxSupply)",
  "error AccountHasNoRoles(address account, bytes32[] roles)",
  "error InsufficientBalance(address account, uint256 balance, uint256 value, bytes32 partition)",
] as const;

/** HTS system contract 0x167 (D11): the pool's own KYC pre-check, read with eth_call. */
export const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
export const HTS_ABI = ["function isKyc(address token, address account) returns (int64 responseCode, bool kycGranted)"] as const;

/** One Interface holding every error the dashboard can meet, for decoding revert data. */
export const ERRORS_IFACE = new Interface(
  [...POOL_ABI, ...TRIGGER_ABI, ...BOND_ABI].filter((f, i, all) => f.startsWith("error ") && all.indexOf(f) === i),
);

export const POOL_IFACE = new Interface(POOL_ABI);
export const TRIGGER_IFACE = new Interface(TRIGGER_ABI);
export const ERC20_IFACE = new Interface(ERC20_ABI);

/** FaultlineTrigger.Status in enum order. */
export const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"] as const;
export type EventStatus = (typeof STATUS)[number];
