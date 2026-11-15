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
///      Fee parity (adversarial review of task 1.1, finding F2, and J3-extra
///      round 2 item 1): `initialize` takes the Factory's feeRecipient/
///      feeBps and the implementation reverts unless they equal its own
///      immutables, so a mismatched implementation deployment cannot silently
///      charge a different fee from the one the Factory advertises. The
///      fee getters below let the Factory constructor assert that parity at
///      deploy time too (the fee lives as immutables in the implementation
///      bytecode, which the Factory never verified before).
interface ITroveAccount {
    /// @notice Set the owner and policy exactly once. Callable only by the Factory.
    /// @param feeRecipient_ The Factory's fee recipient; must equal the
    ///        implementation's immutable feeRecipient.
    /// @param feeBps_ The Factory's fee in bps; must equal the
    ///        implementation's immutable feeBps.
    function initialize(address owner, Policy calldata policy, address feeRecipient_, uint16 feeBps_) external;

    /// @notice Agent-draw fee in basis points (implementation immutable).
    function feeBps() external view returns (uint16);

    /// @notice Receives the agent-draw fee (implementation immutable).
    function feeRecipient() external view returns (address);

    /// @notice Open the trove with the BTC sent to the Factory. Callable only
    ///      by the Factory, during creation only (via createAndOpen).
    function openFor(uint256 debt, address upHint, address loHint, uint256 minDebtAhead)
        external
        payable;

    /// @notice The account owner, set once by initialize. No setter.
    function owner() external view returns (address);
}
