// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Min, IBorrowerOperationsSignatures, IPriceFeed, ITroveManager} from "../interfaces/IMezo.sol";
import {IMUSDSavingsRate, IMezoRouter, IGovernorView, IFactoryView} from "../interfaces/IRoutes.sol";

/// @title SternpostRouter
/// @notice Routes MUSD drawn through a SternpostGovernor into Mezo DeFi in the same transaction:
///         Save  - deposit into sMUSD (MUSD Savings Rate); shares go to the borrower.
///         Swap  - swap MUSD -> BTC on the Mezo DEX (vAMM MUSD/BTC); BTC goes to the borrower.
///         Loop  - draw -> swap -> add the BTC back as collateral to the same trove, up to MAX_LEGS legs,
///                 re-checking the governor floor on chain after every leg.
/// @dev Plugged into a governor as an authorized app whose payee is this contract. Security properties:
///      - Only governors created by the canonical factory are accepted (no spoofed governor).
///      - Only the borrower, or an operator the borrower named here, may trigger a route.
///      - Every output (sMUSD shares, BTC, surplus) is delivered to the borrower; the caller can never redirect it.
///      - All targets (sMUSD, DEX router, pool factory, tokens) are immutable: the route set is a fixed allowlist.
///      - Each route can be enabled/disabled per borrower (default: all disabled).
///      - Slippage: Swap takes an explicit minOut; Loop uses the borrower-signed AddColl amount as minOut.
///      - Reentrancy guard on every route; approvals are exact and reset to zero; the contract ends every call
///        holding no MUSD and no BTC it did not hold before (checked).
contract SternpostRouter {
    // ---------------------------------------------------------------- types
    uint8 public constant ROUTE_SAVE = 1;
    uint8 public constant ROUTE_SWAP = 2;
    uint8 public constant ROUTE_LOOP = 4;
    /// @dev 2, not more: on Mezo testnet a third leg fails inside the price precompile (observed 2026-10-23).
    uint256 public constant MAX_LEGS = 2;
    uint256 public constant MAX_SWAP_WINDOW = 300; // seconds

    /// @notice One loop leg. Nonces: withdrawSig at n, healSig and addCollSig both at n+1 (the AddColl consumes n+1,
    ///         so the next leg starts at n+2). `collAmount` is the exact BTC the borrower signed to add and is the
    ///         swap's minimum output; any BTC above it is sent to the borrower.
    struct Leg {
        uint256 amount;
        uint256 withdrawDeadline;
        bytes withdrawSig;
        uint256 healDeadline;
        bytes healSig;
        uint256 collAmount;
        uint256 addCollDeadline;
        bytes addCollSig;
    }

    // ---------------------------------------------------------------- immutables
    IFactoryView public immutable factory;
    IBorrowerOperationsSignatures public immutable signatures;
    IERC20Min public immutable musd;
    IMUSDSavingsRate public immutable savings;
    IMezoRouter public immutable dex;
    address public immutable dexFactory;
    IERC20Min public immutable btc;
    bool public immutable stablePool; // false: vAMM MUSD/BTC

    // ---------------------------------------------------------------- state
    mapping(address => uint8) public routesOf; // borrower => enabled route bitmask
    mapping(address => mapping(address => bool)) public isOperator; // borrower => operator => allowed
    uint256 private _lock = 1;
    bool private _acceptBtc;

    // ---------------------------------------------------------------- events / errors
    event RoutesSet(address indexed borrower, uint8 mask);
    event OperatorSet(address indexed borrower, address indexed operator, bool allowed);
    event Saved(address indexed governor, address indexed borrower, uint256 musdIn, uint256 sharesOut);
    event Swapped(address indexed governor, address indexed borrower, uint256 musdIn, uint256 btcOut);
    event LoopLeg(
        address indexed governor, uint256 indexed leg, uint256 musdIn, uint256 btcOut, uint256 collAdded, uint256 icrAfter
    );
    event Looped(address indexed governor, address indexed borrower, uint256 legs, uint256 musdIn, uint256 collAdded);

    error Reentrancy();
    error NotGovernor(address governor);
    error NotAllowed(address caller);
    error RouteDisabled(uint8 route);
    error ZeroAmount();
    error BadLegs(uint256 legs);
    error Slippage(uint256 out, uint256 minOut);
    error Unsafe(uint256 icrAfter, uint256 floor);
    error Residue();
    error TransferFailed();
    error UnexpectedBtc();
    error ZeroAddress();

    constructor(
        IFactoryView factory_,
        IBorrowerOperationsSignatures signatures_,
        IERC20Min musd_,
        IMUSDSavingsRate savings_,
        IMezoRouter dex_,
        address dexFactory_,
        IERC20Min btc_,
        bool stablePool_
    ) {
        if (
            address(factory_) == address(0) || address(signatures_) == address(0) || address(musd_) == address(0)
                || address(savings_) == address(0) || address(dex_) == address(0) || dexFactory_ == address(0)
                || address(btc_) == address(0)
        ) revert ZeroAddress();
        factory = factory_;
        signatures = signatures_;
        musd = musd_;
        savings = savings_;
        dex = dex_;
        dexFactory = dexFactory_;
        btc = btc_;
        stablePool = stablePool_;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------- borrower config
    /// @notice Enable a set of routes for msg.sender (bitmask of ROUTE_*).
    function setRoutes(uint8 mask) external {
        routesOf[msg.sender] = mask & (ROUTE_SAVE | ROUTE_SWAP | ROUTE_LOOP);
        emit RoutesSet(msg.sender, routesOf[msg.sender]);
    }

    /// @notice Let `operator` (for example the borrower's agent) trigger routes for msg.sender's governor.
    function setOperator(address operator, bool allowed) external {
        isOperator[msg.sender][operator] = allowed;
        emit OperatorSet(msg.sender, operator, allowed);
    }

    // ---------------------------------------------------------------- views
    function quoteSwap(uint256 musdIn) public view returns (uint256 btcOut) {
        uint256[] memory a = dex.getAmountsOut(musdIn, _path());
        return a[a.length - 1];
    }

    // ---------------------------------------------------------------- routes
    /// @notice Draw `amount` MUSD through `governor` and deposit it into sMUSD for the borrower.
    function drawAndSave(
        address governor,
        uint256 amount,
        uint256 withdrawDeadline,
        bytes calldata withdrawSig,
        uint256 healDeadline,
        bytes calldata healSig
    ) external nonReentrant returns (uint256 shares) {
        address b = _auth(governor, ROUTE_SAVE);
        uint256 m0 = musd.balanceOf(address(this));
        uint256 s0 = savings.balanceOf(address(this));
        _draw(governor, amount, withdrawDeadline, withdrawSig, healDeadline, healSig, m0);

        _approve(address(savings), amount);
        savings.deposit(amount);
        _approve(address(savings), 0);
        shares = savings.balanceOf(address(this)) - s0;
        if (!savings.transfer(b, shares)) revert TransferFailed();

        if (musd.balanceOf(address(this)) != m0 || savings.balanceOf(address(this)) != s0) revert Residue();
        emit Saved(governor, b, amount, shares);
    }

    /// @notice Draw `amount` MUSD through `governor` and swap it to BTC for the borrower (min `minBtcOut`).
    function drawAndSwap(
        address governor,
        uint256 amount,
        uint256 minBtcOut,
        uint256 withdrawDeadline,
        bytes calldata withdrawSig,
        uint256 healDeadline,
        bytes calldata healSig
    ) external nonReentrant returns (uint256 out) {
        address b = _auth(governor, ROUTE_SWAP);
        if (minBtcOut == 0) revert Slippage(0, 0);
        uint256 m0 = musd.balanceOf(address(this));
        _draw(governor, amount, withdrawDeadline, withdrawSig, healDeadline, healSig, m0);
        uint256 bb0 = btc.balanceOf(b);
        _swap(amount, minBtcOut, b);
        out = btc.balanceOf(b) - bb0;
        if (out < minBtcOut) revert Slippage(out, minBtcOut);
        if (musd.balanceOf(address(this)) != m0) revert Residue();
        emit Swapped(governor, b, amount, out);
    }

    /// @notice Leveraged loop on the borrower's own trove. Each leg: draw MUSD -> swap to BTC -> add exactly the
    ///         signed BTC amount as collateral; the governor floor is re-checked after every leg.
    function loop(address governor, Leg[] calldata legs) external nonReentrant returns (uint256 totalColl) {
        address b = _auth(governor, ROUTE_LOOP);
        if (legs.length == 0 || legs.length > MAX_LEGS) revert BadLegs(legs.length);
        IGovernorView g = IGovernorView(governor);
        uint256 m0 = musd.balanceOf(address(this));
        uint256 n0 = address(this).balance;
        uint256 totalIn = 0;
        // Mezo's price precompile fails if queried again late in a long tx, so read the price once: it cannot change
        // within one transaction, and every leg's ICR is then computed from the trove manager at that price.
        uint256 price = IPriceFeed(g.priceFeed()).fetchPrice();
        ITroveManager tm = ITroveManager(g.troveManager());
        uint256 floor = g.floorICR();
        for (uint256 i; i < legs.length; ++i) {
            Leg calldata l = legs[i];
            if (l.collAmount == 0) revert ZeroAmount();
            _draw(governor, l.amount, l.withdrawDeadline, l.withdrawSig, l.healDeadline, l.healSig, m0);

            uint256 nb = address(this).balance;
            _acceptBtc = true;
            _swap(l.amount, l.collAmount, address(this));
            _acceptBtc = false;
            uint256 got = address(this).balance - nb;
            if (got < l.collAmount) revert Slippage(got, l.collAmount);

            signatures.addCollWithSignature{value: l.collAmount}(
                address(0), address(0), b, l.addCollSig, l.addCollDeadline
            );
            uint256 icrAfter = tm.getCurrentICR(b, price);
            if (icrAfter < floor) revert Unsafe(icrAfter, floor);

            uint256 surplus = got - l.collAmount;
            if (surplus != 0) _sendBtc(b, surplus);
            totalIn += l.amount;
            totalColl += l.collAmount;
            emit LoopLeg(governor, i, l.amount, got, l.collAmount, icrAfter);
        }
        if (musd.balanceOf(address(this)) != m0 || address(this).balance != n0) revert Residue();
        emit Looped(governor, b, legs.length, totalIn, totalColl);
    }

    /// @dev BTC arrives as native value on Mezo (the BTC ERC-20 is a view of the native balance). Native pushes are
    ///      only accepted mid-swap inside loop(); anything else reverts.
    receive() external payable {
        if (!_acceptBtc) revert UnexpectedBtc();
    }

    // ---------------------------------------------------------------- internals
    function _auth(address governor, uint8 route) internal view returns (address b) {
        b = IGovernorView(governor).borrower();
        if (b == address(0) || factory.governorOf(b) != governor) revert NotGovernor(governor);
        if (msg.sender != b && !isOperator[b][msg.sender]) revert NotAllowed(msg.sender);
        if (routesOf[b] & route == 0) revert RouteDisabled(route);
    }

    function _draw(
        address governor,
        uint256 amount,
        uint256 withdrawDeadline,
        bytes calldata withdrawSig,
        uint256 healDeadline,
        bytes calldata healSig,
        uint256 m0
    ) internal {
        if (amount == 0) revert ZeroAmount();
        IGovernorView(governor).draw(amount, address(this), withdrawDeadline, withdrawSig, healDeadline, healSig);
        if (musd.balanceOf(address(this)) - m0 != amount) revert Residue();
    }

    function _swap(uint256 amountIn, uint256 minOut, address to) internal {
        _approve(address(dex), amountIn);
        uint256[] memory a =
            dex.swapExactTokensForTokens(amountIn, minOut, _path(), to, block.timestamp + MAX_SWAP_WINDOW);
        _approve(address(dex), 0);
        if (a[a.length - 1] < minOut) revert Slippage(a[a.length - 1], minOut); // delivered amount re-checked by callers
    }

    function _path() internal view returns (IMezoRouter.Route[] memory r) {
        r = new IMezoRouter.Route[](1);
        r[0] = IMezoRouter.Route(address(musd), address(btc), stablePool, dexFactory);
    }

    function _approve(address spender, uint256 amount) internal {
        if (!musd.approve(spender, amount)) revert TransferFailed();
    }

    /// @dev `to` is always the governor's borrower (resolved and factory-checked in _auth), never caller input.
    function _sendBtc(address to, uint256 amount) internal {
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
