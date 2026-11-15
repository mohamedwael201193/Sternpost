// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TroveAccount} from "./TroveAccount.sol";

/// @title TroveAccountMainnet
/// @notice Mainnet implementation variant (plan section 10, row 1.10):
///         the testnet TroveAccount plus an immutable per-session budget
///         cap. No session may ever be issued with a budget above
///         `MAX_SESSION_BUDGET` (default 20 MUSD); the cap is set once in
///         the constructor, has no setter, and applies to every clone of
///         this implementation. The testnet implementation has no cap.
/// @dev The cap is enforced in the `setSession` override, before the base
///      implementation runs. Deploy script: `script/DeployAccountsMainnet.
///      sol` (forge script, NO --broadcast: dry run on a mainnet fork
///      only). Never broadcast on mainnet from this repo.
contract TroveAccountMainnet is TroveAccount {
    /// @notice Hard cap on any single session budget (MUSD, 1e18 scale).
    uint256 public immutable MAX_SESSION_BUDGET;

    /// @notice A session was requested with a budget above the cap.
    error SessionBudgetAboveCap(uint128 budget, uint256 cap);

    constructor(
        address bo_,
        address tm_,
        address pf_,
        address musd_,
        address smusd_,
        address sortedTroves_,
        address feeRecipient_,
        uint16 feeBps_,
        uint256 maxSessionBudget_
    ) TroveAccount(bo_, tm_, pf_, musd_, smusd_, sortedTroves_, feeRecipient_, feeBps_) {
        MAX_SESSION_BUDGET = maxSessionBudget_;
    }

    function setSession(
        address agent,
        uint128 budget,
        uint128 perTx,
        uint128 dailyLimit,
        uint64 expiry,
        bool anyPayee,
        bool canSignX402
    ) external override onlyOwner {
        if (budget > MAX_SESSION_BUDGET) revert SessionBudgetAboveCap(budget, MAX_SESSION_BUDGET);
        _setSession(agent, budget, perTx, dailyLimit, expiry, anyPayee, canSignX402);
    }
}
