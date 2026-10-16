// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal surfaces of the deployed Mezo MUSD contracts that Sternpost touches.
interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice BorrowerOperationsSignatures (EIP-712 domain "BorrowerOperationsSignatures", version "1").
interface IBorrowerOperationsSignatures {
    function withdrawMUSDWithSignature(
        uint256 amount,
        address upperHint,
        address lowerHint,
        address borrower,
        address recipient,
        bytes calldata signature,
        uint256 deadline
    ) external;

    function repayMUSDWithSignature(
        uint256 amount,
        address upperHint,
        address lowerHint,
        address borrower,
        bytes calldata signature,
        uint256 deadline
    ) external;

    function addCollWithSignature(
        address upperHint,
        address lowerHint,
        address borrower,
        bytes calldata signature,
        uint256 deadline
    ) external payable;

    function getNonce(address borrower) external view returns (uint256);
}

interface ITroveManager {
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

interface IBorrowerOperations {
    function getBorrowingFee(uint256 debt) external view returns (uint256);
}

/// @notice sMUSD savings vault (testnet 0x6f46..8e16, mainnet 0xb4D4..51CC). 1:1 deposit/withdraw.
interface ISavingsMUSD {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}
