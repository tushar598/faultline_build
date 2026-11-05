// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {
    IAtsBond,
    ROLE_ISSUER,
    ROLE_CONTROLLER,
    ROLE_AGENT,
    ROLE_KYC,
    ROLE_PAUSER
} from "../interfaces/IAtsBond.sol";

/// @title MockBond
/// @notice LOCAL TESTS ONLY. Stand-in for the ATS v8 bond diamond (6 decimals, single partition, internal KYC),
///         modelled on the spike-S1 bond `0.0.11165702`. Error names and argument types are copied from the
///         ATS v8.0.0 source so selectors match the ones seen on testnet.
/// @dev Labels used below: "testnet-verified (S1/S2, tx in TESTNET-EVIDENCE.md)", "testnet-simulated (mirror-node
///      eth_call)", "not testnet-verified (mirrors ATS v8 source)". Guard order follows the ATS modifiers
///      (pause → controllable → role → max supply → KYC). `test_` functions are test hooks with no real counterpart.
///      "session 2" marks read-only simulations on real bonds: see docs/SECURITY-TEST-REPORT.md, parity table. No
///      holder function here was ever mined on testnet.
contract MockBond is IAtsBond {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice ATS `DEFAULT_ADMIN_ROLE`; admin of every role here (as on the spike bond).
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    /// @notice ATS `_DEFAULT_PARTITION` (constants/values.sol), used in `InsufficientBalance`.
    bytes32 public constant DEFAULT_PARTITION = 0x0000000000000000000000000000000000000000000000000000000000000001;

    /// @notice ATS `IKyc.KycStatus`.
    enum KycStatus {
        NOT_GRANTED,
        GRANTED
    }

    /// @notice ATS `IHoldTypes.Hold`, field for field, so `createHoldByPartition` keeps the real selector.
    struct Hold {
        uint256 amount;
        uint256 expirationTimestamp;
        address escrow;
        address to;
        bytes data;
    }

    /// @notice ATS `IHoldTypes.HoldIdentifier`.
    struct HoldIdentifier {
        bytes32 partition;
        address tokenHolder;
        uint256 holdId;
    }

    /// @notice Token name.
    string public name;
    /// @notice Token symbol.
    string public symbol;
    /// @inheritdoc IAtsBond
    uint256 public totalSupply;
    /// @notice ATS cap; 0 means unlimited (CapStorageWrapper.isCorrectMaxSupply).
    uint256 public immutable maxSupply;
    /// @notice Set at deploy, like `isControllable` in the factory's `SecurityData`.
    bool public immutable controllable;
    /// @notice ATS pause flag.
    bool public paused;

    /// @dev Free balances (single partition).
    mapping(address account => uint256) private _balances;
    /// @dev Internal KYC status per account.
    mapping(address account => KycStatus) private _kyc;
    /// @dev Role members (enumerable, so `getRoleMemberCount` is exact).
    mapping(bytes32 role => EnumerableSet.AddressSet) private _members;
    /// @dev ERC-20 allowances.
    mapping(address owner => mapping(address spender => uint256)) private _allowances;
    /// @dev Global ERC-1410 operators.
    mapping(address holder => mapping(address operator => bool)) private _operators;
    /// @dev Open holds; `amount` 0 means closed or never created.
    mapping(address holder => mapping(uint256 holdId => Hold)) private _holds;
    /// @dev Last hold id per holder (ATS ids start at 1).
    mapping(address holder => uint256) private _nextHoldId;
    /// @dev Held total per holder. ATS keeps held units inside `totalSupply` but outside `balanceOf`.
    mapping(address holder => uint256) private _held;

    /// @notice ATS IAccessControl: caller holds none of `roles`. Selector 0x90e55392. testnet-verified (S1, S0).
    error AccountHasNoRoles(address account, bytes32[] roles);
    /// @notice ATS IAccessControl: caller lacks the single `role` (role admin checks). not testnet-verified.
    error AccountHasNoRole(address account, bytes32 role);
    /// @notice ATS IAccessControl: `grantRole` for an existing member. not testnet-verified.
    error AccountAssignedToRole(bytes32 role, address account);
    /// @notice ATS IAccessControl: `revokeRole` for a non-member. not testnet-verified.
    error AccountNotAssignedToRole(bytes32 role, address account);
    /// @notice ATS IPause: bond is paused. Selector 0x1309a563. testnet-verified (S2).
    error IsPaused();
    /// @notice ATS IPause: `unpause` while unpaused. not testnet-verified.
    error IsUnpaused();
    /// @notice ATS IKyc: wrong KYC status. Selector 0xfc855b1b. testnet-simulated (S1 with the fresh wallet).
    error InvalidKycStatus();
    /// @notice ATS IKyc: zero account. not testnet-verified.
    error InvalidZeroAddress();
    /// @notice ATS IController: bond not controllable. Selector 0xf4b7b072. not testnet-verified.
    error TokenIsNotControllable();
    /// @notice ATS ICap: mint above max supply. not testnet-verified.
    error MaxSupplyReached(uint256 maxSupply);
    /// @notice ATS ITransfer: balance too low for a transfer or burn. Selector 0x5d6824c4. testnet-simulated (session 2).
    error InsufficientBalance(address account, uint256 balance, uint256 value, bytes32 partition);
    /// @notice ATS IAllowanceTypes. Selector 0xf180d8f9. testnet-simulated (session 2).
    error InsufficientAllowance(address spender, address from);
    /// @notice ATS IERC1410Types: `account` has no balance on `partition`. Selector 0xbf84f4ec. testnet-simulated (session 2).
    error InvalidPartition(address account, bytes32 partition);
    /// @notice ATS IERC1410Types. Selector 0xb96d9539. testnet-simulated (session 2).
    error PartitionNotAllowedInSinglePartitionMode(bytes32 partition);
    /// @notice ATS IERC1410Types: not an operator of `tokenHolder`. Selector 0x1e09743f. testnet-simulated (session 2).
    error Unauthorized(address operator, address tokenHolder, bytes32 partition);
    /// @notice ATS ICommonErrors. Selector 0xe39f4776. testnet-simulated (session 2).
    error WrongExpirationTimestamp();
    /// @notice ATS ICommonErrors. Selector 0x8579befe. testnet-simulated (session 2).
    error ZeroAddressNotAllowed();
    /// @notice ATS IHoldTypes. Selector 0x352b484a. testnet-simulated (session 2).
    error InvalidHoldAmount();
    /// @notice ATS IHoldTypes. not testnet-verified (source only, as every hold error below).
    error WrongHoldId();
    /// @notice ATS IHoldTypes.
    error InsufficientHoldBalance(uint256 holdAmount, uint256 amount);
    /// @notice ATS IHoldTypes.
    error HoldExpirationReached();
    /// @notice ATS IHoldTypes.
    error HoldExpirationNotReached();
    /// @notice ATS IHoldTypes.
    error IsNotEscrow();
    /// @notice ATS IHoldTypes.
    error InvalidDestinationAddress(address holdDestination, address to);

    /// @notice ERC-20 transfer (mint: from 0; burn: to 0).
    event Transfer(address indexed from, address indexed to, uint256 value);
    /// @notice ATS IMint.Issued.
    event Issued(address indexed _operator, address indexed _to, uint256 _value, bytes _data);
    /// @notice ATS IBurn.Redeemed (`_operator` is zero for a holder's own burn).
    event Redeemed(address indexed _operator, address indexed _from, uint256 _value, bytes _data);
    /// @notice ERC-20 Approval.
    event Approval(address indexed owner, address indexed spender, uint256 value);
    /// @notice ATS IHoldTypes hold opened (the real event carries more fields).
    event HeldByPartition(address indexed tokenHolder, uint256 indexed holdId, uint256 amount, address escrow);
    /// @notice ATS IController.ControllerRedemption.
    event ControllerRedemption(
        address _controller, address indexed _tokenHolder, uint256 _value, bytes _data, bytes _operatorData
    );
    /// @notice ATS IAccessControl.RoleGranted.
    event RoleGranted(address indexed operator, address indexed account, bytes32 indexed role);
    /// @notice ATS IAccessControl.RoleRevoked.
    event RoleRevoked(address indexed operator, address indexed account, bytes32 indexed role);
    /// @notice ATS IKyc.KycGranted.
    event KycGranted(address indexed account, address indexed issuer);
    /// @notice ATS IKyc.KycRevoked.
    event KycRevoked(address indexed account, address indexed issuer);
    /// @notice ATS IPause.Paused.
    event Paused(address indexed operator);
    /// @notice ATS IPause.Unpaused.
    event Unpaused(address indexed operator);

    /// @param admin Gets `DEFAULT_ADMIN_ROLE` (like the factory's `rbacs`).
    /// @param maxSupply_ Cap in base units (0 = unlimited).
    /// @param controllable_ Whether `controllerRedeem` is enabled.
    constructor(address admin, uint256 maxSupply_, bool controllable_) {
        if (admin == address(0)) revert InvalidZeroAddress();
        name = "Mock Faultline Bond";
        symbol = "mFLB";
        maxSupply = maxSupply_;
        controllable = controllable_;
        _members[DEFAULT_ADMIN_ROLE].add(admin);
        emit RoleGranted(msg.sender, admin, DEFAULT_ADMIN_ROLE);
    }

    /// @dev ATS `onlyUnpaused`.
    modifier onlyUnpaused() {
        if (paused) revert IsPaused();
        _;
    }

    /// @dev ATS `onlyRole`: reverts `AccountHasNoRole(caller, role)`.
    modifier onlyRole(bytes32 role) {
        if (!_members[role].contains(msg.sender)) revert AccountHasNoRole(msg.sender, role);
        _;
    }

    /// @dev ATS `onlyAnyRole`: reverts `AccountHasNoRoles(caller, [a, b])` (argument order testnet-verified S1/S0).
    modifier onlyAnyRole(bytes32 a, bytes32 b) {
        if (!_members[a].contains(msg.sender) && !_members[b].contains(msg.sender)) {
            bytes32[] memory roles = new bytes32[](2);
            roles[0] = a;
            roles[1] = b;
            revert AccountHasNoRoles(msg.sender, roles);
        }
        _;
    }

    // ---------------------------------------------------------------- issuance and burn

    /// @inheritdoc IAtsBond
    /// @dev Unpaused (testnet-verified S2) → ROLE_ISSUER or ROLE_AGENT (testnet-verified S1) → max supply
    ///      (not testnet-verified) → recipient KYC GRANTED (testnet-simulated S1).
    function mint(address to, uint256 amount) external {
        _issue(to, amount, "");
    }

    /// @inheritdoc IAtsBond
    /// @dev Same guards as `mint`. testnet-verified (S1).
    function issue(address tokenHolder, uint256 value, bytes calldata data) external {
        _issue(tokenHolder, value, data);
    }

    /// @inheritdoc IAtsBond
    /// @dev Unpaused (testnet-verified S2) → controllable (not testnet-verified) → ROLE_CONTROLLER or ROLE_AGENT
    ///      (testnet-verified S1/S0) → balance (not testnet-verified). NO holder KYC check and NO maturity check
    ///      (testnet-verified S1 steps 8–9).
    function controllerRedeem(address tokenHolder, uint256 value, bytes calldata data, bytes calldata operatorData)
        external
        onlyUnpaused
    {
        if (!controllable) revert TokenIsNotControllable();
        _requireAnyRole(ROLE_CONTROLLER, ROLE_AGENT);
        _burn(tokenHolder, value);
        emit ControllerRedemption(msg.sender, tokenHolder, value, data, operatorData);
    }

    /// @notice Holder-to-holder transfer. Unpaused (not testnet-verified for transfer) → both sides KYC GRANTED
    ///         (testnet-simulated S1: non-KYC recipient reverts InvalidKycStatus; KYC'd recipient passes) →
    ///         balance (not testnet-verified).
    function transfer(address to, uint256 amount) external onlyUnpaused returns (bool) {
        if (_kyc[msg.sender] != KycStatus.GRANTED || _kyc[to] != KycStatus.GRANTED) revert InvalidKycStatus();
        uint256 bal = _balances[msg.sender];
        if (bal < amount) revert InsufficientBalance(msg.sender, bal, amount, DEFAULT_PARTITION);
        _balances[msg.sender] = bal - amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    // ---------------------------------------------------------------- holder surface (RT-03)

    /// @notice ATS `redeem(uint256,bytes)` (`Burn.redeem`): burns the caller's own units, NO ROLE. Order: KYC →
    ///         balance → pause; `redeem(0)` passes for a KYC'd holder. testnet-simulated (session 2, FLDMO and FLSPK,
    ///         mirror-node `contracts/call`), never mined. This is the SEC-15 path. The pause check sits behind the
    ///         compliance checks because ATS reaches it in `triggerAndSyncAll`, not through `onlyUnpaused`.
    function redeem(uint256 value, bytes calldata data) external {
        _burnAsHolder(msg.sender, value);
        emit Redeemed(address(0), msg.sender, value, data);
    }

    /// @notice ATS `redeemByPartition`: same effect as `redeem`; the partition must be the default one.
    ///         testnet-simulated (session 2).
    function redeemByPartition(bytes32 partition, uint256 value, bytes calldata data) external {
        _requireDefaultPartition(partition);
        _burnAsHolder(msg.sender, value);
        emit Redeemed(address(0), msg.sender, value, data);
    }

    /// @notice ATS `redeemFrom`: a spender burns `tokenHolder`'s units, consuming the allowance. Needs an allowance
    ///         even for the holder itself or an operator (`burnFrom` always spends it). Reverts testnet-simulated
    ///         (session 2); the success path follows the v8.0.0 source because a simulation cannot chain `approve`.
    function redeemFrom(address tokenHolder, uint256 value, bytes calldata data) external {
        _requireCanRedeem(tokenHolder, value);
        if (paused) revert IsPaused();
        uint256 allowed = _allowances[tokenHolder][msg.sender];
        if (allowed < value) revert InsufficientAllowance(msg.sender, tokenHolder);
        _allowances[tokenHolder][msg.sender] = allowed - value;
        _burn(tokenHolder, value);
        emit Redeemed(msg.sender, tokenHolder, value, data);
    }

    /// @notice ATS `operatorRedeemByPartition`: an operator burns `tokenHolder`'s units; no allowance needed once
    ///         authorised. Without authorisation and without an allowance it fails on the allowance first
    ///         (testnet-simulated, session 2); with an allowance but no authorisation it fails `Unauthorized`.
    function operatorRedeemByPartition(
        bytes32 partition,
        address tokenHolder,
        uint256 value,
        bytes calldata data,
        bytes calldata
    ) external {
        _requireDefaultPartition(partition);
        _requireCanRedeem(tokenHolder, value);
        if (!_operators[tokenHolder][msg.sender]) revert Unauthorized(msg.sender, tokenHolder, partition);
        if (paused) revert IsPaused();
        _burn(tokenHolder, value);
        emit Redeemed(msg.sender, tokenHolder, value, data);
    }

    /// @notice ATS `authorizeOperator`: no role and no KYC. testnet-simulated (session 2).
    function authorizeOperator(address operator) external onlyUnpaused {
        _operators[msg.sender][operator] = true;
    }

    /// @notice ATS `revokeOperator`. The KYC requirement of the real function is not modelled.
    function revokeOperator(address operator) external onlyUnpaused {
        _operators[msg.sender][operator] = false;
    }

    /// @notice ATS `isOperator`.
    function isOperator(address operator, address tokenHolder) external view returns (bool) {
        return _operators[tokenHolder][operator];
    }

    /// @notice ERC-20 `approve`: no role and no KYC. testnet-simulated (session 2). ATS `permit` writes the same
    ///         allowance after a signature check, so it is not modelled.
    function approve(address spender, uint256 value) external onlyUnpaused returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice ERC-20 `allowance`.
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    /// @notice ERC-20 `transferFrom`. Unpaused → both sides KYC GRANTED → allowance → balance (order from the v8.0.0
    ///         source; the no-allowance revert testnet-simulated, session 2).
    function transferFrom(address from, address to, uint256 amount) external onlyUnpaused returns (bool) {
        if (_kyc[from] != KycStatus.GRANTED || _kyc[to] != KycStatus.GRANTED) revert InvalidKycStatus();
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(msg.sender, from);
        uint256 bal = _balances[from];
        if (bal < amount) revert InsufficientBalance(from, bal, amount, DEFAULT_PARTITION);
        _allowances[from][msg.sender] = allowed - amount;
        _balances[from] = bal - amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// @notice ATS `createHoldByPartition`: NO ROLE and NO KYC. Held units leave `balanceOf` but stay in
    ///         `totalSupply`. testnet-simulated (session 2, success and every revert below it); D9 does not stop it.
    function createHoldByPartition(bytes32 partition, Hold calldata hold)
        external
        onlyUnpaused
        returns (bool success, uint256 holdId)
    {
        if (hold.expirationTimestamp < block.timestamp) revert WrongExpirationTimestamp();
        if (hold.escrow == address(0)) revert ZeroAddressNotAllowed();
        _requireDefaultPartition(partition);
        if (hold.amount == 0) revert InvalidHoldAmount();
        _requirePartitionBalance(msg.sender, hold.amount);
        _balances[msg.sender] -= hold.amount;
        _held[msg.sender] += hold.amount;
        holdId = ++_nextHoldId[msg.sender];
        _holds[msg.sender][holdId] = hold;
        emit Transfer(msg.sender, address(0), hold.amount);
        emit HeldByPartition(msg.sender, holdId, hold.amount, hold.escrow);
        return (true, holdId);
    }

    /// @notice ATS `releaseHoldByPartition`: the escrow, before expiry, returns units to the holder. Source only.
    function releaseHoldByPartition(HoldIdentifier calldata id, uint256 amount) external onlyUnpaused returns (bool) {
        Hold storage h = _requireHold(id);
        if (block.timestamp >= h.expirationTimestamp) revert HoldExpirationReached();
        if (msg.sender != h.escrow) revert IsNotEscrow();
        _closeHold(id, h, id.tokenHolder, amount);
        return true;
    }

    /// @notice ATS `reclaimHoldByPartition`: anyone, from expiry on, returns the whole hold to the holder. Source only.
    function reclaimHoldByPartition(HoldIdentifier calldata id) external onlyUnpaused returns (bool) {
        Hold storage h = _requireHold(id);
        if (block.timestamp < h.expirationTimestamp) revert HoldExpirationNotReached();
        _closeHold(id, h, id.tokenHolder, h.amount);
        return true;
    }

    /// @notice ATS `executeHoldByPartition`: the escrow, before expiry, sends held units to `to` (both sides KYC'd;
    ///         `hold.to` binds the destination when set). Source only.
    function executeHoldByPartition(HoldIdentifier calldata id, address to, uint256 amount)
        external
        onlyUnpaused
        returns (bool)
    {
        if (_kyc[id.tokenHolder] != KycStatus.GRANTED || _kyc[to] != KycStatus.GRANTED) revert InvalidKycStatus();
        Hold storage h = _requireHold(id);
        if (h.to != address(0) && to != h.to) revert InvalidDestinationAddress(h.to, to);
        if (block.timestamp >= h.expirationTimestamp) revert HoldExpirationReached();
        if (msg.sender != h.escrow) revert IsNotEscrow();
        _closeHold(id, h, to, amount);
        return true;
    }

    /// @notice ATS `getHeldAmountFor`.
    function getHeldAmountFor(address tokenHolder) external view returns (uint256) {
        return _held[tokenHolder];
    }

    // ---------------------------------------------------------------- KYC, pause, roles

    /// @notice ATS `grantKyc` (signature as ATS v8). Unpaused, ROLE_KYC, non-zero account, status NOT_GRANTED.
    ///         The VC id, dates and issuer registration are accepted but not checked here (ATS checks dates and a
    ///         registered issuer; not modelled). testnet-verified for the happy path (S1).
    function grantKyc(address account, string calldata, uint256, uint256, address issuer)
        external
        onlyUnpaused
        onlyRole(ROLE_KYC)
        returns (bool)
    {
        if (account == address(0)) revert InvalidZeroAddress();
        if (_kyc[account] != KycStatus.NOT_GRANTED) revert InvalidKycStatus();
        _kyc[account] = KycStatus.GRANTED;
        emit KycGranted(account, issuer);
        return true;
    }

    /// @notice ATS `revokeKyc`: unpaused, ROLE_KYC, non-zero account; no status check. testnet-verified (S1).
    function revokeKyc(address account) external onlyUnpaused onlyRole(ROLE_KYC) returns (bool) {
        if (account == address(0)) revert InvalidZeroAddress();
        _kyc[account] = KycStatus.NOT_GRANTED;
        emit KycRevoked(account, msg.sender);
        return true;
    }

    /// @notice ATS `getKycStatusFor`. testnet-verified (S1: 1 after grant, 0 after revoke).
    function getKycStatusFor(address account) external view returns (KycStatus) {
        return _kyc[account];
    }

    /// @notice ATS `pause`: ROLE_PAUSER while unpaused. testnet-verified (S2).
    function pause() external onlyUnpaused onlyRole(ROLE_PAUSER) returns (bool) {
        paused = true;
        emit Paused(msg.sender);
        return true;
    }

    /// @notice ATS `unpause`: ROLE_PAUSER while paused. testnet-verified (S2).
    function unpause() external onlyRole(ROLE_PAUSER) returns (bool) {
        if (!paused) revert IsUnpaused();
        paused = false;
        emit Unpaused(msg.sender);
        return true;
    }

    /// @notice ATS `grantRole`: unpaused, caller holds DEFAULT_ADMIN_ROLE (role admin); reverts if already a
    ///         member. not testnet-verified (the spike used `applyRoles`, same effect).
    function grantRole(bytes32 role, address account) external onlyUnpaused onlyRole(DEFAULT_ADMIN_ROLE) returns (bool) {
        if (!_members[role].add(account)) revert AccountAssignedToRole(role, account);
        emit RoleGranted(msg.sender, account, role);
        return true;
    }

    /// @notice ATS `revokeRole`: unpaused, DEFAULT_ADMIN_ROLE; reverts if not a member. testnet-verified (S0).
    function revokeRole(bytes32 role, address account) external onlyUnpaused onlyRole(DEFAULT_ADMIN_ROLE) returns (bool) {
        if (!_members[role].remove(account)) revert AccountNotAssignedToRole(role, account);
        emit RoleRevoked(msg.sender, account, role);
        return true;
    }

    /// @inheritdoc IAtsBond
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _members[role].contains(account);
    }

    /// @inheritdoc IAtsBond
    /// @dev testnet-verified (S1).
    function getRoleMemberCount(bytes32 role) external view returns (uint256) {
        return _members[role].length();
    }

    /// @inheritdoc IAtsBond
    function isControllable() external view returns (bool) {
        return controllable;
    }

    /// @notice ATS ICap `getMaxSupply`.
    function getMaxSupply() external view returns (uint256) {
        return maxSupply;
    }

    /// @inheritdoc IAtsBond
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @inheritdoc IAtsBond
    /// @dev 6, as the spike bond (testnet-verified S1).
    function decimals() external pure returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------- test hooks

    /// @notice TEST HOOK (stands in for an ATS balance adjustment or a foreign mint, which Faultline forbids):
    ///         changes `account`'s balance and the total supply by `delta`, bypassing every guard. Exercises the
    ///         pool's supply guard (D4). No role check.
    function test_adjustBalance(address account, int256 delta) external {
        if (delta >= 0) {
            uint256 up = uint256(delta);
            _balances[account] += up;
            totalSupply += up;
            emit Transfer(address(0), account, up);
        } else {
            uint256 down = uint256(-delta);
            _balances[account] -= down;
            totalSupply -= down;
            emit Transfer(account, address(0), down);
        }
    }

    // ---------------------------------------------------------------- internals

    /// @dev Shared body of `mint` / `issue`.
    function _issue(address to, uint256 amount, bytes memory data) private onlyUnpaused {
        _requireAnyRole(ROLE_ISSUER, ROLE_AGENT);
        if (maxSupply != 0 && totalSupply + amount > maxSupply) revert MaxSupplyReached(maxSupply);
        if (_kyc[to] != KycStatus.GRANTED) revert InvalidKycStatus();
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
        emit Issued(msg.sender, to, amount, data);
    }

    /// @dev `onlyCanRedeemFromByPartition` plus the pause check ATS reaches later, for a burn by the holder itself.
    function _burnAsHolder(address from, uint256 value) private {
        _requireCanRedeem(from, value);
        if (paused) revert IsPaused();
        _burn(from, value);
    }

    /// @dev ATS `isAbleToRedeemFromByPartition` for one partition: holder KYC → allowance (a third party that is no
    ///      operator) → balance. Pause is not part of it.
    function _requireCanRedeem(address from, uint256 value) private view {
        if (_kyc[from] != KycStatus.GRANTED) revert InvalidKycStatus();
        if (from != msg.sender && !_operators[from][msg.sender] && _allowances[from][msg.sender] < value) {
            revert InsufficientAllowance(msg.sender, from);
        }
        _requirePartitionBalance(from, value);
    }

    /// @dev ATS partition checks: an empty balance has no partition entry, so it reverts `InvalidPartition`.
    function _requirePartitionBalance(address from, uint256 value) private view {
        uint256 bal = _balances[from];
        if (bal == 0) revert InvalidPartition(from, DEFAULT_PARTITION);
        if (bal < value) revert InsufficientBalance(from, bal, value, DEFAULT_PARTITION);
    }

    /// @dev ATS `onlyDefaultPartitionWithSinglePartition`.
    function _requireDefaultPartition(bytes32 partition) private pure {
        if (partition != DEFAULT_PARTITION) revert PartitionNotAllowedInSinglePartitionMode(partition);
    }

    /// @dev ATS `onlyValidHoldId`.
    function _requireHold(HoldIdentifier calldata id) private view returns (Hold storage h) {
        h = _holds[id.tokenHolder][id.holdId];
        if (h.amount == 0) revert WrongHoldId();
    }

    /// @dev ATS `transferHold`: draws `amount` from the hold and credits `to`.
    function _closeHold(HoldIdentifier calldata id, Hold storage h, address to, uint256 amount) private {
        if (amount > h.amount) revert InsufficientHoldBalance(h.amount, amount);
        h.amount -= amount;
        _held[id.tokenHolder] -= amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @dev Burns `value` from `from`; reverts `InsufficientBalance` like ATS ERC1410 redeem.
    function _burn(address from, uint256 value) private {
        uint256 bal = _balances[from];
        if (bal < value) revert InsufficientBalance(from, bal, value, DEFAULT_PARTITION);
        _balances[from] = bal - value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    /// @dev Applies `onlyAnyRole` after the earlier guards, keeping the ATS check order.
    function _requireAnyRole(bytes32 a, bytes32 b) private view onlyAnyRole(a, b) {}
}
