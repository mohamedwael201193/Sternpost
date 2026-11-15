// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBO} from "./interfaces/IBO.sol";
import {ITM} from "./interfaces/ITM.sol";
import {IPF} from "./interfaces/IPF.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {ISMUSD} from "./interfaces/ISMUSD.sol";
import {ISortedTroves} from "./interfaces/ISortedTroves.sol";
import {ITroveAccount, Policy} from "./interfaces/ITroveAccount.sol";

/// @notice Minimal view of Mezo BorrowerOperations' public CollSurplusPool
///         getter (live: `ICollSurplusPool public collSurplusPool`,
///         mezo-org/musd BorrowerOperations.sol).
interface IBOWithCollSurplusPool {
    function collSurplusPool() external view returns (address);
}

/// @notice Minimal view of Mezo CollSurplusPool: the surplus BTC owed to an
///         account. Live `claimColl` reverts on a zero balance
///         ("CollSurplusPool: No collateral available to claim").
interface ICollSurplusPool {
    function getCollateral(address account) external view returns (uint256);
}

/// @title TroveAccount
/// @notice The borrower: one clone per user, deployed by TroveAccountFactory
///         as an ERC-1167 minimal proxy. Non-upgradeable, no pause, owner set
///         once by `initialize` (plan sections 3.1, 3.3).
/// @dev Mezo addresses, fee recipient and fee bps live in the implementation
///      bytecode as immutables and apply to every clone. The owner, policy,
///      sessions and epoch live in clone storage.
///      PRODUCTION POLICY ORDERING (plan 3.3): `shieldICR < floorICR` and
///      `shieldICR < targetICR`. The lab enforced the opposite ordering
///      (`floor < shield < target`); do NOT mix lab numbers with production
///      policy values. Production defaults: floor 2.50e18, shield 1.60e18,
///      target 2.00e18, bounty 1e18, cooldown 20.
///      Fee parity (adversarial review of task 1.1, finding F2): the Factory
///      passes its own feeRecipient/feeBps into `initialize`, which reverts
///      `FeeMismatch` unless they equal the implementation immutables. The
///      only fee values a clone can ever carry are the ones its Factory
///      passed at creation; a mismatched implementation deployment cannot
///      silently charge a different fee.
///      Policy griefing (finding F1): the Factory binds the policy hash into
///      the CREATE2 salt, so a front-run createAccount with an
///      attacker-chosen policy lands at a different address and can never
///      steal the victim's (owner, salt).
///      `spIn`/`spOut` are CUT (plan 3.3): StabilityPool deferred, the lab
///      verdict is that liquidations consume its MUSD.
///      `shield()` is task 1.4 and is NOT in this file yet; `needed()` below
///      is the ICR view shield will use (reason 2 RANK is reserved for the
///      1.4/1.5 rank integration).
contract TroveAccount is ITroveAccount {
    // ---- Immutables (implementation bytecode; shared by all clones) ----
    IBO public immutable bo;
    ITM public immutable tm;
    IPF public immutable pf;
    IERC20 public immutable musd;
    ISMUSD public immutable smusd;
    ISortedTroves public immutable sortedTroves;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;

    // ---- Constants ----
    uint256 public constant GAS_COMP = 200e18;
    uint16 public constant MAX_FEE_BPS = 50;
    uint256 public constant MAX_BOUNTY = 5e18;
    uint256 public constant MIN_SHIELD_ICR = 1.15e18;
    uint256 public constant MAX_TARGET_ICR = 10e18;
    uint256 public constant MAX_SESSION = 90 days;
    uint256 public constant MAX_RANK_STEPS = 25;
    uint256 public constant MCR = 1.1e18;
    uint256 public constant NICR_SCALE = 1e20; // canonical on-chain NICR scale: coll * 1e20 / debt
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    bytes4 public constant MAGIC = 0x1626ba7e;
    bytes32 public constant INTENT_TYPEHASH =
        keccak256("DrawIntent(address agent,address payee,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant DOMAIN_NAME_HASH = keccak256("SternpostTroveAccount");
    bytes32 public constant DOMAIN_VERSION_HASH = keccak256("1");
    uint256 public constant LOW_S_MAX = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    // ---- Storage (clone storage) ----
    address public override owner;
    address public factory;
    Policy public policy;
    bool public initialized;
    bool public opened;
    uint32 public sessionEpoch;
    mapping(address => Session) public sessions;
    mapping(address => mapping(uint32 => mapping(address => bool))) public payeeOk;
    mapping(address => uint32) public genCounter;
    mapping(address => uint256) public intentNonce;
    uint64 public lastShieldBlock;
    uint256 private _lock;

    struct Session {
        uint128 budget;
        uint128 spent;
        uint128 perTx;
        uint128 dailyLimit;
        uint128 daySpent;
        uint64 expiry;
        uint64 dayStart;
        uint32 epoch;
        uint32 gen;
        bool anyPayee;
        bool canSignX402;
        bool active;
    }

    // ---- Errors (selectors are API; the SDK maps them to reason strings) ----
    error NotOwner();
    error SessionInactive();
    error PayeeNotAllowed(address payee);
    error OverPerTx(uint256 gross, uint256 cap);
    error OverBudget(uint256 gross, uint256 remaining);
    error OverDaily(uint256 gross, uint256 remaining);
    error BelowFloor(uint256 icrAfter, uint256 floor);
    error RecoveryMode(uint256 tcr);
    error TroveNotActive(uint8 status);
    error NotStressed(uint256 icr);
    error NothingToDo();
    error Cooldown(uint256 blocksLeft);
    error Expired();
    error BadSig();
    error BadNonce();
    error BelowMinDebt(uint256 debt, uint256 min);
    error RedemptionExposed(uint256 debtAhead, uint256 min);
    error NeedMusd(uint256 shortfall);
    error BadPolicy();
    error BountyTooHigh();
    error ZeroAmount();
    error AlreadyInitialized();
    error AlreadyOpened();
    error Reentrancy();
    error TransferFailed();
    error ZeroOwner();
    error ZeroAddress();
    error NotFactory();
    error FeeBpsTooHigh(uint16 feeBps);
    error InvalidFeeRecipient(address feeRecipient);
    error FeeMismatch(address feeRecipient, uint16 feeBps);
    error BadSession();

    // ---- Events (names are API: the indexer, leaderboard and quests read them) ----
    event TroveOpened(address indexed owner, uint256 coll, uint256 debt, uint256 icr);
    event PolicySet(uint256 floorICR, uint256 shieldICR, uint256 targetICR, uint256 bounty, uint256 minDebtAhead);
    event SessionOpened(
        address indexed agent, uint256 budget, uint256 perTx, uint256 dailyLimit, uint64 expiry, bool anyPayee, bool canSignX402
    );
    event SessionRevoked(address indexed agent);
    event AllSessionsRevoked(uint32 epoch);
    event Drawn(address indexed agent, address indexed payee, uint256 amount, uint256 fee, uint256 icrAfter);
    event Refilled(address indexed agent, uint256 amount);
    event OwnerBorrowed(address indexed to, uint256 amount, uint256 icrAfter);
    event Shielded(
        address indexed keeper, uint256 repaid, uint256 collAdded, uint256 icrBefore, uint256 icrAfter, uint8 reason, uint256 bountyPaid
    );
    event Parked(uint256 amount);
    event Unparked(uint256 amount);
    event YieldClaimed(uint256 amount);
    event CollateralClaimed(uint256 amount);
    event Checkpoint(uint8 status, uint256 icr, uint256 tcr, bool recoveryMode);
    event Closed(uint256 btcReturned, uint256 musdReturned);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 0) revert Reentrancy();
        _lock = 1;
        _;
        _lock = 0;
    }

    /// @param bo_ Mezo BorrowerOperations.
    /// @param tm_ Mezo TroveManager.
    /// @param pf_ Mezo PriceFeed.
    /// @param musd_ MUSD token.
    /// @param smusd_ sMUSD savings vault.
    /// @param sortedTroves_ Mezo SortedTroves (neighbour hints + rank walk).
    /// @param feeRecipient_ Receives the agent-draw fee; never address(0)/burn.
    /// @param feeBps_ Agent-draw fee in bps, <= MAX_FEE_BPS (default 10).
    constructor(
        address bo_,
        address tm_,
        address pf_,
        address musd_,
        address smusd_,
        address sortedTroves_,
        address feeRecipient_,
        uint16 feeBps_
    ) {
        if (
            bo_ == address(0) || tm_ == address(0) || pf_ == address(0) || musd_ == address(0) || smusd_ == address(0)
                || sortedTroves_ == address(0)
        ) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps_);
        if (feeRecipient_ == address(0) || feeRecipient_ == BURN) revert InvalidFeeRecipient(feeRecipient_);
        bo = IBO(bo_);
        tm = ITM(tm_);
        pf = IPF(pf_);
        musd = IERC20(musd_);
        smusd = ISMUSD(smusd_);
        sortedTroves = ISortedTroves(sortedTroves_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    receive() external payable {}

    // ============ Init (Factory only, once) ============

    /// @notice Set the owner and policy exactly once. Callable only by the
    ///         Factory that created this clone (the first caller is recorded
    ///         as `factory`); reverts `AlreadyInitialized` afterwards.
    /// @dev Fee parity (F2): the Factory's feeRecipient/feeBps must equal the
    ///      implementation immutables, else `FeeMismatch`. Approves sMUSD to
    ///      pull the account's MUSD for `park()` (the lab approved in its
    ///      constructor; a clone has no constructor run, so it happens here).
    function initialize(address owner_, Policy calldata p, address feeRecipient_, uint16 feeBps_) external override {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroOwner();
        _validatePolicy(p);
        if (feeRecipient_ != feeRecipient || feeBps_ != feeBps) revert FeeMismatch(feeRecipient_, feeBps_);
        initialized = true;
        factory = msg.sender;
        owner = owner_;
        policy = p;
        musd.approve(address(smusd), type(uint256).max);
        emit PolicySet(p.floorICR, p.shieldICR, p.targetICR, p.bounty, p.minDebtAhead);
    }

    /// @notice Open the trove with the BTC sent to the Factory. Callable only
    ///         by the Factory, during creation only (via `createAndOpen`).
    function openFor(uint256 debt, address upHint, address loHint, uint256 minDebtAhead)
        external
        payable
        override
        nonReentrant
    {
        if (msg.sender != factory) revert NotFactory();
        _open(debt, upHint, loHint, minDebtAhead);
    }

    // ============ Owner: trove lifecycle ============

    /// @notice Open the trove (owner path; `openFor` is the factory path).
    ///         Requires `debt >= bo.minNetDebt()` else `BelowMinDebt`; when
    ///         `minDebtAhead > 0` a COMPLETED bounded rank walk proving less
    ///         redeemable debt ahead than `minDebtAhead` reverts
    ///         `RedemptionExposed` (plan 3.7(c): step exhaustion is treated
    ///         as safe, exposure unproven).
    function open(uint256 debt, address upHint, address loHint, uint256 minDebtAhead)
        external
        payable
        onlyOwner
        nonReentrant
    {
        _open(debt, upHint, loHint, minDebtAhead);
    }

    /// @notice Add BTC collateral. Allowed in Recovery Mode.
    function addColl(address upHint, address loHint) external payable onlyOwner nonReentrant {
        bo.addColl{value: msg.value}(upHint, loHint);
    }

    /// @notice Withdraw BTC collateral to the owner. Blocked in Recovery Mode
    ///         by Mezo itself; the BTC first lands in this account and is
    ///         then forwarded to the owner.
    function withdrawColl(uint256 amount, address upHint, address loHint) external onlyOwner nonReentrant {
        bo.withdrawColl(amount, upHint, loHint);
        _sendBtc(owner, amount);
    }

    /// @notice Repay MUSD. Allowed in Recovery Mode. Bounded by the minimum
    ///         net debt (G1): the remaining debt may not fall below
    ///         `bo.minNetDebt()`, else `BelowMinDebt`.
    function repay(uint256 amount, address upHint, address loHint) external onlyOwner nonReentrant {
        (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(this));
        uint256 debt = principal + interest;
        uint256 minNet = bo.minNetDebt();
        uint256 remaining = amount >= debt ? 0 : debt - amount;
        if (remaining < minNet) revert BelowMinDebt(remaining, minNet);
        bo.repayMUSD(amount, upHint, loHint);
    }

    /// @notice Owner borrow straight to an address. No fee, no budget; the
    ///         post-borrow ICR floor is still enforced.
    function borrowTo(uint256 amount, address to, address upHint, address loHint) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 icr = _borrowChecked(amount, upHint, loHint);
        _safeTransfer(to, amount);
        emit OwnerBorrowed(to, amount, icr);
    }

    /// @notice Owner-always-exits (plan 3.6, invariant I5). Revokes every
    ///         session first, then: active trove -> unpark all, require
    ///         enough MUSD (`debt - 200e18` gas comp is paid by the protocol
    ///         pool) else `NeedMusd`, `closeTrove()`; redeemed trove (status
    ///         4) -> `claimCollateral()` first; already-closed / liquidated /
    ///         non-existent -> nothing to close. Finally sweeps ALL BTC and
    ///         ALL MUSD to the owner. Reverts `RecoveryMode` for an active
    ///         trove in Recovery Mode (Mezo blocks closing in RM).
    function closeAccount() external onlyOwner nonReentrant {
        _revokeAll();
        uint8 st = status();
        if (st == 1) {
            uint256 price = pf.fetchPrice();
            if (tm.checkRecoveryMode(price)) revert RecoveryMode(tm.getTCR(price));
            uint256 smusdBal = smusd.balanceOf(address(this));
            if (smusdBal > 0) {
                smusd.withdraw(smusdBal);
                emit Unparked(smusdBal);
            }
            (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(this));
            uint256 debt = principal + interest;
            uint256 need = debt > GAS_COMP ? debt - GAS_COMP : 0;
            uint256 bal = musd.balanceOf(address(this));
            if (bal < need) revert NeedMusd(need - bal);
            bo.closeTrove();
        } else if (st == 4) {
            _claimCollateral();
        }
        uint256 btcBal = address(this).balance;
        uint256 musdBal = musd.balanceOf(address(this));
        if (btcBal > 0) _sendBtc(owner, btcBal);
        if (musdBal > 0) _safeTransfer(owner, musdBal);
        emit Closed(btcBal, musdBal);
    }

    // ============ Owner: policy + sessions ============

    /// @notice Replace the policy. Validates production ordering:
    ///         `1.15e18 <= shieldICR < targetICR <= 10e18`,
    ///         `shieldICR < floorICR`, `bounty <= 5e18`.
    function setPolicy(Policy calldata p) external onlyOwner {
        _validatePolicy(p);
        policy = p;
        emit PolicySet(p.floorICR, p.shieldICR, p.targetICR, p.bounty, p.minDebtAhead);
    }

    /// @notice Issue (or re-issue) a session key. Increments the agent's
    ///         generation, so a re-issued session never inherits old payees;
    ///         resets `spent`/`daySpent`. `expiry` is mandatory: it must be
    ///         in the future and at most 90 days out, else `BadSession`.
    function setSession(
        address agent,
        uint128 budget,
        uint128 perTx,
        uint128 dailyLimit,
        uint64 expiry,
        bool anyPayee,
        bool canSignX402
    ) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_SESSION) revert BadSession();
        uint32 gen = ++genCounter[agent];
        sessions[agent] = Session({
            budget: budget,
            spent: 0,
            perTx: perTx,
            dailyLimit: dailyLimit,
            daySpent: 0,
            expiry: expiry,
            dayStart: uint64(block.timestamp),
            epoch: sessionEpoch,
            gen: gen,
            anyPayee: anyPayee,
            canSignX402: canSignX402,
            active: true
        });
        emit SessionOpened(agent, budget, perTx, dailyLimit, expiry, anyPayee, canSignX402);
    }

    /// @notice Allow or deny a payee for the agent's CURRENT session
    ///         generation. Set payees AFTER `setSession`: a later
    ///         `setSession` bumps the generation and the old allowlist stops
    ///         applying.
    function setPayee(address agent, address payee, bool ok) external onlyOwner {
        payeeOk[agent][sessions[agent].gen][payee] = ok;
    }

    /// @notice Revoke one agent's session. The generation counter is kept, so
    ///         a later re-issue gets a fresh generation.
    function revokeSession(address agent) external onlyOwner {
        delete sessions[agent];
        emit SessionRevoked(agent);
    }

    /// @notice Revoke every session at once: `sessionEpoch++`. A session is
    ///         live only when `s.epoch == sessionEpoch`.
    function revokeAll() external onlyOwner {
        _revokeAll();
    }

    function _revokeAll() internal {
        sessionEpoch++;
        emit AllSessionsRevoked(sessionEpoch);
    }

    // ============ Owner: allowances, buffer, sweeps ============

    /// @notice Permit2 allowance = the x402 spend cap for this account.
    function approveToken(address spender, uint256 amount) external onlyOwner {
        musd.approve(spender, amount);
    }

    /// @notice Move MUSD into the sMUSD buffer (yield-bearing).
    function park(uint256 amount) external onlyOwner nonReentrant {
        smusd.deposit(amount);
        emit Parked(amount);
    }

    /// @notice Move MUSD out of the sMUSD buffer; sMUSD auto-claims yield
    ///         on withdraw.
    function unpark(uint256 amount) external onlyOwner nonReentrant {
        smusd.withdraw(amount);
        emit Unparked(amount);
    }

    /// @notice Recover MUSD held by the account to the owner.
    function sweepMusd(uint256 amount) external onlyOwner nonReentrant {
        _safeTransfer(owner, amount);
    }

    /// @notice Recover BTC held by the account to the owner.
    function sweepBtc(uint256 amount) external onlyOwner nonReentrant {
        _sendBtc(owner, amount);
    }

    // ============ Anyone: claims + checkpoint ============

    /// @notice Claim post-redemption surplus BTC from Mezo's CollSurplusPool.
    ///         Permissionless (task 1.6 owns the fork test); the BTC lands in
    ///         this account and the owner sweeps it. A zero surplus is a
    ///         no-op that still emits `CollateralClaimed(0)`: live
    ///         `claimColl` reverts on zero, and a redeemed trove whose
    ///         surplus was already claimed must not brick `closeAccount()`.
    function claimCollateral() external nonReentrant {
        _claimCollateral();
    }

    function _claimCollateral() internal {
        // Live CollSurplusPool.claimColl reverts when the surplus is zero
        // ("CollSurplusPool: No collateral available to claim"). Read the
        // surplus first via BO's public collSurplusPool and skip the claim
        // when there is nothing to claim; surplus > 0 claims exactly as
        // before. Found live on a mainnet fork by the 1.6 builder:
        // closeAccount() on a redeemed trove with an already-claimed (or
        // never-existing) surplus reverted and the account could not close.
        address pool = IBOWithCollSurplusPool(address(bo)).collSurplusPool();
        if (ICollSurplusPool(pool).getCollateral(address(this)) == 0) {
            emit CollateralClaimed(0);
            return;
        }
        uint256 before = address(this).balance;
        bo.claimCollateral();
        uint256 amount = address(this).balance - before;
        emit CollateralClaimed(amount);
    }

    /// @notice Claim sMUSD yield in MUSD. Permissionless; the yield stays in
    ///         the account.
    function claimYield() external nonReentrant returns (uint256) {
        uint256 y = smusd.claimYield();
        emit YieldClaimed(y);
        return y;
    }

    /// @notice Emit a health checkpoint for the indexer/Telegram bot (views
    ///         cannot emit). Reads the price once.
    function checkpoint() external {
        uint256 price = pf.fetchPrice();
        uint256 icr = tm.getCurrentICR(address(this), price);
        uint256 tcr = tm.getTCR(price);
        bool rm = tm.checkRecoveryMode(price);
        emit Checkpoint(status(), icr, tcr, rm);
    }

    // ============ Agent: draw ============

    /// @notice Agent draw (plan 3.4). Borrows exactly what is paid, enforces
    ///         the session budget/per-tx/daily caps on the GROSS amount
    ///         (amount + fee), the post-draw ICR floor, and Recovery Mode.
    ///         `payee == address(this)` is the x402 pay-by-borrow refill
    ///         step and emits `Refilled` instead of transferring out.
    function draw(address payee, uint256 amount) external nonReentrant {
        _draw(msg.sender, payee, amount);
    }

    function _draw(address agent, address payee, uint256 amount) internal {
        Session storage s = sessions[agent];
        if (!_sessionLive(s)) revert SessionInactive();
        if (!(s.anyPayee || payeeOk[agent][s.gen][payee])) revert PayeeNotAllowed(payee);
        if (amount == 0) revert ZeroAmount();
        uint256 fee = _drawFee(amount);
        uint256 gross = amount + fee;
        if (gross > s.perTx) revert OverPerTx(gross, s.perTx);
        if (s.spent + gross > s.budget) revert OverBudget(gross, s.budget - s.spent);
        _rollDay(s);
        if (s.dailyLimit != 0 && s.daySpent + gross > s.dailyLimit) {
            revert OverDaily(gross, s.dailyLimit - s.daySpent);
        }
        s.spent += uint128(gross);
        s.daySpent += uint128(gross);
        (address up, address lo) = _hints();
        uint256 icr = _borrowChecked(gross, up, lo);
        if (fee != 0) _safeTransfer(feeRecipient, fee);
        if (payee == address(this)) {
            emit Refilled(agent, amount);
        } else {
            _safeTransfer(payee, amount);
        }
        emit Drawn(agent, payee, amount, fee, icr);
    }

    /// @notice Gasless/relayable draw: the agent signs an EIP-712 intent,
    ///         ANYONE (a Batcher, a relayer) submits it. Per-agent nonce
    ///         lives in this contract, so intents of different agents never
    ///         conflict. Hardening (plan 3.5/3.13 item 9): length checked
    ///         BEFORE slicing, low-s, v in {27,28}, zero-address guard, the
    ///         nonce is consumed only after the signature validates.
    function drawBySig(address agent, address payee, uint256 amount, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        if (block.timestamp > deadline) revert Expired();
        if (sig.length != 65) revert BadSig();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s_ = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v != 27 && v != 28) revert BadSig();
        if (uint256(s_) > LOW_S_MAX) revert BadSig();
        bytes32 d = intentDigest(agent, payee, amount, intentNonce[agent], deadline);
        address rec = ecrecover(d, v, r, s_);
        if (rec == address(0) || rec != agent) revert BadSig();
        intentNonce[agent]++;
        _draw(agent, payee, amount);
    }

    // ============ Views ============

    /// @notice Trove status: 0 none, 1 active, 2 closedByOwner,
    ///         3 closedByLiquidation, 4 closedByRedemption (Mezo enum, uint8).
    function status() public view returns (uint8) {
        return tm.getTroveStatus(address(this));
    }

    /// @notice What the shield would need to restore ICR to `targetICR`.
    ///         `reason`: 0 none, 1 ICR, 2 RANK (rank is wired by 1.4/1.5).
    ///         Repay is bounded by the minimum net debt + gas comp (G1).
    function needed() external view returns (uint256 icr, uint256 repayWanted, uint256 collWanted, uint8 reason) {
        uint256 price = pf.fetchPrice();
        (uint256 coll, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(this));
        uint256 debt = principal + interest;
        icr = debt == 0 ? type(uint256).max : coll * price / debt;
        if (icr >= policy.targetICR) return (icr, 0, 0, 0);
        uint256 minNet = bo.minNetDebt();
        uint256 cap = debt > GAS_COMP + minNet ? debt - GAS_COMP - minNet : 0;
        uint256 targetDebt = coll * price / policy.targetICR;
        uint256 x = debt > targetDebt ? debt - targetDebt : 0;
        repayWanted = x < cap ? x : cap;
        uint256 needColl = policy.targetICR * (debt - repayWanted) / price;
        collWanted = needColl > coll ? needColl - coll : 0;
        reason = icr < policy.shieldICR ? 1 : 0;
    }

    /// @notice Dry-run a draw without state changes. `reasonCode`: 0 OK,
    ///         1 SESSION_INACTIVE, 2 PAYEE_NOT_ALLOWED, 3 OVER_PER_TX,
    ///         4 OVER_BUDGET, 5 OVER_DAILY, 6 BELOW_FLOOR, 7 RECOVERY_MODE,
    ///         8 TROVE_NOT_ACTIVE, 9 ZERO_AMOUNT. Reads
    ///         `getEntireDebtAndColl` ONCE (pending already folded in) and
    ///         includes Mezo's borrowing fee unless in Recovery Mode.
    function previewDraw(address agent, address payee, uint256 amount)
        external
        view
        returns (bool ok, uint8 reasonCode, uint256 icrAfter, uint256 fee)
    {
        fee = _drawFee(amount);
        if (amount == 0) return (false, 9, 0, fee);
        Session storage s = sessions[agent];
        if (!_sessionLive(s)) return (false, 1, 0, fee);
        if (!(s.anyPayee || payeeOk[agent][s.gen][payee])) return (false, 2, 0, fee);
        uint256 gross = amount + fee;
        if (gross > s.perTx) return (false, 3, 0, fee);
        if (s.spent + gross > s.budget) return (false, 4, 0, fee);
        uint256 daySpent = s.daySpent;
        if (block.timestamp >= s.dayStart + 1 days) daySpent = 0;
        if (s.dailyLimit != 0 && daySpent + gross > s.dailyLimit) return (false, 5, 0, fee);
        uint8 st = status();
        if (st != 1) return (false, 8, 0, fee);
        uint256 price = pf.fetchPrice();
        if (tm.checkRecoveryMode(price)) return (false, 7, 0, fee);
        (uint256 coll, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(this));
        uint256 debt = principal + interest;
        uint256 borrowFee = bo.getBorrowingFee(gross);
        uint256 debtAfter = debt + gross + borrowFee;
        icrAfter = coll * price / debtAfter;
        if (icrAfter < policy.floorICR) return (false, 6, icrAfter, fee);
        return (true, 0, icrAfter, fee);
    }

    /// @notice Pending sMUSD yield for this account, plan 3.10 formula:
    ///         `balance * (yieldIndex - supplyYieldIndex) / 1e18`.
    function pendingYield() external view returns (uint256) {
        uint256 bal = smusd.balanceOf(address(this));
        uint256 idx = smusd.yieldIndex();
        uint256 mine = smusd.supplyYieldIndex(address(this));
        if (idx <= mine) return 0;
        return bal * (idx - mine) / 1e18;
    }

    /// @notice EIP-1271: returns the magic value iff `sig` is a well-formed
    ///         65-byte low-s signature whose signer holds a LIVE session
    ///         with `canSignX402 == true` (plan 3.9).
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length != 65) return bytes4(0xffffffff);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s_ = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v != 27 && v != 28) return bytes4(0xffffffff);
        if (uint256(s_) > LOW_S_MAX) return bytes4(0xffffffff);
        address a = ecrecover(hash, v, r, s_);
        if (a == address(0)) return bytes4(0xffffffff);
        Session storage sess = sessions[a];
        if (!_sessionLive(sess) || !sess.canSignX402) return bytes4(0xffffffff);
        return MAGIC;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, address(this))
        );
    }

    function intentDigest(address agent, address payee, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(bytes2(0x1901), domainSeparator(), keccak256(abi.encode(INTENT_TYPEHASH, agent, payee, amount, nonce, deadline)))
        );
    }

    // ============ Internals ============

    function _validatePolicy(Policy calldata p) internal pure {
        if (
            p.shieldICR < MIN_SHIELD_ICR || p.shieldICR >= p.targetICR || p.targetICR > MAX_TARGET_ICR
                || p.shieldICR >= p.floorICR
        ) revert BadPolicy();
        if (p.bounty > MAX_BOUNTY) revert BountyTooHigh();
    }

    function _open(uint256 debt, address upHint, address loHint, uint256 minDebtAhead) internal {
        if (opened) revert AlreadyOpened();
        if (minDebtAhead > type(uint128).max) revert BadPolicy();
        uint256 minNet = bo.minNetDebt();
        if (debt < minNet) revert BelowMinDebt(debt, minNet);
        if (minDebtAhead > 0) {
            // Nominal ICR of the trove about to open, canonical 1e20 scale.
            uint256 nicr = debt == 0 ? type(uint256).max : msg.value * NICR_SCALE / debt;
            (uint256 debtAhead, bool complete) = _debtAheadForNICR(nicr, minDebtAhead);
            // Plan 3.7(c): step exhaustion is treated as safe (exposure was
            // never proven), so revert only on a COMPLETED walk that proves
            // debtAhead < minDebtAhead.
            if (complete && debtAhead < minDebtAhead) revert RedemptionExposed(debtAhead, minDebtAhead);
        }
        bo.openTrove{value: msg.value}(debt, upHint, loHint);
        opened = true;
        policy.minDebtAhead = uint128(minDebtAhead);
        uint256 icr = tm.getCurrentICR(address(this), pf.fetchPrice());
        emit TroveOpened(owner, msg.value, debt, icr);
    }

    /// @notice Bounded redemption-order walk (plan 3.7): start at
    ///         `sortedTroves.getLast()` (lowest NICR), accumulate the debt of
    ///         redeemable troves (ICR >= 110%) with a NICR below ours, stop
    ///         when the accumulated debt reaches `minDebtAhead`, when a trove
    ///         with NICR >= ours is reached, or after MAX_RANK_STEPS.
    /// @return debtAhead Redeemable debt ahead of the hypothetical trove.
    /// @return complete True only when the walk PROVED the total: it stopped
    ///         because a trove with NICR >= ours was reached, the list ended,
    ///         or a zero-debt entry was hit. False when MAX_RANK_STEPS was
    ///         exhausted (plan 3.7(c): treat as safe, exposure unproven) or
    ///         when the accumulated debt already reached `minDebtAhead`.
    function _debtAheadForNICR(uint256 nicr, uint256 minDebtAhead)
        internal
        view
        returns (uint256 debtAhead, bool complete)
    {
        uint256 price = pf.fetchPrice();
        address cur = sortedTroves.getLast();
        uint256 steps;
        while (cur != address(0) && steps < MAX_RANK_STEPS) {
            (uint256 coll, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(cur);
            uint256 troveDebt = principal + interest;
            if (troveDebt == 0) {
                complete = true;
                break;
            }
            uint256 troveNicr = coll * NICR_SCALE / troveDebt;
            if (troveNicr >= nicr) {
                complete = true;
                break;
            }
            if (troveNicr * price / NICR_SCALE >= MCR) debtAhead += troveDebt;
            if (debtAhead >= minDebtAhead) break;
            cur = sortedTroves.getPrev(cur);
            steps++;
        }
        // The list ended: every trove ahead was examined, so the total is
        // proved. (If steps ran out exactly as the list ended, cur is
        // address(0) too and the walk is likewise complete.)
        if (cur == address(0)) complete = true;
    }

    /// @notice Shared borrow path for `_draw` and `borrowTo`: status and
    ///         Recovery Mode are checked BEFORE Mezo is called, the price is
    ///         read ONCE, neighbour hints are used, and the post-borrow ICR
    ///         must stay at/above the floor.
    function _borrowChecked(uint256 amount, address upHint, address loHint) internal returns (uint256 icr) {
        uint8 st = status();
        if (st != 1) revert TroveNotActive(st);
        uint256 price = pf.fetchPrice();
        if (tm.checkRecoveryMode(price)) revert RecoveryMode(tm.getTCR(price));
        bo.withdrawMUSD(amount, upHint, loHint);
        icr = tm.getCurrentICR(address(this), price);
        if (icr < policy.floorICR) revert BelowFloor(icr, policy.floorICR);
    }

    function _sessionLive(Session storage s) internal view returns (bool) {
        return s.active && s.epoch == sessionEpoch && s.expiry >= block.timestamp;
    }

    function _rollDay(Session storage s) internal {
        if (block.timestamp >= s.dayStart + 1 days) {
            s.dayStart = uint64(block.timestamp);
            s.daySpent = 0;
        }
    }

    function _drawFee(uint256 amount) internal view returns (uint256) {
        if (feeBps == 0) return 0;
        return (amount * feeBps + 9_999) / 10_000;
    }

    /// @notice Neighbour hints for SortedTroves re-insertion; falls back to
    ///         (0,0) when this trove is not in the list.
    function _hints() internal view returns (address up, address lo) {
        if (sortedTroves.contains(address(this))) {
            return (sortedTroves.getPrev(address(this)), sortedTroves.getNext(address(this)));
        }
        return (address(0), address(0));
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (!musd.transfer(to, amount)) revert TransferFailed();
    }

    function _sendBtc(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
