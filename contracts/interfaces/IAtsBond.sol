// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ATS v8 role ids, copied byte for byte from docs/reference/ats.md §3 (source: ATS v8.0.0
// `contracts/constants/roles.sol`). test/interfaces.test.ts compares them with that table.

/// @dev Can `mint` / `issue`. Faultline: held by the pool only (D4).
bytes32 constant ROLE_ISSUER = 0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f;
/// @dev Can `controllerRedeem`. Faultline: held by the pool only.
bytes32 constant ROLE_CONTROLLER = 0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e;
/// @dev Can mint and `controllerRedeem` too. Faultline: held by nobody.
bytes32 constant ROLE_AGENT = 0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b;
/// @dev Can change balances outside the pool. Faultline: held by nobody (D4).
bytes32 constant ROLE_ADJUSTMENT_BALANCE = 0xb246506a8ded65dd6360e8ce033fd9462936d1be64fb9f85c5f60d28cd3ca6da;
/// @dev Grants and revokes internal KYC on the bond.
bytes32 constant ROLE_KYC = 0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc;
/// @dev Can pause the bond. Faultline never pauses it (S2: a paused bond blocks `controllerRedeem`).
bytes32 constant ROLE_PAUSER = 0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f;

/// @title IAtsBond
/// @notice The slice of the ATS v8 bond (diamond) that Faultline calls. Nothing else.
/// @dev Behaviour measured on Hedera testnet in spikes S1/S2 (docs/LESSONS.md "Spike results").
interface IAtsBond {
    /// @notice Mints `amount` units to `to`. Caller needs `ROLE_ISSUER` or `ROLE_AGENT`; `to` needs KYC;
    ///         bond unpaused; within max supply. (testnet-verified S1)
    function mint(address to, uint256 amount) external;

    /// @notice Same guards as `mint`, with an extra data payload. (testnet-verified S1)
    function issue(address tokenHolder, uint256 value, bytes calldata data) external;

    /// @notice Burns `value` units from `tokenHolder` without consent. Caller needs `ROLE_CONTROLLER` or
    ///         `ROLE_AGENT`; bond unpaused and controllable; no holder KYC check; no maturity check.
    ///         (testnet-verified S1/S2)
    function controllerRedeem(address tokenHolder, uint256 value, bytes calldata data, bytes calldata operatorData)
        external;

    /// @notice Free balance of `account` (excludes locked / held / clearing amounts; ATS v8 source).
    function balanceOf(address account) external view returns (uint256);

    /// @notice Total supply of the bond.
    function totalSupply() external view returns (uint256);

    /// @notice Token decimals (6 for the Faultline bond, testnet-verified S1).
    function decimals() external view returns (uint8);

    /// @notice Whether `account` holds `role`.
    function hasRole(bytes32 role, address account) external view returns (bool);

    /// @notice Number of accounts holding `role` (testnet-verified S1).
    function getRoleMemberCount(bytes32 role) external view returns (uint256);

    /// @notice Whether `controllerRedeem` is enabled for this bond (must be true for Faultline).
    function isControllable() external view returns (bool);
}
