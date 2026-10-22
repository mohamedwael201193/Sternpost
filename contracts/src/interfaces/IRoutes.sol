// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice MUSD Savings Rate (sMUSD) on Mezo. Not ERC-4626: deposit/withdraw are 1:1 and credit msg.sender;
///         the share token is a transferable ERC-20 and yield is claimed separately via claimYield().
interface IMUSDSavingsRate {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external;
    function claimableYield(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Mezo DEX router (Velodrome-style, testnet 0x9a1f..CD7E9).
interface IMezoRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) external view returns (uint256[] memory amounts);
}

interface IGovernorView {
    function borrower() external view returns (address);
    function icr() external view returns (uint256);
    function floorICR() external view returns (uint256);
    function draw(
        uint256 amount,
        address payee,
        uint256 withdrawDeadline,
        bytes calldata withdrawSig,
        uint256 healDeadline,
        bytes calldata healSig
    ) external;
}

interface IFactoryView {
    function governorOf(address borrower) external view returns (address);
}
