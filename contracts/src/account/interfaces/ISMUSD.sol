// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice MUSD savings vault (MUSDSavingsRate). NOT ERC-4626: balance is 1:1
///      and never grows; yield is claimed in MUSD via claimYield() or
///      automatically on withdraw().
/// @dev Testnet 31611: 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16
///      Mainnet 31612: 0xb4D498029af77680cD1eF828b967f010d06C51CC
///      Source: plan sections 2.2 and 3.10.
interface ISMUSD {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function claimYield() external returns (uint256);

    function balanceOf(address account) external view returns (uint256);
}
