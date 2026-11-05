// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ApplyLossRecorder
/// @notice LOCAL TESTS ONLY. Records `applyLoss` calls so the MockTrigger forwarding can be tested before
///         FaultlinePool exists. No real counterpart.
contract ApplyLossRecorder {
    /// @notice Last caller of `applyLoss`.
    address public lastCaller;
    /// @notice Last value passed to `applyLoss`.
    uint16 public lastBps;

    /// @notice Records the call.
    function applyLoss(uint16 cumulativeBps) external {
        lastCaller = msg.sender;
        lastBps = cumulativeBps;
    }
}
