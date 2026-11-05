// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MockTokenVariant
/// @notice LOCAL TESTS ONLY, no real counterpart. A token-shaped stub for the pool's constructor and `initialize`
///         failure paths that MockUSD / MockBond cannot produce: a decimals value other than 6, and an HIP-719
///         `associate()` that returns a fixed response code (e.g. 194 on the first call, or 184).
contract MockTokenVariant {
    /// @notice Returned by `decimals()`.
    uint8 public immutable decimals;
    /// @notice Returned by every `associate()` call.
    uint256 public immutable associateCode;

    /// @param decimals_ Value for `decimals()`.
    /// @param associateCode_ Value for `associate()`.
    constructor(uint8 decimals_, uint256 associateCode_) {
        decimals = decimals_;
        associateCode = associateCode_;
    }

    /// @notice HIP-719 shape; always returns `associateCode`.
    function associate() external view returns (uint256 responseCode) {
        return associateCode;
    }
}

/// @title MockHtsVariant
/// @notice LOCAL TESTS ONLY, no real counterpart. Placed at `0x167` with `setCode` (the response code is an
///         immutable, so it survives the runtime-code copy) to exercise the pool's `HtsCallFailed` path: `isKyc`
///         answers `(responseCode, true)` for everyone.
contract MockHtsVariant {
    /// @notice Returned as the HTS response code.
    int64 public immutable responseCode;

    /// @param responseCode_ Code returned by `isKyc`.
    constructor(int64 responseCode_) {
        responseCode = responseCode_;
    }

    /// @notice `isKyc` shape of IHederaTokenServiceLite; always `(responseCode, true)`.
    function isKyc(address, address) external view returns (int64, bool) {
        return (responseCode, true);
    }
}

/// @title MockReentrantToken
/// @notice LOCAL TESTS ONLY, no real counterpart (the HTS facade never calls back). A 6-decimal token that, when
///         armed, calls `target` with `data` from inside `transfer` / `transferFrom` before moving balances, and
///         records the outcome, so tests can prove the pool's `nonReentrant` guard. Also answers the MockHTS views
///         (everyone KYC'd, nobody frozen) and HIP-719 `associate()` (22). No allowances: any `transferFrom` moves.
contract MockReentrantToken {
    /// @notice 6 decimals, like the stablecoin.
    uint8 public constant decimals = 6;
    /// @notice Balances.
    mapping(address account => uint256) public balanceOf;
    /// @notice Contract the armed hook calls (not named `target`: that clashes with ethers `BaseContract.target`).
    address public hookTarget;
    /// @notice Calldata of the armed hook.
    bytes public hookData;
    /// @notice Whether the last re-entrant call succeeded.
    bool public lastOk;
    /// @notice Return or revert data of the last re-entrant call.
    bytes public lastData;

    /// @notice TEST HOOK: credits `amount` to `to`.
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    /// @notice TEST HOOK: the next `transfer` / `transferFrom` calls `target_` with `data_` once.
    function arm(address target_, bytes calldata data_) external {
        hookTarget = target_;
        hookData = data_;
    }

    /// @notice HIP-719 shape; always 22.
    function associate() external pure returns (uint256) {
        return 22;
    }

    /// @notice MockHTS view: everyone is KYC'd.
    function kycGranted(address) external pure returns (bool) {
        return true;
    }

    /// @notice MockHTS view: nobody is frozen.
    function frozen(address) external pure returns (bool) {
        return false;
    }

    /// @notice Runs the hook, then moves `value` from the caller.
    function transfer(address to, uint256 value) external returns (bool) {
        _hook();
        _move(msg.sender, to, value);
        return true;
    }

    /// @notice Runs the hook, then moves `value` from `from` (no allowance check).
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _hook();
        _move(from, to, value);
        return true;
    }

    /// @dev Calls the armed target once and records the outcome; disarms first.
    function _hook() private {
        address t = hookTarget;
        if (t == address(0)) return;
        hookTarget = address(0);
        (lastOk, lastData) = t.call(hookData);
    }

    /// @dev Plain balance move; reverts on insufficient balance.
    function _move(address from, address to, uint256 value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// @title MockReentrantBond
/// @notice LOCAL TESTS ONLY, no real counterpart. A 6-decimal bond that, when armed, calls `hookTarget` from inside
///         `controllerRedeem` or `mint`, before or after the balance change, and records the outcome. The ATS bond has
///         no holder callback; its only external call in these paths is the ERC-3643 compliance contract, which the
///         Faultline bond leaves unset. So this path needs an admin-configured compliance hook on a real bond.
contract MockReentrantBond {
    /// @notice 6 decimals, like the ATS bond.
    uint8 public constant decimals = 6;
    /// @notice Balances.
    mapping(address account => uint256) public balanceOf;
    /// @notice Total supply.
    uint256 public totalSupply;
    /// @notice Contract the armed hook calls.
    address public hookTarget;
    /// @notice Calldata of the armed hook.
    bytes public hookData;
    /// @notice Whether the hook runs after the balance change.
    bool public hookAfter;
    /// @notice Whether the last re-entrant call succeeded.
    bool public lastOk;
    /// @notice Return or revert data of the last re-entrant call.
    bytes public lastData;

    /// @notice TEST HOOK: the next `controllerRedeem` or `mint` calls `target_` with `data_` once.
    function arm(address target_, bytes calldata data_, bool after_) external {
        hookTarget = target_;
        hookData = data_;
        hookAfter = after_;
    }

    /// @notice Mints with no role check.
    function mint(address to, uint256 amount) external {
        if (!hookAfter) _hook();
        balanceOf[to] += amount;
        totalSupply += amount;
        if (hookAfter) _hook();
    }

    /// @notice Burns with no role check.
    function controllerRedeem(address tokenHolder, uint256 value, bytes calldata, bytes calldata) external {
        if (!hookAfter) _hook();
        balanceOf[tokenHolder] -= value;
        totalSupply -= value;
        if (hookAfter) _hook();
    }

    /// @dev Calls the armed target once and records the outcome; disarms first.
    function _hook() private {
        address t = hookTarget;
        if (t == address(0)) return;
        hookTarget = address(0);
        (lastOk, lastData) = t.call(hookData);
    }
}

/// @title MockFalseToken
/// @notice LOCAL TESTS ONLY, no real counterpart: the HTS facade reverts with empty data and never returns `false`
///         (S3). A 6-decimal token whose `transfer` and `transferFrom` return `false` once switched on, for the
///         pool's SafeERC20 failure path. Also answers the MockHTS views and HIP-719 `associate()`.
contract MockFalseToken {
    /// @notice 6 decimals, like the stablecoin.
    uint8 public constant decimals = 6;
    /// @notice Balances.
    mapping(address account => uint256) public balanceOf;
    /// @notice When true, `transfer` and `transferFrom` move nothing and return false.
    bool public failing;

    /// @notice TEST HOOK: credits `amount` to `to`.
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    /// @notice TEST HOOK: switches the failure on or off.
    function setFailing(bool failing_) external {
        failing = failing_;
    }

    /// @notice HIP-719 shape; always 22.
    function associate() external pure returns (uint256) {
        return 22;
    }

    /// @notice MockHTS view: everyone is KYC'd.
    function kycGranted(address) external pure returns (bool) {
        return true;
    }

    /// @notice MockHTS view: nobody is frozen.
    function frozen(address) external pure returns (bool) {
        return false;
    }

    /// @notice Moves `value` from the caller, or returns false.
    function transfer(address to, uint256 value) external returns (bool) {
        return _move(msg.sender, to, value);
    }

    /// @notice Moves `value` from `from` (no allowance check), or returns false.
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        return _move(from, to, value);
    }

    /// @dev Plain balance move, unless failing.
    function _move(address from, address to, uint256 value) private returns (bool) {
        if (failing) return false;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}
