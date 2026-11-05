// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFaultlinePool} from "../interfaces/IFaultlinePool.sol";

/// @title MockTrigger
/// @notice LOCAL TESTS ONLY. Minimal stand-in for FaultlineTrigger in pool unit tests: the pool reads `pool()`,
///         `pendingCount()` and `submissionDeadline()`, and only the trigger may call `applyLoss`. Values are set
///         directly by the test; no attestation logic. No real counterpart beyond those three views.
contract MockTrigger {
    /// @notice The pool this mock serves (checked by `pool.initialize`).
    address public immutable pool;
    /// @notice TEST HOOK value returned as the trigger's pending-event count.
    uint256 public pendingCount;
    /// @notice TEST HOOK value returned as the trigger's `submissionDeadline()` (D2).
    uint64 public submissionDeadline;

    /// @param pool_ The pool under test.
    constructor(address pool_) {
        pool = pool_;
    }

    /// @notice TEST HOOK: sets `pendingCount`.
    function test_setPendingCount(uint256 count) external {
        pendingCount = count;
    }

    /// @notice TEST HOOK: sets `submissionDeadline`.
    function test_setSubmissionDeadline(uint64 deadline) external {
        submissionDeadline = deadline;
    }

    /// @notice Calls `pool.applyLoss(cumulativeBps)` as the trigger.
    function forwardApplyLoss(uint16 cumulativeBps) external {
        IFaultlinePool(pool).applyLoss(cumulativeBps);
    }
}
