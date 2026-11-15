// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice MUSD savings vault (MUSDSavingsRate). NOT ERC-4626: balance is 1:1
///      and never grows; yield is claimed in MUSD via claimYield() or
///      automatically on withdraw().
/// @dev Testnet 31611: 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16
///      Mainnet 31612: 0xb4D498029af77680cD1eF828b967f010d06C51CC
///      Source: plan sections 2.2 and 3.10. Pending yield (plan 3.10):
///      `balance * (yieldIndex - supplyYieldIndex) / 1e18`.
///      The yield views below (J3-extra round 2 item 4) let the account
///      compute pending yield on-chain; the exact live getter names are to
///      be confirmed by the 1.8 fork test against the real sMUSD.
interface ISMUSD {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function claimYield() external returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    /// @notice MUSD claimable as yield by `account` right now.
    function claimableYield(address account) external view returns (uint256);

    /// @notice Global yield index (1e18 scale).
    function yieldIndex() external view returns (uint256);

    /// @notice Per-user yield index at the user's last interaction.
    function supplyYieldIndex(address account) external view returns (uint256);
}
