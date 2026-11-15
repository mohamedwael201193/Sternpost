// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mezo BorrowerOperations (the contract that opens and manages troves).
/// @dev Testnet 31611: 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
///      Mainnet 31612: 0x44b1bac67dDA612a41a58AAf779143B181dEe031
///      Collateral is native BTC (msg.value); there is no EOA / tx.origin check,
///      so a contract can be the borrower. Source: plan section 2.2.
interface IBO {
    function openTrove(uint256 debt, address up, address lo) external payable;

    function withdrawMUSD(uint256 amount, address up, address lo) external;

    function repayMUSD(uint256 amount, address up, address lo) external;

    function addColl(address up, address lo) external payable;

    function withdrawColl(uint256 amount, address up, address lo) external;

    function closeTrove() external;

    function claimCollateral() external;

    function minNetDebt() external view returns (uint256);

    function getBorrowingFee(uint256 debt) external view returns (uint256);
}
