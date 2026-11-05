// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Hedera Token Service system contract address.
address constant HTS_PRECOMPILE = 0x0000000000000000000000000000000000000167;
/// @dev HTS response code SUCCESS.
int64 constant HTS_SUCCESS = 22;
/// @dev HTS response code TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT (returned, not reverted, by HIP-719 `associate()`).
int64 constant TOKEN_ALREADY_ASSOCIATED = 194;

/// @title IHederaTokenServiceLite
/// @notice The two read calls Faultline makes on the HTS system contract at `0x167` (D11). Signatures copied
///         from hiero-contracts 0.2.0 `token-service-v2/IHederaTokenService.sol` (they are
///         declared non-view there).
/// @dev Testnet-simulated (mirror-node eth_call, docs/LESSONS.md "D11"): KYC'd accounts return (22, true);
///      a never-associated account returns (22, false), not 184; `isKyc` costs about 24.6k gas.
interface IHederaTokenServiceLite {
    /// @notice Whether `account` has KYC granted for `token`.
    /// @return responseCode HTS response code (22 = SUCCESS).
    /// @return kycGranted True if KYC is granted.
    function isKyc(address token, address account) external returns (int64 responseCode, bool kycGranted);

    /// @notice Whether `account` is frozen for `token`.
    /// @return responseCode HTS response code (22 = SUCCESS).
    /// @return frozen True if the account is frozen.
    function isFrozen(address token, address account) external returns (int64 responseCode, bool frozen);
}
