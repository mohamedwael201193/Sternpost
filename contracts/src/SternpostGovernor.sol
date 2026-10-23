// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IERC20Min,
    IBorrowerOperationsSignatures,
    ITroveManager,
    IPriceFeed,
    IBorrowerOperations,
    ISavingsMUSD
} from "./interfaces/IMezo.sol";

/// @title SternpostGovernor
/// @notice A per-borrower policy contract that lets approved apps draw MUSD from the borrower's own Mezo trove
///         through BorrowerOperationsSignatures, while enforcing a collateral-ratio floor and per-app budgets
///         in the same transaction.
/// @dev Threat model (see docs/THREAT_MODEL.md):
///      The native WithdrawMUSD signature binds (amount, borrower, recipient, nonce, deadline) only. Anyone holding
///      a signature that names this contract as recipient could submit it straight to the native contract.
///      On the current Mezo implementation every withdraw ends with ActivePool.sendCollateral(recipient, 0), which
///      calls `recipient` with zero value. This contract's receive() rejects that call unless it happens inside
///      draw(), so a direct submission reverts atomically (no debt, nonce untouched).
///      draw() also requires exactly one such callback, so if Mezo ever removes it, honest draws fail closed and
///      the dependency surfaces immediately. Stray MUSD that reaches this contract outside draw() can only be
///      repaid into the trove via heal().
contract SternpostGovernor {
    // ---------------------------------------------------------------- immutables
    address public immutable borrower;
    IBorrowerOperationsSignatures public immutable signatures;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IERC20Min public immutable musd;
    address public immutable activePool;
    ISavingsMUSD public immutable savings; // address(0) disables the sMUSD reserve option
    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 public constant MAX_WINDOW = 120; // seconds a withdraw signature may live
    uint256 public constant MIN_FLOOR = 1.1e18; // never below Mezo's MCR
    bytes32 public constant REPAY_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    // ---------------------------------------------------------------- state
    struct AppPolicy {
        uint128 budget; // total MUSD the app may draw
        uint128 spent; // MUSD already drawn
        uint128 perDrawMax; // cap per draw
        uint64 expiry; // unix seconds; 0 = disabled
        address payee; // address(0) = any payee
    }

    struct Standby {
        uint128 amount;
        uint64 deadline;
        uint64 nonce;
        bytes signature;
    }

    uint256 public floorICR; // draws may not push ICR below this
    uint256 public defendICR; // below this anyone may trigger defend()
    bool public frozen;
    uint256 public buffer; // borrower-funded MUSD held liquid for defend()
    uint256 public parked; // part of the buffer deposited in sMUSD
    mapping(address => AppPolicy) public appPolicy;
    Standby internal _standby;

    uint256 private _lock = 1;
    bool private _inDraw;
    uint8 private _callbacks;

    // ---------------------------------------------------------------- events
    event PolicySet(uint256 floorICR, uint256 defendICR);
    event AppAuthorized(address indexed app, uint256 budget, uint256 perDrawMax, uint64 expiry, address payee);
    event AppRemoved(address indexed app);
    event Drawn(address indexed app, address indexed payee, uint256 amount, uint256 icrAfter, uint256 nonceUsed);
    event Healed(address indexed caller, uint256 amount, uint256 icrBefore, uint256 icrAfter);
    event Defended(address indexed caller, uint256 repaid, uint256 icrBefore, uint256 icrAfter);
    event Armed(uint256 amount, uint256 nonce, uint256 deadline);
    event Revoked(bool nonceBurned, uint256 nonceAfter);
    event Unfrozen();
    event Funded(uint256 amount);
    event BufferWithdrawn(uint256 amount);
    event ReserveParked(uint256 amount);
    event ReserveUnparked(uint256 amount);

    // ---------------------------------------------------------------- errors
    error OnlyBorrower();
    error IsFrozen();
    error Reentrancy();
    error BadPolicy();
    error AppNotAuthorized();
    error AppExpired();
    error OverBudget(uint256 requested, uint256 remaining);
    error OverPerDraw(uint256 requested, uint256 cap);
    error PayeeNotAllowed(address payee);
    error WindowTooLong();
    error BadHeal();
    error BypassBlocked();
    error CallbackMismatch(uint8 seen);
    error AmountMismatch();
    error Unsafe(uint256 icrAfter, uint256 floor);
    error NotStressed(uint256 icr);
    error NotArmed();
    error NoExcess();
    error NoSavings();
    error ZeroAmount();
    error TransferFailed();

    constructor(
        address borrower_,
        IBorrowerOperationsSignatures signatures_,
        IBorrowerOperations borrowerOperations_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IERC20Min musd_,
        address activePool_,
        ISavingsMUSD savings_,
        uint256 floorICR_,
        uint256 defendICR_
    ) {
        if (floorICR_ <= defendICR_ || defendICR_ < MIN_FLOOR) revert BadPolicy();
        borrower = borrower_;
        signatures = signatures_;
        borrowerOperations = borrowerOperations_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
        activePool = activePool_;
        savings = savings_;
        floorICR = floorICR_;
        defendICR = defendICR_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BorrowerOperationsSignatures"),
                keccak256("1"),
                block.chainid,
                address(signatures_)
            )
        );
        emit PolicySet(floorICR_, defendICR_);
    }

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert OnlyBorrower();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------- views
    function icr() public view returns (uint256) {
        return troveManager.getCurrentICR(borrower, priceFeed.fetchPrice());
    }

    /// @notice ICR the trove would have after drawing `amount` (includes the protocol borrowing fee and accrued interest).
    function projectedICR(uint256 amount) public view returns (uint256) {
        (uint256 coll, uint256 p, uint256 i, uint256 pc, uint256 pp, uint256 pi) =
            troveManager.getEntireDebtAndColl(borrower);
        uint256 debt = p + i + pp + pi + amount + borrowerOperations.getBorrowingFee(amount);
        if (debt == 0) return type(uint256).max;
        return ((coll + pc) * priceFeed.fetchPrice()) / debt;
    }

    /// @notice Why a draw would be refused, as a short code ("" when it would pass the policy checks).
    function previewDraw(address app, uint256 amount, address payee)
        external
        view
        returns (bool ok, string memory reason, uint256 icrAfter)
    {
        icrAfter = projectedICR(amount);
        AppPolicy memory a = appPolicy[app];
        if (frozen) return (false, "FROZEN", icrAfter);
        if (amount == 0) return (false, "ZERO_AMOUNT", icrAfter);
        if (a.expiry == 0) return (false, "APP_NOT_AUTHORIZED", icrAfter);
        if (block.timestamp > a.expiry) return (false, "APP_EXPIRED", icrAfter);
        if (amount > a.perDrawMax) return (false, "OVER_PER_DRAW", icrAfter);
        if (amount > a.budget - a.spent) return (false, "OVER_BUDGET", icrAfter);
        if (a.payee != address(0) && a.payee != payee) return (false, "PAYEE_NOT_ALLOWED", icrAfter);
        if (icrAfter < floorICR) return (false, "BELOW_FLOOR", icrAfter);
        return (true, "", icrAfter);
    }

    /// @notice MUSD held here that did not arrive through draw() or fund(); only heal() can move it.
    function excess() public view returns (uint256) {
        uint256 bal = musd.balanceOf(address(this));
        uint256 liquid = buffer - parked;
        return bal > liquid ? bal - liquid : 0;
    }

    function standby() external view returns (uint256 amount, uint256 deadline, uint256 nonce, bool live) {
        Standby memory s = _standby;
        live = s.amount != 0 && s.deadline >= block.timestamp && signatures.getNonce(borrower) == s.nonce;
        return (s.amount, s.deadline, s.nonce, live);
    }

    function remainingBudget(address app) external view returns (uint256) {
        AppPolicy memory a = appPolicy[app];
        return a.budget - a.spent;
    }

    // ---------------------------------------------------------------- borrower controls
    function setPolicy(uint256 floorICR_, uint256 defendICR_) external onlyBorrower {
        if (floorICR_ <= defendICR_ || defendICR_ < MIN_FLOOR) revert BadPolicy();
        floorICR = floorICR_;
        defendICR = defendICR_;
        emit PolicySet(floorICR_, defendICR_);
    }

    function authorizeApp(address app, uint128 budget, uint128 perDrawMax, uint64 expiry, address payee)
        external
        onlyBorrower
    {
        if (app == address(0) || expiry <= block.timestamp || perDrawMax == 0 || perDrawMax > budget) {
            revert BadPolicy();
        }
        appPolicy[app] = AppPolicy(budget, 0, perDrawMax, expiry, payee);
        emit AppAuthorized(app, budget, perDrawMax, expiry, payee);
    }

    function removeApp(address app) external onlyBorrower {
        delete appPolicy[app];
        emit AppRemoved(app);
    }

    /// @notice Freeze all draws. If `burnSig` is supplied it must be the borrower's AddColl signature for 1 wei at the
    ///         current native nonce: the nonce is consumed so every outstanding native signature becomes invalid.
    function revoke(uint256 burnDeadline, bytes calldata burnSig) external payable onlyBorrower nonReentrant {
        frozen = true;
        delete _standby;
        bool burned = burnSig.length != 0;
        if (burned) {
            signatures.addCollWithSignature{value: msg.value}(address(0), address(0), borrower, burnSig, burnDeadline);
        }
        emit Revoked(burned, signatures.getNonce(borrower));
    }

    function unfreeze() external onlyBorrower {
        frozen = false;
        emit Unfrozen();
    }

    function fund(uint256 amount) external onlyBorrower {
        if (amount == 0) revert ZeroAmount();
        buffer += amount;
        if (!musd.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Funded(amount);
    }

    /// @notice Return liquid buffer to the borrower. Excess (bypass proceeds) is never releasable.
    function withdrawBuffer(uint256 amount) external onlyBorrower nonReentrant {
        if (amount > buffer - parked) revert NoExcess();
        buffer -= amount;
        if (!musd.transfer(borrower, amount)) revert TransferFailed();
        emit BufferWithdrawn(amount);
    }

    /// @notice Move idle buffer into sMUSD so the reserve keeps earning while it waits.
    function parkReserve(uint256 amount) external onlyBorrower nonReentrant {
        if (address(savings) == address(0)) revert NoSavings();
        if (amount == 0 || amount > buffer - parked) revert ZeroAmount();
        parked += amount;
        _approve(address(savings), amount);
        savings.deposit(amount);
        emit ReserveParked(amount);
    }

    function unparkReserve(uint256 amount) external onlyBorrower nonReentrant {
        _unpark(amount);
    }

    // ---------------------------------------------------------------- the draw
    /// @notice Called by an authorized app. `withdrawSig` is the borrower's native WithdrawMUSD signature naming this
    ///         contract as recipient; `healSig` is the paired RepayMUSD signature for the same amount at nonce+1, kept
    ///         as the defend() standby.
    function draw(
        uint256 amount,
        address payee,
        uint256 withdrawDeadline,
        bytes calldata withdrawSig,
        uint256 healDeadline,
        bytes calldata healSig
    ) external nonReentrant {
        if (frozen) revert IsFrozen();
        if (amount == 0) revert ZeroAmount();
        if (withdrawDeadline > block.timestamp + MAX_WINDOW) revert WindowTooLong();

        AppPolicy storage a = appPolicy[msg.sender];
        if (a.expiry == 0) revert AppNotAuthorized();
        if (block.timestamp > a.expiry) revert AppExpired();
        if (amount > a.perDrawMax) revert OverPerDraw(amount, a.perDrawMax);
        uint256 remaining = a.budget - a.spent;
        if (amount > remaining) revert OverBudget(amount, remaining);
        if (a.payee != address(0) && a.payee != payee) revert PayeeNotAllowed(payee);
        a.spent += uint128(amount);

        uint256 nonce = signatures.getNonce(borrower);
        if (!_validRepay(amount, nonce + 1, healDeadline, healSig)) revert BadHeal();

        uint256 pre = musd.balanceOf(address(this));
        _inDraw = true;
        _callbacks = 0;
        signatures.withdrawMUSDWithSignature(
            amount, address(0), address(0), borrower, address(this), withdrawSig, withdrawDeadline
        );
        _inDraw = false;
        if (_callbacks != 1) revert CallbackMismatch(_callbacks);
        if (musd.balanceOf(address(this)) - pre != amount) revert AmountMismatch();

        uint256 after_ = icr();
        if (after_ < floorICR) revert Unsafe(after_, floorICR);

        _standby = Standby(uint128(amount), uint64(healDeadline), uint64(nonce + 1), healSig);
        if (!musd.transfer(payee, amount)) revert TransferFailed();
        emit Drawn(msg.sender, payee, amount, after_, nonce);
        emit Armed(amount, nonce + 1, healDeadline);
    }

    /// @dev The atomic veto. Only the ActivePool's zero-value callback during draw() is accepted, exactly once.
    receive() external payable {
        if (!_inDraw || msg.sender != activePool || msg.value != 0 || _callbacks != 0) revert BypassBlocked();
        _callbacks = 1;
    }

    // ---------------------------------------------------------------- recovery
    /// @notice Re-arm the defend() standby with a fresh RepayMUSD signature at the current native nonce.
    function rearm(uint256 amount, uint256 deadline, bytes calldata repaySig) external {
        uint256 nonce = signatures.getNonce(borrower);
        if (amount == 0 || amount > buffer) revert ZeroAmount();
        if (!_validRepay(amount, nonce, deadline, repaySig)) revert BadHeal();
        _standby = Standby(uint128(amount), uint64(deadline), uint64(nonce), repaySig);
        emit Armed(amount, nonce, deadline);
    }

    /// @notice Permissionless: repay stray MUSD (arrived outside draw()) into the borrower's trove.
    function heal(uint256 amount, uint256 deadline, bytes calldata repaySig) external nonReentrant {
        if (amount == 0 || excess() < amount) revert NoExcess();
        uint256 before = icr();
        _approve(address(signatures), amount);
        signatures.repayMUSDWithSignature(amount, address(0), address(0), borrower, repaySig, deadline);
        emit Healed(msg.sender, amount, before, icr());
    }

    /// @notice Permissionless: if the trove is below defendICR, repay the armed standby from the buffer and freeze.
    function defend() external nonReentrant {
        uint256 before = icr();
        if (before >= defendICR) revert NotStressed(before);
        Standby memory s = _standby;
        if (s.amount == 0) revert NotArmed();
        delete _standby;
        uint256 liquid = buffer - parked;
        buffer -= s.amount;
        frozen = true;
        if (liquid < s.amount) _unpark(s.amount - liquid);
        _approve(address(signatures), s.amount);
        signatures.repayMUSDWithSignature(s.amount, address(0), address(0), borrower, s.signature, s.deadline);
        uint256 after_ = icr();
        emit Defended(msg.sender, s.amount, before, after_);
    }

    // ---------------------------------------------------------------- internals
    function _approve(address spender, uint256 amount) internal {
        if (!musd.approve(spender, amount)) revert TransferFailed();
    }

    function _unpark(uint256 amount) internal {
        if (amount == 0 || amount > parked) revert ZeroAmount();
        parked -= amount;
        savings.withdraw(amount);
        emit ReserveUnparked(amount);
    }

    function _validRepay(uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        internal
        view
        returns (bool)
    {
        if (sig.length != 65 || deadline < block.timestamp) return false;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(REPAY_TYPEHASH, amount, borrower, nonce, deadline))
            )
        );
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;
        address signer = ecrecover(digest, v, r, s);
        return signer != address(0) && signer == borrower;
    }
}
