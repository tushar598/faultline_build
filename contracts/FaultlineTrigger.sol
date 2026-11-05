// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IFaultlinePool} from "./interfaces/IFaultlinePool.sol";
import {IFaultlineTrigger} from "./interfaces/IFaultlineTrigger.sol";

/// @title FaultlineTrigger
/// @notice Attestation intake, challenge window, trustee veto and pause for one FaultlinePool
///         (docs/ARCHITECTURE.md §4, §6.1). The oracle signs one EIP-712 attestation per quake with the loss of that
///         event only (D1); anyone relays it with `submit`; after a window of unpaused time anyone `execute`s it and
///         the pool's cumulative loss becomes `min(10000, L + lossBps)`. The trustee can veto inside the window
///         (also while paused) and pause; only the admin unpauses and rotates the oracle.
/// @dev Event status is permanent once Vetoed, Executed or Superseded, so a public signature can never be replayed.
///      The window and the submission cutoff are measured so that a pause never consumes them (D2):
///      `effectiveTime()` stops while paused and `submissionDeadline()` moves with every paused second. Holds no
///      HBAR: no `receive()`, nothing payable.
contract FaultlineTrigger is IFaultlineTrigger, AccessControl, EIP712 {
    /// @inheritdoc IFaultlineTrigger
    bytes32 public constant TRUSTEE_ROLE = keccak256("TRUSTEE_ROLE");
    /// @inheritdoc IFaultlineTrigger
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 eventId,uint16 lossBps,uint16 magnitudeX100,uint64 observedAt,uint64 usgsUpdatedAt,"
        "uint64 nonce,bytes32 termsHash,bytes32 dataHash,uint64 deadline)"
    );
    /// @dev 100 % in basis points.
    uint16 private constant MAX_BPS = 10_000;
    /// @dev D17 (SEC-03): upper bound of `challengeWindow`, so `windowStart + challengeWindow` can never overflow.
    uint64 private constant MAX_CHALLENGE_WINDOW = 30 days;

    /// @inheritdoc IFaultlineTrigger
    address public immutable pool;
    /// @inheritdoc IFaultlineTrigger
    bytes32 public immutable termsHash;
    /// @inheritdoc IFaultlineTrigger
    uint64 public immutable challengeWindow;
    /// @inheritdoc IFaultlineTrigger
    uint64 public immutable riskStart;
    /// @inheritdoc IFaultlineTrigger
    uint64 public immutable maturity;
    /// @inheritdoc IFaultlineTrigger
    uint64 public immutable grace;

    /// @inheritdoc IFaultlineTrigger
    address public oracle;
    /// @inheritdoc IFaultlineTrigger
    bool public paused;
    /// @inheritdoc IFaultlineTrigger
    uint64 public pauseStart;
    /// @inheritdoc IFaultlineTrigger
    uint64 public totalPausedSeconds;
    /// @inheritdoc IFaultlineTrigger
    uint256 public pendingCount;

    /// @dev Per-eventId record. Private: read through `getEventRecord` (a public `getEvent` would clash with ethers).
    mapping(bytes32 eventId => EventRecord) private _events;

    /// @param pool_ The pool this trigger serves; its schedule (riskStart, maturity, grace) is copied here (D5).
    /// @param termsHash_ keccak256 of the canonical terms JSON (§6.3); every attestation must carry it.
    /// @param challengeWindow_ Seconds of unpaused time between submit and execute; 1 to 30 days (D17).
    /// @param oracle_ Initial attestation signer.
    /// @param admin Gets `DEFAULT_ADMIN_ROLE` (unpause, setOracle). It cannot add or remove trustees (D17).
    /// @param trustee Gets `TRUSTEE_ROLE` (veto, pause). TRUSTEE_ROLE is its own admin (D17, SEC-01): trustees add a
    ///        backup trustee and remove each other themselves, so the admin can never take the veto away.
    constructor(
        address pool_,
        bytes32 termsHash_,
        uint64 challengeWindow_,
        address oracle_,
        address admin,
        address trustee
    ) EIP712("FaultlineTrigger", "1") {
        if (pool_ == address(0) || oracle_ == address(0) || admin == address(0) || trustee == address(0)) {
            revert ZeroAddress();
        }
        if (challengeWindow_ == 0 || challengeWindow_ > MAX_CHALLENGE_WINDOW) revert InvalidSchedule();
        pool = pool_;
        termsHash = termsHash_;
        challengeWindow = challengeWindow_;
        riskStart = IFaultlinePool(pool_).riskStart();
        maturity = IFaultlinePool(pool_).maturity();
        grace = IFaultlinePool(pool_).grace();
        oracle = oracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE);
        _grantRole(TRUSTEE_ROLE, trustee);
    }

    // ---------------------------------------------------------------- attestation intake

    /// @inheritdoc IFaultlineTrigger
    /// @dev Checks, in order: not paused (D2); `now <= submissionDeadline()`; signature by the oracle; `now <=
    ///      deadline`; `riskStart <= observedAt <= min(now, maturity)`; terms; `1 <= lossBps <= 10000`; status (a
    ///      terminal event reverts `EventFinalised`, a pending one needs a higher nonce AND a newer `usgsUpdatedAt`);
    ///      pool not fully written down. A revision may lower the loss and restarts the window.
    function submit(Attestation calldata att, bytes calldata sig) external {
        if (paused) revert IsPaused();
        if (block.timestamp > submissionDeadline()) revert SubmissionClosed();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hashAttestation(att), sig);
        if (err != ECDSA.RecoverError.NoError || signer != oracle) revert InvalidSignature();
        if (block.timestamp > att.deadline) revert AttestationExpired(att.deadline);
        if (att.observedAt < riskStart || att.observedAt > Math.min(block.timestamp, maturity)) {
            revert ObservedOutsideRiskPeriod(att.observedAt);
        }
        if (att.termsHash != termsHash) revert TermsMismatch(att.termsHash);
        if (att.lossBps == 0 || att.lossBps > MAX_BPS) revert LossOutOfRange(att.lossBps);

        EventRecord storage e = _events[att.eventId];
        Status status = e.status;
        if (status == Status.Pending) {
            if (att.nonce <= e.nonce || att.usgsUpdatedAt <= e.usgsUpdatedAt) revert StaleRevision();
        } else if (status != Status.None) {
            revert EventFinalised(att.eventId, status);
        }
        if (IFaultlinePool(pool).appliedLossBps() >= MAX_BPS) revert FullyWrittenDown();

        uint64 windowStart = effectiveTime();
        if (status == Status.None) {
            e.status = Status.Pending;
            ++pendingCount;
        } else {
            emit AttestationRevised(att.eventId, e.nonce, att.nonce, e.lossBps, att.lossBps);
        }
        e.lossBps = att.lossBps;
        e.magnitudeX100 = att.magnitudeX100;
        e.observedAt = att.observedAt;
        e.usgsUpdatedAt = att.usgsUpdatedAt;
        e.nonce = att.nonce;
        e.dataHash = att.dataHash;
        e.windowStart = windowStart;
        emit AttestationSubmitted(
            att.eventId,
            att.nonce,
            att.lossBps,
            att.magnitudeX100,
            att.observedAt,
            att.usgsUpdatedAt,
            att.dataHash,
            windowStart
        );
    }

    /// @inheritdoc IFaultlineTrigger
    /// @dev Only while the window is still open in effective time, so a pause (which stops effective time) keeps
    ///      the veto available. A vetoed event is final.
    function veto(bytes32 eventId) external onlyRole(TRUSTEE_ROLE) {
        EventRecord storage e = _requirePending(eventId);
        if (effectiveTime() >= e.windowStart + challengeWindow) revert WindowClosed();
        e.status = Status.Vetoed;
        --pendingCount;
        emit EventVetoed(eventId, msg.sender);
    }

    /// @inheritdoc IFaultlineTrigger
    /// @dev Status and `pendingCount` are final before the pool call. If the pool is already at 10000 the event is
    ///      `Superseded` without a revert, so it can never block redemption.
    function execute(bytes32 eventId) external {
        if (paused) revert IsPaused();
        EventRecord storage e = _requirePending(eventId);
        uint64 endsAt = e.windowStart + challengeWindow;
        if (effectiveTime() < endsAt) revert WindowOpen(endsAt);
        --pendingCount;

        uint16 applied = IFaultlinePool(pool).appliedLossBps();
        if (applied >= MAX_BPS) {
            e.status = Status.Superseded;
            emit EventSuperseded(eventId, e.lossBps);
            return;
        }
        e.status = Status.Executed;
        uint16 cumulative = uint16(Math.min(MAX_BPS, uint256(applied) + e.lossBps));
        IFaultlinePool(pool).applyLoss(cumulative);
        emit EventExecuted(eventId, e.lossBps, cumulative);
    }

    // ---------------------------------------------------------------- pause and admin

    /// @inheritdoc IFaultlineTrigger
    function pause() external onlyRole(TRUSTEE_ROLE) {
        if (paused) revert IsPaused();
        paused = true;
        pauseStart = SafeCast.toUint64(block.timestamp);
        emit TriggerPaused(msg.sender);
    }

    /// @inheritdoc IFaultlineTrigger
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!paused) revert NotPaused();
        uint64 pausedFor = SafeCast.toUint64(block.timestamp) - pauseStart;
        totalPausedSeconds += pausedFor;
        paused = false;
        emit TriggerUnpaused(msg.sender, pausedFor);
    }

    /// @inheritdoc IFaultlineTrigger
    /// @dev Pending events stay valid: their signatures were verified at submit.
    function setOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleRotated(oracle, newOracle);
        oracle = newOracle;
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IFaultlineTrigger
    function effectiveTime() public view returns (uint64) {
        uint64 clock = paused ? pauseStart : SafeCast.toUint64(block.timestamp);
        return clock - totalPausedSeconds;
    }

    /// @inheritdoc IFaultlineTrigger
    /// @dev A pause that starts before the deadline moves it with the clock (redemption stays closed); one that
    ///      starts after it keeps it below `now` (ARCHITECTURE §4.2).
    function submissionDeadline() public view returns (uint64) {
        uint64 running = paused ? SafeCast.toUint64(block.timestamp) - pauseStart : 0;
        return maturity + grace + totalPausedSeconds + running;
    }

    /// @inheritdoc IFaultlineTrigger
    function windowEndsAt(bytes32 eventId) external view returns (uint64) {
        return _events[eventId].windowStart + challengeWindow;
    }

    /// @inheritdoc IFaultlineTrigger
    function windowRemaining(bytes32 eventId) external view returns (uint64) {
        uint64 endsAt = _events[eventId].windowStart + challengeWindow;
        uint64 nowEffective = effectiveTime();
        return endsAt > nowEffective ? endsAt - nowEffective : 0;
    }

    /// @inheritdoc IFaultlineTrigger
    function getEventRecord(bytes32 eventId) external view returns (EventRecord memory) {
        return _events[eventId];
    }

    /// @inheritdoc IFaultlineTrigger
    /// @dev `abi.encode(ATTESTATION_TYPEHASH, att)`: the struct has only static fields, so this is exactly the
    ///      EIP-712 `encodeData` (each field as one 32-byte word, in declaration order).
    function hashAttestation(Attestation calldata att) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, att)));
    }

    // ---------------------------------------------------------------- internals

    /// @dev Storage pointer to a Pending event; reverts `NotPending(eventId)` otherwise.
    function _requirePending(bytes32 eventId) private view returns (EventRecord storage e) {
        e = _events[eventId];
        if (e.status != Status.Pending) revert NotPending(eventId);
    }
}
