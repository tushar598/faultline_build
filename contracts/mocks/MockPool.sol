// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFaultlineTrigger} from "../interfaces/IFaultlineTrigger.sol";

/// @title MockPool
/// @notice LOCAL TESTS ONLY. Stands in for FaultlinePool while FaultlineTrigger is built and tested before the pool
///         exists. It has only what the trigger reads or calls: the schedule (riskStart, maturity, grace),
///         `appliedLossBps`, and `applyLoss` with the real pool's checks (trigger only, from riskStart, at most 10000,
///         strictly increasing) and its sponsor-credit maths `floor(U * L / 10000)`. No tokens, no coupons, no
///         redemption: the trigger tests that need those run against the real pool once it exists.
contract MockPool {
    uint16 private constant BPS = 10_000;

    uint64 public immutable riskStart;
    uint64 public immutable maturity;
    uint64 public immutable grace;
    /// @notice Units issued (`U`), fixed at deploy; only used for the sponsor-credit maths.
    uint256 public immutable unitsIssued;

    address public trigger;
    uint16 public appliedLossBps;
    uint256 public sponsorCredited;

    /// @notice Same signature as IFaultlinePool.LossApplied.
    event LossApplied(uint16 previousBps, uint16 newBps, uint256 sponsorCredit);

    error AlreadyInitialized();
    error ZeroAddress();
    error TriggerMismatch();
    error OnlyTrigger();
    error RiskPeriodNotStarted();
    error LossOutOfRange(uint16 bps);
    error LossNotIncreasing(uint16 applied, uint16 requested);

    constructor(uint64 riskStart_, uint64 maturity_, uint64 grace_, uint256 unitsIssued_) {
        riskStart = riskStart_;
        maturity = maturity_;
        grace = grace_;
        unitsIssued = unitsIssued_;
    }

    /// @notice One-time wiring, as in the real pool: the trigger must point back at this pool.
    function initialize(address trigger_) external {
        if (trigger != address(0)) revert AlreadyInitialized();
        if (trigger_ == address(0)) revert ZeroAddress();
        if (IFaultlineTrigger(trigger_).pool() != address(this)) revert TriggerMismatch();
        trigger = trigger_;
    }

    /// @notice Same checks and order as FaultlinePool.applyLoss (minus the redemption check, there is no redemption).
    function applyLoss(uint16 cumulativeBps) external {
        if (msg.sender != trigger) revert OnlyTrigger();
        if (block.timestamp < riskStart) revert RiskPeriodNotStarted();
        if (cumulativeBps > BPS) revert LossOutOfRange(cumulativeBps);
        uint16 previous = appliedLossBps;
        if (cumulativeBps <= previous) revert LossNotIncreasing(previous, cumulativeBps);
        appliedLossBps = cumulativeBps;
        uint256 credited = Math.mulDiv(unitsIssued, cumulativeBps, BPS);
        uint256 credit = credited - sponsorCredited;
        sponsorCredited = credited;
        emit LossApplied(previous, cumulativeBps, credit);
    }
}
