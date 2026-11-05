// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHederaTokenServiceLite, HTS_SUCCESS} from "../interfaces/IHederaTokenServiceLite.sol";
import {IMockUSD} from "./MockUSD.sol";

/// @title MockHTS
/// @notice LOCAL TESTS ONLY. Stand-in for the HTS system contract at `0x167`, placed there with `hardhat_setCode`.
///         Stateless (setCode copies runtime code only): answers from the flags stored in `MockUSD`.
/// @dev Testnet-simulated (mirror-node eth_call, docs/LESSONS.md "D11"): KYC'd account → (22, true); never-associated
///      account → (22, false), not 184; `isFrozen` the same way. A `token` that is not a MockUSD makes the call
///      revert (real HTS would return an error code such as INVALID_TOKEN_ID; not modelled, not testnet-verified).
contract MockHTS is IHederaTokenServiceLite {
    /// @inheritdoc IHederaTokenServiceLite
    function isKyc(address token, address account) external view returns (int64 responseCode, bool kycGranted) {
        return (HTS_SUCCESS, IMockUSD(token).kycGranted(account));
    }

    /// @inheritdoc IHederaTokenServiceLite
    function isFrozen(address token, address account) external view returns (int64 responseCode, bool frozen) {
        return (HTS_SUCCESS, IMockUSD(token).frozen(account));
    }
}
