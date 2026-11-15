// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mezo TroveManager.
/// @dev Testnet 31611: 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
///      Mainnet 31612: 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193
///      Source: plan section 2.2.
///      getTroveStatus returns the Liquity Status enum as uint8 (the live
///      verified TroveManager ABI on testnet returns uint8, not uint256):
///      0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation,
///      4 closedByRedemption. getEntireDebtAndColl already folds pending
///      amounts into coll / principal / interest (do NOT add pc/pp/pi again).
interface ITM {
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

    function getTroveStatus(address borrower) external view returns (uint8);

    function checkRecoveryMode(uint256 price) external view returns (bool);

    function getTCR(uint256 price) external view returns (uint256);
}
