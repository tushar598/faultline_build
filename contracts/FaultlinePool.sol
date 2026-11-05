// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAtsBond} from "./interfaces/IAtsBond.sol";
import {IFaultlinePool} from "./interfaces/IFaultlinePool.sol";
import {IFaultlineTrigger} from "./interfaces/IFaultlineTrigger.sol";
import {IHRC719} from "./interfaces/IHRC719.sol";
import {
    IHederaTokenServiceLite,
    HTS_PRECOMPILE,
    HTS_SUCCESS,
    TOKEN_ALREADY_ASSOCIATED
} from "./interfaces/IHederaTokenServiceLite.sol";

/// @title FaultlinePool
/// @notice Collateral custody, issuance, global loss index, coupon accrual, redemption and pull payments for one
///         Faultline catastrophe bond (docs/ARCHITECTURE.md §3). One bond unit is one stablecoin base unit of
///         original notional; a write-down raises the cumulative loss `L` instead of burning holders' units, so
///         every operation is O(1). Units are burned only at redemption, through ATS `controllerRedeem`.
/// @dev Rounding always goes against the holder (floors on every holder payout, ceil on the required reserve),
///      so the sum of payouts can never exceed what the pool holds; the dust goes to the sponsor. Every payout is
///      a pull: amounts are credited to `claimable` and withdrawn with `claim()`, so a frozen or non-KYC'd
///      recipient never blocks anyone else. Holds no HBAR: no `receive()`, nothing payable.
contract FaultlinePool is IFaultlinePool, AccessControl, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Constructor parameters (a struct keeps the constructor below the stack limit).
    struct Params {
        /// @dev Gets `DEFAULT_ADMIN_ROLE`; calls `initialize` once (D5).
        address admin;
        /// @dev HTS stablecoin (ERC-20 facade address), 6 decimals.
        IERC20 stablecoin;
        /// @dev ATS bond, 6 decimals, nominal 1 USD; the pool must hold its `ROLE_ISSUER` and `ROLE_CONTROLLER`.
        IAtsBond bond;
        /// @dev Receives write-down collateral, unused reserve and dust.
        address sponsor;
        /// @dev Start of the subscription window (inclusive).
        uint64 issuanceStart;
        /// @dev End of the subscription window (exclusive); also the end of coupon funding (D6).
        uint64 issuanceEnd;
        /// @dev Start of the risk period and of coupon accrual.
        uint64 riskStart;
        /// @dev Bond maturity; coupon accrual stops here.
        uint64 maturity;
        /// @dev Seconds after maturity before submissions close (the trigger adds paused time, D2).
        uint64 grace;
        /// @dev Annual coupon on original notional, basis points.
        uint16 couponBps;
        /// @dev Maximum units the pool may issue.
        uint256 cap;
        /// @dev Minimum units per `invest` call.
        uint256 minTicket;
    }

    /// @dev Basis points in 100 %.
    uint256 private constant BPS = 10_000;
    /// @dev Coupon year (ARCHITECTURE §3.3).
    uint256 private constant YEAR = 365 days;
    /// @dev Scale of `couponIndex`.
    uint256 private constant INDEX_SCALE = 1e18;
    /// @dev Decimals required of both the stablecoin and the bond (1 unit = 1 stablecoin base unit).
    uint8 private constant DECIMALS = 6;
    /// @dev D17 (SEC-03): upper bound of `grace`, so `submissionDeadline()` can never overflow.
    uint64 private constant MAX_GRACE = 365 days;

    /// @inheritdoc IFaultlinePool
    IERC20 public immutable stablecoin;
    /// @inheritdoc IFaultlinePool
    IAtsBond public immutable bond;
    /// @inheritdoc IFaultlinePool
    address public immutable sponsor;
    /// @inheritdoc IFaultlinePool
    uint64 public immutable issuanceStart;
    /// @inheritdoc IFaultlinePool
    uint64 public immutable issuanceEnd;
    /// @inheritdoc IFaultlinePool
    uint64 public immutable riskStart;
    /// @inheritdoc IFaultlinePool
    uint64 public immutable maturity;
    /// @inheritdoc IFaultlinePool
    uint64 public immutable grace;
    /// @inheritdoc IFaultlinePool
    uint16 public immutable couponBps;
    /// @inheritdoc IFaultlinePool
    uint256 public immutable cap;
    /// @inheritdoc IFaultlinePool
    uint256 public immutable minTicket;

    /// @inheritdoc IFaultlinePool
    address public trigger;
    /// @inheritdoc IFaultlinePool
    uint16 public appliedLossBps;
    /// @inheritdoc IFaultlinePool
    uint64 public lastAccrual;
    /// @inheritdoc IFaultlinePool
    uint256 public unitsIssued;
    /// @inheritdoc IFaultlinePool
    uint256 public unitsRedeemed;
    /// @inheritdoc IFaultlinePool
    uint256 public sponsorCredited;
    /// @inheritdoc IFaultlinePool
    uint256 public couponReserve;
    /// @inheritdoc IFaultlinePool
    uint256 public couponIndex;
    /// @inheritdoc IFaultlinePool
    uint256 public principalPaid;
    /// @inheritdoc IFaultlinePool
    uint256 public couponPaid;
    /// @inheritdoc IFaultlinePool
    mapping(address account => uint256) public claimable;
    /// @inheritdoc IFaultlinePool
    uint256 public totalClaimable;

    /// @param p Immutables and the admin. Reverts `ZeroAddress` for a zero admin, stablecoin, bond or sponsor;
    ///          `InvalidSchedule` unless `issuanceStart < issuanceEnd <= riskStart < maturity`, `0 < grace <= 365 days`,
    ///          `couponBps`, `cap` and `minTicket` are non-zero and both tokens have 6 decimals.
    constructor(Params memory p) {
        if (
            p.admin == address(0) || address(p.stablecoin) == address(0) || address(p.bond) == address(0)
                || p.sponsor == address(0)
        ) revert ZeroAddress();
        if (
            p.issuanceStart >= p.issuanceEnd || p.issuanceEnd > p.riskStart || p.riskStart >= p.maturity
                || p.grace == 0 || p.grace > MAX_GRACE
        ) revert InvalidSchedule();
        if (p.couponBps == 0 || p.cap == 0 || p.minTicket == 0) revert InvalidSchedule();
        if (p.bond.decimals() != DECIMALS || IERC20Metadata(address(p.stablecoin)).decimals() != DECIMALS) {
            revert InvalidSchedule();
        }

        stablecoin = p.stablecoin;
        bond = p.bond;
        sponsor = p.sponsor;
        issuanceStart = p.issuanceStart;
        issuanceEnd = p.issuanceEnd;
        riskStart = p.riskStart;
        maturity = p.maturity;
        grace = p.grace;
        couponBps = p.couponBps;
        cap = p.cap;
        minTicket = p.minTicket;
        lastAccrual = p.riskStart;
        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
    }

    // ---------------------------------------------------------------- setup

    /// @inheritdoc IFaultlinePool
    /// @dev Calls HIP-719 `associate()` exactly once: a repeat returns 194 but costs ~730k gas on testnet (S3).
    ///      22 and 194 count as success; any other code reverts `HtsCallFailed(code)`.
    function initialize(address trigger_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (trigger != address(0)) revert AlreadyInitialized();
        if (trigger_ == address(0)) revert ZeroAddress();
        if (IFaultlineTrigger(trigger_).pool() != address(this)) revert TriggerMismatch();
        trigger = trigger_;

        int64 code = SafeCast.toInt64(SafeCast.toInt256(IHRC719(address(stablecoin)).associate()));
        if (code != HTS_SUCCESS && code != TOKEN_ALREADY_ASSOCIATED) revert HtsCallFailed(code);
        emit Initialized(trigger_);
    }

    /// @inheritdoc IFaultlinePool
    /// @dev Sponsor only (D6), before `issuanceEnd`; KYC pre-check on the sponsor and the pool (D11).
    function fundCoupons(uint256 amount) external nonReentrant {
        if (msg.sender != sponsor) revert OnlySponsor();
        if (block.timestamp >= issuanceEnd) revert IssuanceClosed();
        if (amount == 0) revert ZeroAmount();
        _requireKyc(msg.sender);
        _requireKyc(address(this));

        _pull(msg.sender, amount);
        couponReserve += amount;
        emit CouponsFunded(msg.sender, amount);
    }

    // ---------------------------------------------------------------- issuance

    /// @inheritdoc IFaultlinePool
    /// @dev In `[issuanceStart, issuanceEnd)`, `units >= minTicket`, within `cap`, only while the reserve covers
    ///      the full-term coupon of the new supply; supply guard (D4) and KYC pre-check (D11) before any transfer.
    ///      The bond itself also requires the investor's ATS KYC (`InvalidKycStatus` otherwise).
    function invest(uint256 units) external nonReentrant {
        if (trigger == address(0)) revert NotInitialized();
        if (block.timestamp < issuanceStart) revert IssuanceNotOpen();
        if (block.timestamp >= issuanceEnd) revert IssuanceClosed();
        if (units < minTicket) revert BelowMinTicket(units, minTicket);
        uint256 issued = unitsIssued;
        if (issued + units > cap) revert CapExceeded(units, cap - issued);
        uint256 need = requiredReserve(issued + units);
        if (couponReserve < need) revert CouponReserveInsufficient(couponReserve, need);
        _checkSupply();
        _requireKyc(msg.sender);
        _requireKyc(address(this));

        _pull(msg.sender, units);
        unitsIssued = issued + units;
        bond.mint(msg.sender, units);
        emit Invested(msg.sender, units);
    }

    // ---------------------------------------------------------------- write-down

    /// @inheritdoc IFaultlinePool
    /// @dev Checkpoints the coupon index at the old `L` first, so a loss lowers accrual from the moment it is
    ///      applied (D7). The sponsor credit is computed from the cumulative loss, so any sequence of events
    ///      reaching `L` credits exactly `floor(U * L / 10000)`.
    function applyLoss(uint16 cumulativeBps) external {
        if (msg.sender != trigger) revert OnlyTrigger();
        if (block.timestamp < riskStart) revert RiskPeriodNotStarted();
        if (cumulativeBps > BPS) revert LossOutOfRange(cumulativeBps);
        uint16 previous = appliedLossBps;
        if (cumulativeBps <= previous) revert LossNotIncreasing(previous, cumulativeBps);
        if (unitsRedeemed != 0) revert RedemptionStarted();

        _accrue();
        appliedLossBps = cumulativeBps;
        uint256 credited = Math.mulDiv(unitsIssued, cumulativeBps, BPS);
        uint256 credit = credited - sponsorCredited;
        sponsorCredited = credited;
        _credit(sponsor, credit);
        emit LossApplied(previous, cumulativeBps, credit);
    }

    // ---------------------------------------------------------------- maturity

    /// @inheritdoc IFaultlinePool
    /// @dev After `trigger.submissionDeadline()` with no pending event (D2), supply guard (D4). Credits
    ///      `floor(b * (10000 - L) / 10000) + floor(b * couponIndex / 1e18)` and burns all `b` units. No KYC
    ///      check on the holder: ATS `controllerRedeem` has none either (S1), only `claim()` needs stablecoin KYC.
    function redeem() external nonReentrant {
        _requireRedemptionOpen();
        _checkSupply();
        uint256 units = bond.balanceOf(msg.sender);
        if (units == 0) revert NothingToRedeem();

        _accrue();
        uint256 principal = Math.mulDiv(units, BPS - appliedLossBps, BPS);
        uint256 coupon = Math.mulDiv(units, couponIndex, INDEX_SCALE);
        unitsRedeemed += units;
        principalPaid += principal;
        couponPaid += coupon;
        _credit(msg.sender, principal + coupon);
        bond.controllerRedeem(msg.sender, units, "", "");
        emit Redeemed(msg.sender, units, principal, coupon);
    }

    /// @inheritdoc IFaultlinePool
    /// @dev KYC pre-check (D11) on the recipient and, since D17 (SEC-04), on the pool itself; the balance is zeroed
    ///      before the transfer (CEI). A frozen account still fails with the facade's empty revert, and keeps its
    ///      balance.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        _requireKyc(msg.sender);
        _requireKyc(address(this));

        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        stablecoin.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @inheritdoc IFaultlinePool
    /// @dev D3. Same gates as `redeem`. Owes every outstanding unit its floor-rounded principal and coupon; since a
    ///      sum of per-holder floors never exceeds the floor of the sum, later redemptions stay covered. Credits
    ///      `max(0, balance - totalClaimable - owed)`; a second call credits 0.
    function sweepExcess() external {
        _requireRedemptionOpen();
        _checkSupply();
        _accrue();
        uint256 outstanding = unitsIssued - unitsRedeemed;
        uint256 owed =
            Math.mulDiv(outstanding, BPS - appliedLossBps, BPS) + Math.mulDiv(outstanding, couponIndex, INDEX_SCALE);
        uint256 amount = _surplus(totalClaimable + owed);
        _credit(sponsor, amount);
        emit ExcessSwept(amount);
    }

    /// @inheritdoc IFaultlinePool
    /// @dev Same time gates as `redeem`; only once the bond supply is zero. Credits rounding dust and stray
    ///      transfers (`balance - totalClaimable`) to the sponsor.
    function sweepDust() external {
        _requireRedemptionOpen();
        uint256 supply = bond.totalSupply();
        if (supply != 0) revert SupplyNotZero(supply);
        uint256 amount = _surplus(totalClaimable);
        _credit(sponsor, amount);
        emit DustSwept(amount);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IFaultlinePool
    function effectiveValue(address holder) external view returns (uint256 principal, uint256 coupon) {
        uint256 units = bond.balanceOf(holder);
        (uint256 index,) = _accruedIndex(block.timestamp);
        principal = Math.mulDiv(units, BPS - appliedLossBps, BPS);
        coupon = Math.mulDiv(units, index, INDEX_SCALE);
    }

    /// @inheritdoc IFaultlinePool
    function currentCouponIndex() external view returns (uint256 index) {
        (index,) = _accruedIndex(block.timestamp);
    }

    /// @inheritdoc IFaultlinePool
    function requiredReserve(uint256 units) public view returns (uint256) {
        return Math.mulDiv(units, uint256(couponBps) * (maturity - riskStart), BPS * YEAR, Math.Rounding.Ceil);
    }

    /// @inheritdoc IFaultlinePool
    function collateralLeft() external view returns (uint256) {
        return unitsIssued - sponsorCredited - principalPaid;
    }

    /// @inheritdoc IFaultlinePool
    function couponReserveLeft() external view returns (uint256) {
        return couponReserve - couponPaid;
    }

    /// @inheritdoc IFaultlinePool
    /// @dev Invariant 1 in the form that holds in every phase, including after `sweepExcess`:
    ///      `balance >= totalClaimable + floor(out * (10000 - L) / 10000) + floor(out * maxIndex / 1e18)`, where
    ///      `maxIndex` is the index if accrual ran on to maturity at the current `L`. `out` is capped by the real
    ///      supply (D18): units a holder burned outside the pool are owed to nobody.
    function isSolvent() external view returns (bool) {
        uint256 outstanding = Math.min(unitsIssued - unitsRedeemed, bond.totalSupply());
        (uint256 maxIndex,) = _accruedIndex(maturity);
        uint256 owed =
            Math.mulDiv(outstanding, BPS - appliedLossBps, BPS) + Math.mulDiv(outstanding, maxIndex, INDEX_SCALE);
        return stablecoin.balanceOf(address(this)) >= totalClaimable + owed;
    }

    // ---------------------------------------------------------------- internals

    /// @dev D11: reverts `HtsCallFailed(code)` unless HTS answers 22, `NotKycForToken(account)` unless KYC is
    ///      granted. The HTS facade itself would revert with empty data (S3).
    function _requireKyc(address account) private {
        (int64 code, bool granted) = IHederaTokenServiceLite(HTS_PRECOMPILE).isKyc(address(stablecoin), account);
        if (code != HTS_SUCCESS) revert HtsCallFailed(code);
        if (!granted) revert NotKycForToken(account);
    }

    /// @dev D4, relaxed by D18 (SEC-15): reverts `SupplyMismatch` only when more units exist than this pool minted and
    ///      has not redeemed, so a foreign mint or an upward ATS balance adjustment stops payouts instead of draining
    ///      collateral. Supply below the books is allowed: any KYC'd holder can burn through ATS `redeem` with no role.
    function _checkSupply() private view {
        uint256 expected = unitsIssued - unitsRedeemed;
        uint256 actual = bond.totalSupply();
        if (actual > expected) revert SupplyMismatch(actual, expected);
    }

    /// @dev D2: redemption and the sweeps open strictly after `trigger.submissionDeadline()` and only with no pending
    ///      event. The deadline moves with paused time, so a pause that starts before the deadline keeps redemption
    ///      closed; one that starts after it does not (ARCHITECTURE §4.2).
    function _requireRedemptionOpen() private view {
        address t = trigger;
        if (t == address(0)) revert NotInitialized();
        if (block.timestamp <= IFaultlineTrigger(t).submissionDeadline()) revert RedemptionNotOpen();
        if (IFaultlineTrigger(t).pendingCount() != 0) revert EventPending();
    }

    /// @dev Pulls exactly `amount` from `from`; reverts `UnexpectedTransferAmount` if the pool's balance moved by
    ///      anything else (fee-on-transfer or any other token quirk).
    function _pull(address from, uint256 amount) private {
        uint256 before = stablecoin.balanceOf(address(this));
        stablecoin.safeTransferFrom(from, address(this), amount);
        uint256 received = stablecoin.balanceOf(address(this)) - before;
        if (received != amount) revert UnexpectedTransferAmount(amount, received);
    }

    /// @dev Adds `amount` to `account`'s pull balance.
    function _credit(address account, uint256 amount) private {
        claimable[account] += amount;
        totalClaimable += amount;
    }

    /// @dev Stablecoin balance above `reserved`, or 0.
    function _surplus(uint256 reserved) private view returns (uint256) {
        uint256 balance = stablecoin.balanceOf(address(this));
        return balance > reserved ? balance - reserved : 0;
    }

    /// @dev Coupon checkpoint (ARCHITECTURE §3.4) at the current loss.
    function _accrue() private {
        (uint256 index, uint64 t) = _accruedIndex(block.timestamp);
        couponIndex = index;
        lastAccrual = t;
    }

    /// @dev Index and checkpoint time if accrual ran to `at` at the current loss:
    ///      `t = clamp(at, riskStart, maturity)`; `index += (10000 - L) * couponBps * dt * 1e18 / (10000^2 * YEAR)`.
    function _accruedIndex(uint256 at) private view returns (uint256 index, uint64 t) {
        index = couponIndex;
        uint64 last = lastAccrual;
        t = SafeCast.toUint64(Math.min(Math.max(at, riskStart), maturity));
        if (t <= last) return (index, last);
        uint256 rate = (BPS - appliedLossBps) * couponBps * (t - last);
        index += Math.mulDiv(rate, INDEX_SCALE, BPS * BPS * YEAR);
    }
}
