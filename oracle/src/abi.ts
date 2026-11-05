// The parts of the FaultlineTrigger / FaultlinePool ABI the oracle uses, as human-readable fragments. They are a
// subset of the compiled artifacts; test/abi.test.ts checks every fragment's selector against artifacts/ so the two
// can never drift apart.
const ATT = "(bytes32 eventId, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, uint64 nonce, bytes32 termsHash, bytes32 dataHash, uint64 deadline)";

export const TRIGGER_ABI = [
  `function submit(${ATT} att, bytes sig)`,
  "function execute(bytes32 eventId)",
  "function getEventRecord(bytes32 eventId) view returns ((uint8 status, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, uint64 nonce, bytes32 dataHash, uint64 windowStart))",
  "function windowRemaining(bytes32 eventId) view returns (uint64)",
  "function windowEndsAt(bytes32 eventId) view returns (uint64)",
  "function pendingCount() view returns (uint256)",
  "function paused() view returns (bool)",
  "function oracle() view returns (address)",
  "function pool() view returns (address)",
  "function termsHash() view returns (bytes32)",
  "function ATTESTATION_TYPEHASH() view returns (bytes32)",
  `function hashAttestation(${ATT} att) view returns (bytes32)`,
  "function submissionDeadline() view returns (uint64)",
  "function riskStart() view returns (uint64)",
  "function maturity() view returns (uint64)",
  "event AttestationSubmitted(bytes32 indexed eventId, uint64 nonce, uint16 lossBps, uint16 magnitudeX100, uint64 observedAt, uint64 usgsUpdatedAt, bytes32 dataHash, uint64 windowStart)",
  "error AttestationExpired(uint64 deadline)",
  "error EventFinalised(bytes32 eventId, uint8 status)",
  "error FullyWrittenDown()",
  "error InvalidSignature()",
  "error IsPaused()",
  "error LossOutOfRange(uint16 bps)",
  "error NotPending(bytes32 eventId)",
  "error ObservedOutsideRiskPeriod(uint64 observedAt)",
  "error StaleRevision()",
  "error SubmissionClosed()",
  "error TermsMismatch(bytes32 got)",
  "error WindowClosed()",
  "error WindowOpen(uint64 endsAt)",
] as const;

export const POOL_ABI = [
  "function appliedLossBps() view returns (uint16)",
  "function sponsorCredited() view returns (uint256)",
  "function unitsIssued() view returns (uint256)",
] as const;

/** FaultlineTrigger.Status, in enum order. */
export const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"] as const;
export type Status = (typeof STATUS)[number];
