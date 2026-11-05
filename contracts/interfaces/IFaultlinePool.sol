// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAtsBond} from "./IAtsBond.sol";

/// @title IFaultlinePool
/// @notice Collateral custody, issuance, loss index, coupon accrual, redemption and pull payments for one
///         Faultline bond (docs/ARCHITECTURE.md §3). Redemption and the sweeps open only after
///         `trigger.submissionDeadline()` (D2).
interface IFaultlinePool {
    /// @notice The admin wired the trigger and the pool associated with the stablecoin.
    event Initialized(address trigger);
    /// @notice The sponsor funded the coupon reserve.
    event CouponsFunded(address indexed sponsor, uint256 amount);
    /// @notice An investor paid `units` stablecoin base units and received `units` bond units.
    event Invested(address indexed investor, uint256 units);
    /// @notice The trigger raised the cumulative loss; `sponsorCredit` was credited to the sponsor.
    event LossApplied(uint16 previousBps, uint16 newBps, uint256 sponsorCredit);
    /// @notice A holder redeemed `units`; `principal + coupon` was credited to them.
    event Redeemed(address indexed holder, uint256 units, uint256 principal, uint256 coupon);
    /// @notice `account` withdrew `amount` of its claimable balance.
    event Claimed(address indexed account, uint256 amount);
    /// @notice `amount` of unused reserve was credited to the sponsor by `sweepExcess` (D3).
    event ExcessSwept(uint256 amount);
    /// @notice `amount` of final dust was credited to the sponsor by `sweepDust`.
    event DustSwept(uint256 amount);

    /// @notice `initialize` was already called.
    error AlreadyInitialized();
    /// @notice `initialize` has not been called yet.
    error NotInitialized();
    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice The trigger's `pool()` is not this pool.
    error TriggerMismatch();
    /// @notice Caller is not the trigger.
    error OnlyTrigger();
    /// @notice Caller is not the sponsor (D6).
    error OnlySponsor();
    /// @notice Constructor schedule or parameters are invalid (incl. grace above 365 days, D17).
    error InvalidSchedule();
    /// @notice Supply guard (D4): `bond.totalSupply()` differs from `unitsIssued - unitsRedeemed`.
    error SupplyMismatch(uint256 actual, uint256 expected);
    /// @notice A zero amount was given.
    error ZeroAmount();
    /// @notice The issuance window (or coupon funding window) is over.
    error IssuanceClosed();
    /// @notice The issuance window has not started.
    error IssuanceNotOpen();
    /// @notice `units < minTicket`.
    error BelowMinTicket(uint256 units, uint256 minTicket);
    /// @notice `unitsIssued + units > cap`.
    error CapExceeded(uint256 requested, uint256 available);
    /// @notice The coupon reserve does not cover the full term for the new supply.
    error CouponReserveInsufficient(uint256 have, uint256 need);
    /// @notice The stablecoin balance delta differs from the requested amount (fee-on-transfer, etc.).
    error UnexpectedTransferAmount(uint256 expected, uint256 received);
    /// @notice `applyLoss` with a value not above the applied loss.
    error LossNotIncreasing(uint16 applied, uint16 requested);
    /// @notice A loss above 10000 bps.
    error LossOutOfRange(uint16 bps);
    /// @notice `applyLoss` after the first redemption (defensive).
    error RedemptionStarted();
    /// @notice D12: `applyLoss` before `riskStart` (defence in depth; the real trigger already requires
    ///         `observedAt >= riskStart`, and `riskStart >= issuanceEnd`, so no loss can precede an `invest`).
    error RiskPeriodNotStarted();
    /// @notice Redemption or a sweep before `trigger.submissionDeadline()` (or while the trigger is paused).
    error RedemptionNotOpen();
    /// @notice The trigger has a pending event.
    error EventPending();
    /// @notice The caller holds no bond units.
    error NothingToRedeem();
    /// @notice The caller has nothing claimable.
    error NothingToClaim();
    /// @notice `sweepDust` while bond units are still outstanding.
    error SupplyNotZero(uint256 supply);
    /// @notice D11: HTS `isKyc` says `account` has no stablecoin KYC.
    error NotKycForToken(address account);
    /// @notice D11: an HTS call returned an unexpected response code (also used for `associate()` codes other
    ///         than 22 and 194).
    error HtsCallFailed(int64 responseCode);

    /// @notice Admin wires the trigger once and associates the pool with the stablecoin (HIP-719).
    function initialize(address trigger_) external;

    /// @notice Sponsor funds the coupon reserve before `issuanceEnd` (D6).
    function fundCoupons(uint256 amount) external;

    /// @notice KYC'd investor pays `units` stablecoin base units and receives `units` bond units.
    function invest(uint256 units) external;

    /// @notice Trigger only, from `riskStart` on (D12): raises the cumulative loss to `cumulativeBps` and credits
    ///         the sponsor.
    function applyLoss(uint16 cumulativeBps) external;

    /// @notice Holder burns its whole bond balance and is credited principal and coupon.
    function redeem() external;

    /// @notice Withdraws the caller's claimable balance (stablecoin KYC pre-checked on the caller and the pool, D11/D17).
    function claim() external;

    /// @notice Credits the sponsor with everything not owed to holders or claimants (D3).
    function sweepExcess() external;

    /// @notice Final cleanup once bond supply is zero: credits the remaining balance to the sponsor.
    function sweepDust() external;

    /// @notice HTS stablecoin (ERC-20 facade address), 6 decimals.
    function stablecoin() external view returns (IERC20);

    /// @notice ATS bond, 6 decimals, nominal 1 USD.
    function bond() external view returns (IAtsBond);

    /// @notice Receives write-down collateral, unused reserve and dust.
    function sponsor() external view returns (address);

    /// @notice Start of the subscription window.
    function issuanceStart() external view returns (uint64);

    /// @notice End of the subscription window (exclusive).
    function issuanceEnd() external view returns (uint64);

    /// @notice Start of the risk period; coupon accrues in `[riskStart, maturity]`.
    function riskStart() external view returns (uint64);

    /// @notice Bond maturity.
    function maturity() external view returns (uint64);

    /// @notice Grace seconds after maturity (the trigger adds paused time on top, D2).
    function grace() external view returns (uint64);

    /// @notice Annual coupon on original notional, basis points.
    function couponBps() external view returns (uint16);

    /// @notice Maximum units.
    function cap() external view returns (uint256);

    /// @notice Minimum units per `invest` call.
    function minTicket() external view returns (uint256);

    /// @notice The trigger, set once by `initialize`.
    function trigger() external view returns (address);

    /// @notice Units minted by the pool (`U`).
    function unitsIssued() external view returns (uint256);

    /// @notice Units burned by `redeem`.
    function unitsRedeemed() external view returns (uint256);

    /// @notice Cumulative loss `L`, 0..10000, never decreases.
    function appliedLossBps() external view returns (uint16);

    /// @notice Always `floor(U * L / 10000)`.
    function sponsorCredited() external view returns (uint256);

    /// @notice Total coupon reserve funded by the sponsor.
    function couponReserve() external view returns (uint256);

    /// @notice Coupon per original unit, scaled 1e18, at the last checkpoint.
    function couponIndex() external view returns (uint256);

    /// @notice Last accrual checkpoint (clamped to `[riskStart, maturity]`).
    function lastAccrual() external view returns (uint64);

    /// @notice Principal credited to holders at redemption.
    function principalPaid() external view returns (uint256);

    /// @notice Coupon credited to holders at redemption.
    function couponPaid() external view returns (uint256);

    /// @notice Pull balance of `account`.
    function claimable(address account) external view returns (uint256);

    /// @notice Sum of all `claimable` balances.
    function totalClaimable() external view returns (uint256);

    /// @notice What `holder`'s units are worth now: principal part and accrued coupon part
    ///         (view-only accrual to `min(now, maturity)`).
    function effectiveValue(address holder) external view returns (uint256 principal, uint256 coupon);

    /// @notice Coupon index with a view-only accrual to `min(now, maturity)`.
    function currentCouponIndex() external view returns (uint256);

    /// @notice `ceil(units * couponBps * (maturity - riskStart) / (10000 * YEAR))`.
    function requiredReserve(uint256 units) external view returns (uint256);

    /// @notice `U - sponsorCredited - principalPaid`.
    /// @dev Bookkeeping view only: it ignores amounts released by `sweepExcess`, so after a sweep use
    ///      `isSolvent()` (ARCHITECTURE §5 invariant 1, second form) for the real safety check.
    function collateralLeft() external view returns (uint256);

    /// @notice `couponReserve - couponPaid`.
    /// @dev Bookkeeping view only: it ignores unused reserve released by `sweepExcess`.
    function couponReserveLeft() external view returns (uint256);

    /// @notice Whether the stablecoin balance covers everything owed (invariant 1).
    function isSolvent() external view returns (bool);
}
