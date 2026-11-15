// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal SortedTroves surface needed by the Radar.
/// @dev Radar-scoped interface names (IRadar*) so this file stays self-contained:
/// task 1.1 owns `contracts/src/account/interfaces/` and may later provide the
/// shared interfaces; nothing here may collide with it or with `src/interfaces/IMezo.sol`.
interface IRadarSortedTroves {
    function getLast() external view returns (address);
    function getPrev(address trove) external view returns (address);
    function getSize() external view returns (uint256);
}

/// @notice Minimal TroveManager surface needed by the Radar.
interface IRadarTroveManager {
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
    function getTCR(uint256 price) external view returns (uint256);
    function checkRecoveryMode(uint256 price) external view returns (bool);
}

/// @notice Minimal PriceFeed surface needed by the Radar.
interface IRadarPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/// @title Redemption Radar (view-only)
/// @notice Reads SortedTroves + TroveManager + PriceFeed and answers, for any trove:
/// where it sits in redemption order, how much MUSD of debt must be redeemed
/// before redemption reaches it, and what the system looks like.
/// @dev Derived from the off-chain reference `lab/radar.py` (same walk: start at
/// `SortedTroves.getLast()`, follow `getPrev`). Redemptions walk from the lowest
/// NICR upward (TroveManager: walk starts at `getLast()`, troves with ICR < MCR
/// are skipped, redemption is blocked when TCR < MCR). All ratios are 1e18 scale.
/// NICR (nominal ICR, no price) is `coll * 1e18 / debt`; troves are sorted by NICR
/// descending, so the frontier (`getLast()`) has the lowest NICR.
///
/// Semantics (all debt figures are redeemable debt only, i.e. troves with
/// ICR >= MCR; non-redeemable troves contribute 0 to `debtAhead` but still
/// occupy their NICR position in the list):
/// - `rank`: 1-based position among redeemable troves counting from the frontier.
///   0 means "not ranked": the trove was not found within `maxSteps`, or it was
///   found but is itself not redeemable (ICR < MCR, redemption skips it).
/// - `debtAhead`: redeemable MUSD debt of troves strictly ahead of the target in
///   redemption order (excluding the target's own debt).
/// - `steps`: number of troves visited during the walk.
/// - `complete`: true iff the walk resolved (target found, or, for
///   `debtAheadForNICR`, the insertion point was reached / the list ended) within
///   `maxSteps`. False means the answer is a lower bound: more debt / a worse
///   rank may exist beyond the walked prefix. Callers that need a decision
///   (e.g. the shield) must treat `complete == false` as "cannot prove stress".
contract Radar {
    /// @notice Minimum collateral ratio: troves below this ICR are skipped by redemptions.
    uint256 public constant MCR = 1.1e18;

    IRadarSortedTroves public immutable sortedTroves;
    IRadarTroveManager public immutable troveManager;
    IRadarPriceFeed public immutable priceFeed;

    error ZeroAddress();

    constructor(address sortedTroves_, address troveManager_, address priceFeed_) {
        if (sortedTroves_ == address(0) || troveManager_ == address(0) || priceFeed_ == address(0)) {
            revert ZeroAddress();
        }
        sortedTroves = IRadarSortedTroves(sortedTroves_);
        troveManager = IRadarTroveManager(troveManager_);
        priceFeed = IRadarPriceFeed(priceFeed_);
    }

    /// @notice System-wide health: oracle price, total collateral ratio, Recovery
    /// Mode flag, and trove count. Single price read, shared by all three reads.
    function systemHealth()
        external
        view
        returns (uint256 price, uint256 tcr, bool recoveryMode, uint256 troveCount)
    {
        price = priceFeed.fetchPrice();
        tcr = troveManager.getTCR(price);
        recoveryMode = troveManager.checkRecoveryMode(price);
        troveCount = sortedTroves.getSize();
    }

    /// @notice The redemption frontier: the lowest-NICR trove (`SortedTroves.getLast()`).
    /// @return trove The frontier trove address (address(0) when no troves exist).
    /// @return icr Its current ICR at the live price (0 when no troves exist).
    /// @return debt Its entire debt (principal + interest + pending, 1e18 scale).
    function frontier() external view returns (address trove, uint256 icr, uint256 debt) {
        trove = sortedTroves.getLast();
        if (trove == address(0)) return (address(0), 0, 0);
        uint256 price = priceFeed.fetchPrice();
        icr = troveManager.getCurrentICR(trove, price);
        debt = _entireDebt(trove);
    }

    /// @notice Rank of `trove` counted from the frontier among redeemable troves.
    /// @dev Bounded walk with early exit: stops as soon as the target is reached.
    /// At most `maxSteps` troves are visited; pass a larger bound to resolve deep
    /// ranks (testnet has ~271 troves; mainnet has 4).
    /// @return rankOut 1-based redeemable rank (0 = not ranked: not found in range,
    /// or found but not redeemable).
    /// @return debtAhead Redeemable MUSD debt strictly ahead of the target.
    /// @return steps Troves visited.
    /// @return complete True iff the target was found within `maxSteps`.
    function rank(address trove, uint256 maxSteps)
        external
        view
        returns (uint256 rankOut, uint256 debtAhead, uint256 steps, bool complete)
    {
        if (trove == address(0) || maxSteps == 0) return (0, 0, 0, false);
        uint256 price = priceFeed.fetchPrice();
        address cur = sortedTroves.getLast();
        uint256 redeemableSeen;
        while (cur != address(0) && steps < maxSteps) {
            uint256 icr = troveManager.getCurrentICR(cur, price);
            bool redeemable = icr >= MCR;
            if (cur == trove) {
                // Target reached: debtAhead is everything redeemable before it.
                // Rank counts the target itself only when it is redeemable.
                return (redeemable ? redeemableSeen + 1 : 0, debtAhead, steps + 1, true);
            }
            if (redeemable) {
                redeemableSeen += 1;
                debtAhead += _entireDebt(cur);
            }
            cur = sortedTroves.getPrev(cur);
            steps += 1;
        }
        // Walk ended (list exhausted, or maxSteps hit) without finding the target.
        // `complete` is false in both cases: an exhausted list means the trove is
        // not in SortedTroves at all, which the caller must not mistake for safe.
        return (0, debtAhead, steps, false);
    }

    /// @notice What-if for the Open wizard: redeemable MUSD debt ahead of a
    /// hypothetical trove with nominal ICR `nicr` (coll * 1e18 / debt, no price).
    /// @dev Walks from the frontier (lowest NICR) upward, accumulating redeemable
    /// debt of every trove with NICR strictly below `nicr`; stops at the first
    /// trove with NICR >= `nicr` (the insertion point: that trove and everything
    /// toward the head sits behind the hypothetical trove).
    /// @return debtAhead Redeemable MUSD debt ahead of the hypothetical trove.
    /// @return complete True iff the insertion point was reached (or the list
    /// ended) within `maxSteps`; false means `debtAhead` is a lower bound.
    function debtAheadForNICR(uint256 nicr, uint256 maxSteps)
        external
        view
        returns (uint256 debtAhead, bool complete)
    {
        if (maxSteps == 0) return (0, false);
        uint256 price = priceFeed.fetchPrice();
        address cur = sortedTroves.getLast();
        uint256 steps;
        while (cur != address(0) && steps < maxSteps) {
            (uint256 coll, uint256 principal, uint256 interest, , , ) =
                troveManager.getEntireDebtAndColl(cur);
            uint256 debt = principal + interest;
            if (_nicr(coll, debt) >= nicr) {
                // Insertion point: this trove and everything after it is behind us.
                return (debtAhead, true);
            }
            if (troveManager.getCurrentICR(cur, price) >= MCR) {
                debtAhead += debt;
            }
            cur = sortedTroves.getPrev(cur);
            steps += 1;
        }
        // List exhausted: every trove is ahead of (i.e. below) the hypothetical one.
        // maxSteps exhausted: lower bound only.
        return (debtAhead, cur == address(0));
    }

    /// @dev Entire debt of a trove: principal + interest, exactly as the
    /// off-chain reference (`lab/radar.py`) computes it. Pending redistribution
    /// amounts are returned separately by `getEntireDebtAndColl` and are not
    /// included here, matching the reference.
    function _entireDebt(address trove) internal view returns (uint256) {
        (, uint256 principal, uint256 interest, , , ) = troveManager.getEntireDebtAndColl(trove);
        return principal + interest;
    }

    /// @dev Nominal ICR: coll / debt at 1e18 scale (no price). A trove with no
    /// debt would sort at the head; treat it as +infinity so the walk stops.
    function _nicr(uint256 coll, uint256 debt) internal pure returns (uint256) {
        if (debt == 0) return type(uint256).max;
        return (coll * 1e18) / debt;
    }
}
