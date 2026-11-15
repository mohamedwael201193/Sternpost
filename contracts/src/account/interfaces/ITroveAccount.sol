// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TroveAccount policy (plan section 3.3).
/// @dev Production defaults: floorICR 2.50e18, shieldICR 1.60e18,
///      targetICR 2.00e18, bounty 1e18 (1 MUSD), minDebtAhead 10_000e18 on
///      mainnet and 0 on testnet, cooldownBlocks 20. Validation lives in
///      TroveAccount.initialize / setPolicy (task 1.2):
///      1.15e18 <= shieldICR < targetICR <= 10e18, shieldICR < floorICR,
///      bounty <= 5e18.
///      WARNING: the lab enforced the opposite ordering (floor < shield <
///      target). Do not mix lab numbers with production policy values.
struct Policy {
    uint64 floorICR; // agent draws may not leave ICR below this (1e18 scale)
    uint64 shieldICR; // keeper may act when ICR is below this
    uint64 targetICR; // keeper restores ICR to this
    uint128 bounty; // MUSD paid to the keeper per effective shield, hard cap 5e18
    uint128 minDebtAhead; // MUSD of debt that must sit ahead of us in redemption order; 0 = rank trigger off
    uint32 cooldownBlocks; // min blocks between shields (default 20)
}

/// @notice Minimal surface the Factory needs from a TroveAccount clone.
/// @dev Implemented by TroveAccount (task 1.2). The Factory is the only
///      caller of initialize (once) and of openFor (during creation only).
interface ITroveAccount {
    /// @notice Set the owner and policy exactly once. Callable only by the Factory.
    function initialize(address owner, Policy calldata policy) external;

    /// @notice Open the trove with the BTC sent to the Factory. Callable only
    ///      by the Factory, during creation only (via createAndOpen).
    function openFor(uint256 debt, address upHint, address loHint, uint256 minDebtAhead)
        external
        payable;

    /// @notice The account owner, set once by initialize. No setter.
    function owner() external view returns (address);
}
