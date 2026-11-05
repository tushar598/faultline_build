// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IHRC719
/// @notice HIP-719 token association facade, served on every HTS token address. Signatures copied from
///         hiero-contracts 0.2.0 `token-service/IHRC719.sol`.
/// @dev Testnet-verified in spike S3: a contract calling `associate()` gets 22; a second call returns 194
///      (`TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT`) without reverting and costs the same gas (~730k).
interface IHRC719 {
    /// @notice Associates the calling account with the token.
    /// @return responseCode HTS response code (22 = SUCCESS, 194 = already associated).
    function associate() external returns (uint256 responseCode);

    /// @notice Dissociates the calling account from the token.
    /// @return responseCode HTS response code.
    function dissociate() external returns (uint256 responseCode);

    /// @notice Whether the calling account is associated with the token.
    function isAssociated() external view returns (bool associated);
}
