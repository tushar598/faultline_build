// The repo's shared/ts helpers, used as-is by the dashboard (one source of truth with the oracle and the tests):
// HCS message decoding + in-payload signature checks (D16), termsHash (§6.3), dataHash (§6.4), eventId, the payout
// curve and the D14 replay guard (issuer page).
export {
  ADVISORY_ACTION,
  decodeMessage,
  recoverMessageSigner,
  verifyMessageSigner,
  type AdvisoryMessage,
  type AdvisoryReason,
  type AttestationMessage,
  type HcsMessage,
} from "../../../shared/ts/hcsMessage";
export {
  REPLAY_CHAIN_IDS,
  assertReplayAllowed,
  dataHash,
  eventIdOf,
  kutchTerms,
  lossBpsFor,
  observedAtOf,
  termsHash,
  type Terms,
  type UsgsFeature,
} from "../../../shared/ts/attestation";
export { canonicalize } from "../../../shared/ts/jcs";
