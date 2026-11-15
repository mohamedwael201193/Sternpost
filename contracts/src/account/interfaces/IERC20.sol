// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC-20 surface used by the account system (MUSD).
/// @dev Testnet 31611 MUSD: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
///      Mainnet 31612 MUSD: 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
///      Source: plan section 2.2.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);
}
