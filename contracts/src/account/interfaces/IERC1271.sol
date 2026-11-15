// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice EIP-1271 signature validation. The TroveAccount implements this:
///      it returns the magic value 0x1626ba7e iff the signer holds a live
///      session with canSignX402 == true (plan section 3.9).
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
