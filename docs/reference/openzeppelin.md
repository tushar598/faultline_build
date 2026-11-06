# OpenZeppelin Contracts 5.6.1 — modules Faultline uses

Verified 2026-10-25 against the installed package source (`node_modules/@openzeppelin/contracts`,
version `5.6.1`) — the official code. Docs: <https://docs.openzeppelin.com/contracts/5.x/>.
Requires `evmVersion: "cancun"` (the library uses `MCOPY`; `shanghai` fails to compile).

## AccessControl — `access/AccessControl.sol` (`pragma ^0.8.20`)

```solidity
abstract contract AccessControl is Context, IAccessControl, ERC165
bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
modifier onlyRole(bytes32 role);
function hasRole(bytes32 role, address account) public view returns (bool);
function getRoleAdmin(bytes32 role) public view returns (bytes32);
function grantRole(bytes32 role, address account) public onlyRole(getRoleAdmin(role));
function revokeRole(bytes32 role, address account) public onlyRole(getRoleAdmin(role));
function renounceRole(bytes32 role, address callerConfirmation) public;   // callerConfirmation must == msg.sender
function _grantRole(bytes32 role, address account) internal returns (bool);
function _revokeRole(bytes32 role, address account) internal returns (bool);
function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal;
error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);   // IAccessControl
error AccessControlBadConfirmation();
```

Use in: FaultlinePool (`DEFAULT_ADMIN_ROLE` for `initialize`), FaultlineTrigger (`DEFAULT_ADMIN_ROLE`,
`TRUSTEE_ROLE`). Tests: `.to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount").withArgs(addr, role)`.

## EIP712 — `utils/cryptography/EIP712.sol` (`pragma ^0.8.24`)

```solidity
abstract contract EIP712 is IERC5267
constructor(string memory name, string memory version);       // "FaultlineTrigger", "1"
function _domainSeparatorV4() internal view returns (bytes32); // cached; rebuilt if chainid/address change
function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32);
function eip712Domain() public view returns (bytes1 fields, string name, string version,
    uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions);
```

`structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, eventId, lossBps, magnitudeX100, observedAt,
usgsUpdatedAt, nonce, termsHash, dataHash, deadline))`. ethers v6 side: `wallet.signTypedData(domain,
types, value)`; read the domain from `eip712Domain()` so the oracle never hard-codes it.

## ECDSA — `utils/cryptography/ECDSA.sol`

```solidity
function recover(bytes32 hash, bytes memory signature) internal pure returns (address);
function recoverCalldata(bytes32 hash, bytes calldata signature) internal pure returns (address); // cheaper for calldata
function tryRecover(bytes32 hash, bytes memory signature) internal pure returns (address, RecoverError, bytes32);
error ECDSAInvalidSignature(); error ECDSAInvalidSignatureLength(uint256); error ECDSAInvalidSignatureS(bytes32);
```

Rejects malleable (high-s) signatures. Replay protection is ours (event status + nonce), not ECDSA's.
Prefer `tryRecover` and revert with our own `InvalidSignature()` for a clean error surface.

## ReentrancyGuardTransient — `utils/ReentrancyGuardTransient.sol` ✅ use this

`utils/ReentrancyGuard.sol` is marked **Deprecated** in 5.6 ("will be removed and replaced by the
ReentrancyGuardTransient variant in v6.0"). The transient variant uses `TSTORE`/`TLOAD`, which Hedera
supports since v0.50 (docs/reference/hedera.md §2). Hardhat's in-process chain with
`hardfork: "cancun"` supports it too.

```solidity
modifier nonReentrant();
error ReentrancyGuardReentrantCall();
```

## Pausable — `utils/Pausable.sol`

```solidity
event Paused(address account); event Unpaused(address account);
error EnforcedPause(); error ExpectedPause();
modifier whenNotPaused(); modifier whenPaused();
function paused() public view returns (bool);
function _pause() internal whenNotPaused; function _unpause() internal whenPaused;
```

FaultlineTrigger needs extra fields (`pauseStart`, `totalPausedSeconds`); either extend `Pausable`
by overriding `_pause`/`_unpause` hooks or keep a small custom pause. Use OZ errors where they fit.

## SafeERC20 — `token/ERC20/utils/SafeERC20.sol`

```solidity
function safeTransfer(IERC20 token, address to, uint256 value) internal;
function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal;
function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool);
function forceApprove(IERC20 token, address spender, uint256 value) internal;
error SafeERC20FailedOperation(address token);
```

Handles tokens that return `false` instead of reverting — relevant because the HTS facade's failure
mode (revert vs `false`) is unverified (spike S3).

## Math — `utils/math/Math.sol`

`Math.mulDiv(x, y, d)` (floor, 512-bit safe), `Math.mulDiv(x, y, d, Math.Rounding.Ceil)`,
`Math.ceilDiv(a, b)`, `Math.min/max`. Use `mulDiv` for `U*L/10000`, `b*couponIndex/1e18` and the
reserve formula so no intermediate overflows.

## SafeCast — `utils/math/SafeCast.sol`

`SafeCast.toUint64`, `toUint16` for packing timestamps and bps.
