// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RawCaller
/// @notice LOCAL TESTS ONLY. Makes a low-level call as a contract and records the raw outcome, so tests can see
///         what a calling contract sees (e.g. the empty revert data of a failed HTS facade transfer, spike S3), and
///         can act as a contract account (associate, receive tokens).
contract RawCaller {
    /// @notice Outcome of the last `exec`.
    bool public lastOk;
    /// @notice Return or revert data of the last `exec`.
    bytes public lastData;

    /// @notice Emitted after every `exec`.
    event Called(address indexed target, bool ok, bytes data);

    /// @notice Calls `target` with `data`; never reverts on a failed call.
    /// @return ok Whether the call succeeded.
    /// @return ret Return data, or revert data on failure.
    function exec(address target, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = target.call(data);
        lastOk = ok;
        lastData = ret;
        emit Called(target, ok, ret);
    }
}
