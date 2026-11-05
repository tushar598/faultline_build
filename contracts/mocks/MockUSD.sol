// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHRC719} from "../interfaces/IHRC719.sol";

/// @title IMockUSD
/// @notice The KYC / freeze views `MockHTS` reads from `MockUSD`.
interface IMockUSD {
    /// @notice Whether `account` has KYC granted for this token.
    function kycGranted(address account) external view returns (bool);

    /// @notice Whether `account` is frozen for this token.
    function frozen(address account) external view returns (bool);
}

/// @title MockUSD
/// @notice LOCAL TESTS ONLY. Stand-in for the HTS fungible stablecoin and its ERC-20 + HIP-719 facade, modelled on
///         the spike-S3 token fUSD (6 decimals, treasury holds admin/KYC/freeze keys, KYC key set, no wipe key).
/// @dev Labels used below: "testnet-verified (S3, tx in TESTNET-EVIDENCE.md)", "testnet-simulated (mirror-node
///      eth_call)", "not testnet-verified". Functions prefixed `test_` are test hooks with no real counterpart.
contract MockUSD is IERC20, IHRC719, IMockUSD {
    /// @dev HTS SUCCESS. testnet-verified (S3).
    uint256 private constant SUCCESS = 22;
    /// @dev HTS TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT. testnet-verified (S3).
    uint256 private constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;
    /// @dev HTS TOKEN_NOT_ASSOCIATED_TO_ACCOUNT. testnet-verified (S3, SDK TokenGrantKyc).
    uint256 private constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
    /// @dev HTS TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES (hiero-contracts HederaResponseCodes). not testnet-verified.
    uint256 private constant TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES = 195;

    /// @notice Token name.
    string public constant name = "Mock Faultline USD";
    /// @notice Token symbol.
    string public constant symbol = "mUSD";
    /// @notice 6 decimals, like fUSD. testnet-verified (S3).
    uint8 public constant decimals = 6;

    /// @notice Treasury and holder of the admin, KYC and freeze keys (the deployer).
    address public immutable admin;

    /// @inheritdoc IERC20
    uint256 public totalSupply;
    /// @notice Test hook state: fee in bps deducted from every transfer and sent to the treasury.
    uint16 public transferFeeBps;

    /// @dev Token balances.
    mapping(address account => uint256) private _balances;
    /// @dev ERC-20 allowances.
    mapping(address owner => mapping(address spender => uint256)) private _allowances;
    /// @dev HTS token association per account.
    mapping(address account => bool) private _associated;
    /// @dev HTS KYC flag per account.
    mapping(address account => bool) private _kyc;
    /// @dev HTS freeze flag per account.
    mapping(address account => bool) private _frozen;

    /// @notice Caller is not the key holder.
    error NotAdmin(address caller);
    /// @notice A key operation on an account that is not associated (real HTS: response 184).
    ///         testnet-verified for grantKyc (S3); not testnet-verified for revokeKyc / freeze / unfreeze.
    error TokenNotAssociatedToAccount(address account);
    /// @notice Test hook: fee above 10000 bps.
    error FeeTooHigh(uint16 bps);

    /// @notice KYC granted to `account`.
    event KycGranted(address indexed account);
    /// @notice KYC revoked from `account`.
    event KycRevoked(address indexed account);
    /// @notice `account` frozen.
    event Frozen(address indexed account);
    /// @notice `account` unfrozen.
    event Unfrozen(address indexed account);
    /// @notice `account` associated (`responseCode` 22) or already associated (194).
    event Associated(address indexed account, uint256 responseCode);

    /// @param initialSupply Base units minted to the treasury (the deployer).
    /// @dev The treasury is associated and KYC'd at creation. testnet-verified (S3: treasury associated,
    ///      KYC GRANTED right after TokenCreate).
    constructor(uint256 initialSupply) {
        admin = msg.sender;
        _associated[msg.sender] = true;
        _kyc[msg.sender] = true;
        _balances[msg.sender] = initialSupply;
        totalSupply = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    /// @dev Key-holder operations (the SDK transactions signed by the token's admin/KYC/freeze key).
    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    // ---------------------------------------------------------------- HIP-719

    /// @inheritdoc IHRC719
    /// @dev 22 the first time, 194 afterwards, never reverts. testnet-verified (S3).
    function associate() external returns (uint256 responseCode) {
        responseCode = _associated[msg.sender] ? TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT : SUCCESS;
        _associated[msg.sender] = true;
        emit Associated(msg.sender, responseCode);
    }

    /// @inheritdoc IHRC719
    /// @dev 22 and clears association, KYC and freeze; 184 if not associated; 195 if the balance is not zero.
    ///      not testnet-verified (codes from hiero-contracts HederaResponseCodes; Faultline never dissociates).
    function dissociate() external returns (uint256 responseCode) {
        if (!_associated[msg.sender]) return TOKEN_NOT_ASSOCIATED_TO_ACCOUNT;
        if (_balances[msg.sender] != 0) return TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES;
        _associated[msg.sender] = false;
        _kyc[msg.sender] = false;
        _frozen[msg.sender] = false;
        return SUCCESS;
    }

    /// @inheritdoc IHRC719
    /// @dev For `msg.sender`, as the real facade. testnet-verified (S3, vault `isAssociatedSelf`).
    function isAssociated() external view returns (bool) {
        return _associated[msg.sender];
    }

    // ---------------------------------------------------------------- key holder (SDK transactions on HTS)

    /// @notice Grants KYC. Reverts if `account` is not associated. testnet-verified (S3: 184 before association).
    function grantKyc(address account) external onlyAdmin {
        if (!_associated[account]) revert TokenNotAssociatedToAccount(account);
        _kyc[account] = true;
        emit KycGranted(account);
    }

    /// @notice Revokes KYC. not testnet-verified (HTS TokenRevokeKyc; association required by assumption).
    function revokeKyc(address account) external onlyAdmin {
        if (!_associated[account]) revert TokenNotAssociatedToAccount(account);
        _kyc[account] = false;
        emit KycRevoked(account);
    }

    /// @notice Freezes `account`. testnet-verified (S3 TokenFreeze; association required by assumption).
    function freeze(address account) external onlyAdmin {
        if (!_associated[account]) revert TokenNotAssociatedToAccount(account);
        _frozen[account] = true;
        emit Frozen(account);
    }

    /// @notice Unfreezes `account`. testnet-verified (S3 TokenUnfreeze; association required by assumption).
    function unfreeze(address account) external onlyAdmin {
        if (!_associated[account]) revert TokenNotAssociatedToAccount(account);
        _frozen[account] = false;
        emit Unfrozen(account);
    }

    /// @inheritdoc IMockUSD
    function kycGranted(address account) external view returns (bool) {
        return _kyc[account];
    }

    /// @inheritdoc IMockUSD
    function frozen(address account) external view returns (bool) {
        return _frozen[account];
    }

    /// @notice Whether `account` is associated (mock-only view for tests; the real facade answers only for
    ///         `msg.sender`, the mirror node answers for anyone).
    function associatedOf(address account) external view returns (bool) {
        return _associated[account];
    }

    // ---------------------------------------------------------------- ERC-20 facade

    /// @inheritdoc IERC20
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @inheritdoc IERC20
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    /// @inheritdoc IERC20
    /// @dev Plain ERC-20 approve. testnet-verified for a KYC'd, associated owner (S3); other approve rules of
    ///      the real facade are not testnet-verified and not modelled.
    function approve(address spender, uint256 value) external returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @inheritdoc IERC20
    /// @dev Returns true on success. On any failure it REVERTS WITH EMPTY DATA, never returns false:
    ///      no KYC / not associated (testnet-verified S3, 176 in the trace, caller sees 0 bytes); frozen
    ///      (testnet-simulated S3, 165); insufficient balance (not testnet-verified, assumed the same).
    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    /// @inheritdoc IERC20
    /// @dev Same failure mode as `transfer`; insufficient allowance also reverts with empty data
    ///      (not testnet-verified, assumed the same). Success testnet-verified (S3, vault pull).
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed < value) _revertEmpty();
        _allowances[from][msg.sender] = allowed - value;
        _move(from, to, value);
        return true;
    }

    // ---------------------------------------------------------------- test hooks

    /// @notice TEST HOOK (no real counterpart): mints `amount` to an associated `to`, skipping KYC.
    function test_mint(address to, uint256 amount) external {
        if (!_associated[to]) _revertEmpty();
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice TEST HOOK (no real counterpart; Faultline's token has no custom fees): every transfer sends
    ///         `bps` of the amount to the treasury, so the recipient gets less (exercises the balance-delta check).
    function test_setTransferFee(uint16 bps) external {
        if (bps > 10_000) revert FeeTooHigh(bps);
        transferFeeBps = bps;
    }

    // ---------------------------------------------------------------- internals

    /// @dev Moves `value` (minus the test fee) after the HTS checks; any failure is an empty revert.
    function _move(address from, address to, uint256 value) private {
        if (!_canHold(from) || !_canHold(to)) _revertEmpty();
        uint256 bal = _balances[from];
        if (bal < value) _revertEmpty();
        uint256 fee = (value * transferFeeBps) / 10_000;
        _balances[from] = bal - value;
        _balances[to] += value - fee;
        emit Transfer(from, to, value - fee);
        if (fee != 0) {
            _balances[admin] += fee;
            emit Transfer(from, admin, fee);
        }
    }

    /// @dev Associated, KYC granted and not frozen.
    function _canHold(address account) private view returns (bool) {
        return _associated[account] && _kyc[account] && !_frozen[account];
    }

    /// @dev The real facade's failure as seen by a calling contract: a revert with zero bytes of data (S3).
    function _revertEmpty() private pure {
        assembly ("memory-safe") {
            revert(0, 0)
        }
    }
}
