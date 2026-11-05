// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IFaultlineTrigger
/// @notice Attestation intake, challenge window, trustee veto and pause for one Faultline pool
///         (docs/ARCHITECTURE.md §4 and §6.1).
interface IFaultlineTrigger {
    /// @notice Lifecycle of one event. `Vetoed`, `Executed` and `Superseded` are terminal and permanent.
    enum Status {
        None,
        Pending,
        Vetoed,
        Executed,
        Superseded
    }

    /// @notice EIP-712 message signed by the oracle. Field names, types and order are fixed by
    ///         docs/ARCHITECTURE.md §6.1 and shared/attestation.eip712.json (test/interfaces.test.ts checks both).
    struct Attestation {
        /// @dev keccak256(utf8(USGS preferred event id)).
        bytes32 eventId;
        /// @dev Loss of this event only, 1..10000 (D1); the trigger aggregates `min(10000, L + lossBps)`.
        uint16 lossBps;
        /// @dev floor(magnitude * 100).
        uint16 magnitudeX100;
        /// @dev USGS origin time, unix seconds.
        uint64 observedAt;
        /// @dev USGS `updated`, unix seconds.
        uint64 usgsUpdatedAt;
        /// @dev Strictly increasing per eventId.
        uint64 nonce;
        /// @dev Must equal the trigger's immutable `termsHash`.
        bytes32 termsHash;
        /// @dev keccak256 of the canonical USGS record (§6.4).
        bytes32 dataHash;
        /// @dev Unix seconds; `submit` must happen no later than this.
        uint64 deadline;
    }

    /// @notice Stored state of one event.
    struct EventRecord {
        /// @dev Current status.
        Status status;
        /// @dev Loss of this event (latest revision).
        uint16 lossBps;
        /// @dev floor(magnitude * 100) of the latest revision.
        uint16 magnitudeX100;
        /// @dev USGS origin time.
        uint64 observedAt;
        /// @dev USGS `updated` of the latest revision.
        uint64 usgsUpdatedAt;
        /// @dev Nonce of the latest revision.
        uint64 nonce;
        /// @dev dataHash of the latest revision.
        bytes32 dataHash;
        /// @dev Effective (unpaused) time at which the current window started.
        uint64 windowStart;
    }

    /// @notice A new event entered `Pending`.
    event AttestationSubmitted(
        bytes32 indexed eventId,
        uint64 nonce,
        uint16 lossBps,
        uint16 magnitudeX100,
        uint64 observedAt,
        uint64 usgsUpdatedAt,
        bytes32 dataHash,
        uint64 windowStart
    );
    /// @notice A pending event was replaced by a newer attestation (higher nonce, newer USGS update).
    event AttestationRevised(bytes32 indexed eventId, uint64 oldNonce, uint64 newNonce, uint16 oldBps, uint16 newBps);
    /// @notice The trustee vetoed a pending event.
    event EventVetoed(bytes32 indexed eventId, address indexed trustee);
    /// @notice A pending event was executed and its loss applied to the pool.
    event EventExecuted(bytes32 indexed eventId, uint16 lossBps, uint16 newCumulativeBps);
    /// @notice A pending event was cleared without effect because the pool was already fully written down.
    event EventSuperseded(bytes32 indexed eventId, uint16 lossBps);
    /// @notice The trustee paused the trigger.
    event TriggerPaused(address indexed by);
    /// @notice The admin unpaused the trigger after `pausedFor` seconds.
    event TriggerUnpaused(address indexed by, uint64 pausedFor);
    /// @notice The admin replaced the oracle signer.
    event OracleRotated(address indexed oldOracle, address indexed newOracle);

    /// @notice The signature does not recover to the current oracle.
    error InvalidSignature();
    /// @notice `block.timestamp > deadline`.
    error AttestationExpired(uint64 deadline);
    /// @notice `observedAt` is outside `[riskStart, min(now, maturity)]`.
    error ObservedOutsideRiskPeriod(uint64 observedAt);
    /// @notice `termsHash` in the attestation differs from the trigger's.
    error TermsMismatch(bytes32 got);
    /// @notice `lossBps` is outside 1..10000.
    error LossOutOfRange(uint16 bps);
    /// @notice The pool's applied loss is already 10000.
    error FullyWrittenDown();
    /// @notice `block.timestamp > submissionDeadline()`.
    error SubmissionClosed();
    /// @notice The event is in a terminal status and can never be submitted again.
    error EventFinalised(bytes32 eventId, Status status);
    /// @notice A revision does not have a higher nonce and a newer `usgsUpdatedAt`.
    error StaleRevision();
    /// @notice The event is not `Pending`.
    error NotPending(bytes32 eventId);
    /// @notice `execute` before the window is complete.
    error WindowOpen(uint64 endsAt);
    /// @notice `veto` after the window is complete.
    error WindowClosed();
    /// @notice The call is not allowed while the trigger is paused.
    error IsPaused();
    /// @notice `unpause` while not paused.
    error NotPaused();
    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice The schedule read from the pool or the window is invalid (window 0 or above 30 days, D17).
    error InvalidSchedule();

    /// @notice Accepts a signed attestation (relayed by anyone): new event or revision of a pending one.
    function submit(Attestation calldata att, bytes calldata sig) external;

    /// @notice Trustee vetoes a pending event inside its window; allowed while paused.
    function veto(bytes32 eventId) external;

    /// @notice Anyone executes a pending event after its window: applies `min(10000, L + lossBps)` or
    ///         marks it `Superseded` when `L == 10000`.
    function execute(bytes32 eventId) external;

    /// @notice Trustee pauses the trigger (stops `submit` and `execute`; the window clock stops).
    function pause() external;

    /// @notice Admin unpauses the trigger.
    function unpause() external;

    /// @notice Admin rotates the oracle signer.
    function setOracle(address newOracle) external;

    /// @notice Role id of the trustee: keccak256("TRUSTEE_ROLE"). Its own admin role (D17): only trustees add or remove
    ///         trustees.
    function TRUSTEE_ROLE() external view returns (bytes32);

    /// @notice EIP-712 type hash of `Attestation` (§6.1), for the oracle and the dashboard to check against
    ///         shared/attestation.eip712.json.
    function ATTESTATION_TYPEHASH() external view returns (bytes32);

    /// @notice The one pool this trigger serves.
    function pool() external view returns (address);

    /// @notice Hash of the canonical trigger terms JSON (§6.3).
    function termsHash() external view returns (bytes32);

    /// @notice Seconds of unpaused time between submit and execute.
    function challengeWindow() external view returns (uint64);

    /// @notice Start of the risk period (copied from the pool).
    function riskStart() external view returns (uint64);

    /// @notice Bond maturity (copied from the pool).
    function maturity() external view returns (uint64);

    /// @notice Grace seconds after maturity (copied from the pool).
    function grace() external view returns (uint64);

    /// @notice Current oracle signer.
    function oracle() external view returns (address);

    /// @notice Whether the trigger is paused.
    function paused() external view returns (bool);

    /// @notice Timestamp at which the current pause started (0 if never paused).
    function pauseStart() external view returns (uint64);

    /// @notice Sum of all completed pauses, in seconds.
    function totalPausedSeconds() external view returns (uint64);

    /// @notice Number of events in `Pending`.
    function pendingCount() external view returns (uint256);

    /// @notice `(paused ? pauseStart : block.timestamp) - totalPausedSeconds`.
    function effectiveTime() external view returns (uint64);

    /// @notice `maturity + grace + totalPausedSeconds + running pause` (D2): submissions close and redemption
    ///         opens after this moment.
    function submissionDeadline() external view returns (uint64);

    /// @notice Effective time at which the event's window completes.
    function windowEndsAt(bytes32 eventId) external view returns (uint64);

    /// @notice Effective seconds left in the event's window (0 when complete).
    function windowRemaining(bytes32 eventId) external view returns (uint64);

    /// @notice Stored record of `eventId`.
    function getEventRecord(bytes32 eventId) external view returns (EventRecord memory);

    /// @notice EIP-712 digest of `att` for this trigger (for the oracle and tests).
    function hashAttestation(Attestation calldata att) external view returns (bytes32);
}
