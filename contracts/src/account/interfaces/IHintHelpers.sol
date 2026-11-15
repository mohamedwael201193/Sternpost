// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mezo HintHelpers: approximate insertion hints for SortedTroves.
/// @dev Testnet 31611: 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6
///      Mainnet 31612: 0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3
///      Source: plan sections 2.2 and 3.13 item 3. Used off-chain for
///      open / addColl hints; neighbour hints are used on-chain for
///      draw / repay. Nominal ICR (J3-extra round 2 item 5, LAB_METHODS
///      section 3): `coll * 1e20 / debt` — the 1e20 scale is the canonical
///      on-chain NICR (the lab prints NICR / 1e20, e.g. 1.9982e-5).
interface IHintHelpers {
    function getApproxHint(uint256 nicr, uint256 numTrials, uint256 seed)
        external
        view
        returns (address hintAddress, uint256 diff, uint256 latestRandomSeed);

    /// @notice Nominal ICR of a trove: `coll * 1e20 / debt` (0 when debt is 0).
    function computeNominalCR(uint256 coll, uint256 debt) external pure returns (uint256);
}
