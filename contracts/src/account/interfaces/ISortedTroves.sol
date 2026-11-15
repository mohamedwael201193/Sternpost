// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mezo SortedTroves: troves ordered by NICR, lowest first.
///      Redemptions walk from getLast() upwards.
/// @dev Testnet 31611: 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA
///      Mainnet 31612: 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f
///      Source: plan sections 2.2 and 3.8.
interface ISortedTroves {
    function getLast() external view returns (address);

    function getPrev(address trove) external view returns (address);

    function getNext(address trove) external view returns (address);

    function contains(address trove) external view returns (bool);

    function findInsertPosition(uint256 nicr, address prevId, address nextId)
        external
        view
        returns (address, address);
}
