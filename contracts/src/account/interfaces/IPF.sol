// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mezo PriceFeed (precompile-backed).
/// @dev Testnet 31611: 0x86bCF0841622a5dAC14A313a15f96A95421b9366
///      Mainnet 31612: 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
///      Source: plan section 2.2. Read the price ONCE per tx: repeated reads
///      of the precompile misbehave (plan section 3.4).
interface IPF {
    function fetchPrice() external view returns (uint256);
}
