// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";

/// @notice Test doubles for the Mezo stack, written for this suite (the shared
///         MockMezo.sol covers only the Governor/Router surface: its
///         MockBorrowerOperations has no openTrove/withdrawMUSD/repayMUSD/
///         closeTrove, and its MockTroveManager has no getTroveStatus /
///         checkRecoveryMode / getTCR). Behaviour follows the plan: borrowing
///         fee 0.1%, min net debt 1800 MUSD, gas comp 200 MUSD, MCR 110%.
contract TestTroveManager {
    mapping(address => uint256) public coll;
    mapping(address => uint256) public debt;
    mapping(address => uint8) public status;
    mapping(address => bool) public recoveryMode;
    uint256 public tcr = 3e18;

    function setTrove(address b, uint256 c, uint256 d) external {
        coll[b] = c;
        debt[b] = d;
    }
    function setStatus(address b, uint8 s) external { status[b] = s; }
    function setRecoveryMode(address b, bool rm) external { recoveryMode[b] = rm; }
    function setTCR(uint256 t) external { tcr = t; }
    function addDebt(address b, uint256 d) external { debt[b] += d; }
    function subDebt(address b, uint256 d) external { debt[b] -= d; }
    function addColl(address b, uint256 c) external { coll[b] += c; }
    function subColl(address b, uint256 c) external { coll[b] -= c; }

    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        return debt[b] == 0 ? type(uint256).max : coll[b] * price / debt[b];
    }
    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (coll[b], debt[b], 0, 0, 0, 0);
    }
    function getTroveStatus(address b) external view returns (uint8) {
        return status[b];
    }
    function checkRecoveryMode(uint256) external view returns (bool) {
        return recoveryMode[msg.sender];
    }
    function getTCR(uint256) external view returns (uint256) {
        return tcr;
    }
}

contract TestBorrowerOperations {
    MockMUSD public musd;
    TestTroveManager public tm;
    MockPriceFeed public pf;
    mapping(address => uint256) public surplus;

    constructor(MockMUSD m, TestTroveManager t, MockPriceFeed p) {
        musd = m;
        tm = t;
        pf = p;
    }

    function minNetDebt() external pure returns (uint256) {
        return 1800e18;
    }
    function getBorrowingFee(uint256 d) external pure returns (uint256) {
        return d * 1e15 / 1e18; // 0.1%
    }
    function setSurplus(address b, uint256 a) external {
        surplus[b] = a;
    }

    function openTrove(uint256 debt, address, address) external payable {
        address borrower = msg.sender;
        uint256 fee = this.getBorrowingFee(debt);
        tm.setTrove(borrower, msg.value, debt + fee);
        tm.setStatus(borrower, 1);
        musd.mint(borrower, debt);
    }
    function withdrawMUSD(uint256 amount, address, address) external {
        address borrower = msg.sender;
        uint256 fee = this.getBorrowingFee(amount);
        tm.addDebt(borrower, amount + fee);
        require(tm.getCurrentICR(borrower, pf.fetchPrice()) >= 1.1e18, "ICR<MCR");
        musd.mint(borrower, amount);
    }
    function repayMUSD(uint256 amount, address, address) external {
        musd.burn(msg.sender, amount);
        tm.subDebt(msg.sender, amount);
    }
    function addColl(address, address) external payable {
        tm.addColl(msg.sender, msg.value);
    }
    function withdrawColl(uint256 amount, address, address) external {
        tm.subColl(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
    }
    function closeTrove() external {
        address borrower = msg.sender;
        uint256 debt = tm.debt(borrower);
        uint256 need = debt > 200e18 ? debt - 200e18 : 0;
        musd.burn(borrower, need);
        uint256 c = tm.coll(borrower);
        tm.setTrove(borrower, 0, 0);
        tm.setStatus(borrower, 2);
        (bool ok,) = borrower.call{value: c}("");
        require(ok);
    }
    function claimCollateral() external {
        uint256 amt = surplus[msg.sender];
        surplus[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok);
    }

    receive() external payable {}
}

contract TestSavings {
    MockMUSD public musd;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public yieldOwed;
    uint256 public yieldIndex;
    mapping(address => uint256) public supplyYieldIndex;

    constructor(MockMUSD m) {
        musd = m;
    }

    function setYield(address a, uint256 y) external {
        yieldOwed[a] = y;
    }
    function setYieldIndex(uint256 y) external {
        yieldIndex = y;
    }
    function setSupplyYieldIndex(address a, uint256 y) external {
        supplyYieldIndex[a] = y;
    }
    function claimableYield(address a) external view returns (uint256) {
        if (yieldIndex <= supplyYieldIndex[a]) return 0;
        return balanceOf[a] * (yieldIndex - supplyYieldIndex[a]) / 1e18;
    }
    function deposit(uint256 a) external {
        musd.transferFrom(msg.sender, address(this), a);
        balanceOf[msg.sender] += a;
    }
    function withdraw(uint256 a) external {
        balanceOf[msg.sender] -= a;
        musd.transfer(msg.sender, a);
    }
    function claimYield() external returns (uint256) {
        uint256 y = yieldOwed[msg.sender];
        yieldOwed[msg.sender] = 0;
        musd.transfer(msg.sender, y);
        return y;
    }
}

contract TestSortedTroves {
    address[] public chain; // fromLowest[0] = lowest NICR (getLast)
    mapping(address => uint256) public idx; // 1-based index into chain, 0 = absent

    function setChain(address[] memory fromLowest) external {
        for (uint256 i; i < chain.length; i++) delete idx[chain[i]];
        chain = fromLowest;
        for (uint256 i; i < chain.length; i++) idx[chain[i]] = i + 1;
    }
    function getLast() external view returns (address) {
        return chain.length == 0 ? address(0) : chain[0];
    }
    function getPrev(address trove) external view returns (address) {
        uint256 i = idx[trove];
        if (i == 0 || i >= chain.length) return address(0);
        return chain[i]; // i is 1-based: chain[i] is the next-higher element
    }
    function getNext(address trove) external view returns (address) {
        uint256 i = idx[trove];
        if (i <= 1) return address(0);
        return chain[i - 2];
    }
    function contains(address trove) external view returns (bool) {
        return idx[trove] != 0;
    }
    function findInsertPosition(uint256, address, address) external pure returns (address, address) {
        return (address(0), address(0));
    }
}

/// @notice Task 1.2 acceptance tests (plan section 10, task 1.2): unit tests
///         for invariants I2, I3, I4, I5, plus the 1.1 adversarial-review
///         findings F1/F2 (factory-side, proven here against the real
///         implementation) and J2 (getTroveStatus uint8, owner-set-once on a
///         real clone).
/// @dev Main account: owner = this test contract, 0.1 BTC collateral,
///      2000 MUSD debt, price 100_000e18 -> ICR ~4.995e18, production policy
///      floor 2.50 / shield 1.60 / target 2.00.
contract TroveAccountTest is Test {
    MockMUSD public musd;
    MockPriceFeed public pf;
    TestTroveManager public tm;
    TestBorrowerOperations public bo;
    TestSavings public smusd;
    TestSortedTroves public sorted;
    TroveAccount public implementation;
    TroveAccountFactory public factory;
    TroveAccount public account;
    address public feeRecipient = makeAddr("feeRecipient");
    address public owner = address(this);
    address public agent = makeAddr("agent");
    address public agent2 = makeAddr("agent2");
    address public payee = makeAddr("payee");
    address public attacker = makeAddr("attacker");

    bytes32 public constant SALT = bytes32(uint256(0xACC0));
    uint256 public constant COLL = 0.1 ether;
    uint256 public constant DEBT = 2000e18;

    receive() external payable {}

    function setUp() public {
        musd = new MockMUSD();
        pf = new MockPriceFeed();
        tm = new TestTroveManager();
        bo = new TestBorrowerOperations(musd, tm, pf);
        smusd = new TestSavings(musd);
        sorted = new TestSortedTroves();
        vm.deal(address(this), 100 ether);
        vm.deal(address(bo), 100 ether);
        musd.mint(address(smusd), 100_000e18); // yield payouts
        implementation = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 10
        );
        factory = new TroveAccountFactory(address(implementation), feeRecipient, 10);
        address a = factory.createAndOpen{value: COLL}(SALT, _policy(), DEBT, address(0), address(0), 0);
        account = TroveAccount(payable(a));
    }

    function _policy() internal pure returns (Policy memory) {
        return Policy({
            floorICR: uint64(2500000000000000000),
            shieldICR: uint64(1600000000000000000),
            targetICR: uint64(2000000000000000000),
            bounty: uint128(1000000000000000000),
            minDebtAhead: uint128(0),
            cooldownBlocks: uint32(20)
        });
    }

    function _setSession(address a, uint128 budget, uint128 perTx, uint128 daily, bool anyPayee, bool canSign)
        internal
    {
        account.setSession(a, budget, perTx, daily, uint64(block.timestamp + 7 days), anyPayee, canSign);
    }

    function _sessionSpent(address a) internal view returns (uint128) {
        (, uint128 spent,,,,,,,,,,) = account.sessions(a);
        return spent;
    }

    // draw() bills msg.sender as the agent, so every agent draw needs a prank.
    function _drawAs(address a, address p, uint256 amount) internal {
        vm.prank(a);
        account.draw(p, amount);
    }

    // ============ I2: spent <= budget, gross <= perTx ============

    function test_I2_drawWithinCapsSucceeds() public {
        _setSession(agent, 1000e18, 500e18, 1000e18, false, false);
        account.setPayee(agent, payee, true);
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        _drawAs(agent, payee, 100e18);
        assertEq(musd.balanceOf(payee), 100e18, "payee receives exactly amount");
        assertEq(musd.balanceOf(feeRecipient) - feeBefore, 0.1e18, "fee is 10 bps, ceil");
        assertEq(_sessionSpent(agent), 1001e17, "spent tracks gross (amount + fee)");
    }

    function test_I2_drawOverPerTxReverts() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.OverPerTx.selector, uint256(6006e17), uint256(500e18)));
        _drawAs(agent, payee, 600e18);
    }

    function test_I2_drawOverBudgetReverts() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        _drawAs(agent, payee, 400e18);
        _drawAs(agent, payee, 400e18);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.OverBudget.selector, uint256(4004e17), uint256(1992e17))
        );
        _drawAs(agent, payee, 400e18);
    }

    function test_I2_drawOverDailyReverts() public {
        _setSession(agent, 1000e18, 500e18, 500e18, true, false);
        _drawAs(agent, payee, 400e18);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.OverDaily.selector, uint256(2002e17), uint256(996e17))
        );
        _drawAs(agent, payee, 200e18);
    }

    function test_I2_dailyWindowRollsAfter24h() public {
        _setSession(agent, 1000e18, 500e18, 500e18, true, false);
        _drawAs(agent, payee, 400e18);
        vm.warp(block.timestamp + 25 hours);
        _drawAs(agent, payee, 400e18); // daySpent reset; must not revert
        assertEq(_sessionSpent(agent), 8008e17, "spent accumulates across days");
    }

    function test_I2_feeIsCeilOneWei() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        _drawAs(agent, payee, 1); // 1 wei * 10 bps rounds UP to 1 wei
        assertEq(musd.balanceOf(feeRecipient) - feeBefore, 1, "ceil(1 wei * 10 / 10000) = 1 wei");
        assertEq(musd.balanceOf(payee), 1, "payee still receives the exact amount");
    }

    function test_I2_drawBelowFloorReverts() public {
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        (, uint8 reason, uint256 icrAfter, ) = account.previewDraw(agent, payee, 1996e18);
        assertEq(reason, 6, "preview says BELOW_FLOOR");
        assertLt(icrAfter, 25e17, "icrAfter is below the 2.50 floor");
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BelowFloor.selector, icrAfter, uint256(25e17)));
        _drawAs(agent, payee, 1996e18);
    }

    function test_I2_payeeAllowlistEnforced() public {
        _setSession(agent, 1000e18, 500e18, 0, false, false);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.PayeeNotAllowed.selector, payee));
        _drawAs(agent, payee, 10e18);
        account.setPayee(agent, payee, true);
        _drawAs(agent, payee, 10e18); // now allowed
        assertEq(musd.balanceOf(payee), 10e18);
    }

    // ============ I3: revoked / expired / wrong-epoch sessions ============

    function test_I3_revokedSessionCannotDraw() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        account.revokeSession(agent);
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent, payee, 10e18);
    }

    function test_I3_revokeAllKillsAllSessions() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        _setSession(agent2, 1000e18, 500e18, 0, true, false);
        account.revokeAll();
        assertEq(account.sessionEpoch(), 1);
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent, payee, 10e18);
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent2, payee, 10e18);
    }

    function test_I3_wrongEpochSessionCannotDraw() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        account.revokeAll(); // epoch 0 -> 1; the stored session still says epoch 0
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent, payee, 10e18);
    }

    function test_I3_expiredSessionCannotDraw() public {
        account.setSession(agent, 1000e18, 500e18, 0, uint64(block.timestamp + 1 hours), true, false);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent, payee, 10e18);
    }

    function test_I3_liveSessionCanSignX402() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(h, sig), bytes4(0x1626ba7e), "live canSignX402 session validates");
    }

    function test_I3_sessionWithoutCanSignX402CannotSign() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(h, sig), bytes4(0xffffffff), "no canSignX402 -> invalid");
    }

    function test_I3_revokedSessionCannotSignX402() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(h, sig), bytes4(0x1626ba7e));
        account.revokeSession(signer);
        assertEq(account.isValidSignature(h, sig), bytes4(0xffffffff), "revoked -> invalid");
    }

    function test_I3_reissuedSessionDropsOldPayees() public {
        _setSession(agent, 1000e18, 500e18, 0, false, false);
        account.setPayee(agent, payee, true);
        _drawAs(agent, payee, 10e18); // gen 1: allowed
        _setSession(agent, 1000e18, 500e18, 0, false, false); // gen 2
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.PayeeNotAllowed.selector, payee));
        _drawAs(agent, payee, 10e18);
        account.setPayee(agent, payee, true); // re-allow under gen 2
        _drawAs(agent, payee, 10e18);
        assertEq(musd.balanceOf(payee), 20e18);
    }

    // ============ drawBySig (session path, EIP-712) ============

    function _signIntent(uint256 pk, address a, address p, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = account.intentDigest(a, p, amount, account.intentNonce(a), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function test_drawBySigHappyPathAndNonce() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(musd.balanceOf(payee), 50e18);
        assertEq(account.intentNonce(signer), 1, "nonce increases by exactly 1");
    }

    function test_drawBySigReplayReverts() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        vm.expectRevert(TroveAccount.BadSig.selector); // nonce consumed: same sig no longer recovers
        account.drawBySig(signer, payee, 50e18, deadline, sig);
    }

    function test_drawBySigExpiredReverts() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(TroveAccount.Expired.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sig);
    }

    function test_drawBySigWrongSignerReverts() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.expectRevert(TroveAccount.BadSig.selector); // submitted for a different agent
        account.drawBySig(agent2, payee, 50e18, deadline, sig);
    }

    function test_drawBySigShortSigReverts() public {
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(agent, payee, 50e18, block.timestamp + 10 minutes, new bytes(64));
    }

    // ============ I4: owner never changes ============

    function test_I4_initializeOnceOnRealClone() public {
        vm.expectRevert(TroveAccount.AlreadyInitialized.selector);
        account.initialize(owner, _policy(), feeRecipient, 10);
    }

    function test_I4_openForOnlyFactoryOnRealClone() public {
        vm.prank(attacker);
        vm.expectRevert(TroveAccount.NotFactory.selector);
        account.openFor(DEBT, address(0), address(0), 0);
    }

    function test_I4_ownerNeverChanges() public {
        assertEq(account.owner(), owner);
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        account.setPolicy(_policy());
        account.revokeAll();
        account.park(100e18);
        assertEq(account.owner(), owner, "owner is immutable after every owner op");
    }

    function test_I4_nonOwnerCannotCallOwnerFunctions() public {
        vm.startPrank(attacker);
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.setPolicy(_policy());
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.setSession(agent, 1, 1, 0, uint64(block.timestamp + 1 days), true, false);
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.revokeAll();
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.closeAccount();
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.sweepMusd(1);
        vm.expectRevert(TroveAccount.NotOwner.selector);
        account.sweepBtc(1);
        vm.stopPrank();
    }

    // ============ I5: owner can always exit ============

    function test_I5_closeAccountReturnsEverything() public {
        uint256 ownerBtcBefore = owner.balance;
        uint256 ownerMusdBefore = musd.balanceOf(owner);
        // Account holds 2000 MUSD from open; close needs debt(2002) - 200 = 1802.
        account.closeAccount();
        assertEq(account.status(), 2, "closedByOwner");
        assertEq(owner.balance - ownerBtcBefore, COLL, "all BTC returned");
        assertEq(musd.balanceOf(owner) - ownerMusdBefore, 198e18, "2000 minted - 1802 burned = 198 swept");
        assertEq(musd.balanceOf(address(account)), 0);
        assertEq(address(account).balance, 0);
    }

    function test_I5_closeAccountNeedsMusd() public {
        account.sweepMusd(2000e18); // drain the account first
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.NeedMusd.selector, uint256(1802e18)));
        account.closeAccount();
        // UI flow: owner sends the shortfall, then close succeeds.
        musd.transfer(address(account), 1802e18);
        account.closeAccount();
        assertEq(account.status(), 2);
    }

    function test_I5_closeAccountAfterRedemptionClaimsCollateral() public {
        tm.setStatus(address(account), 4);
        bo.setSurplus(address(account), 0.02 ether);
        uint256 ownerBtcBefore = owner.balance;
        account.closeAccount();
        assertEq(owner.balance - ownerBtcBefore, 0.02 ether, "surplus BTC claimed then swept");
        assertEq(account.status(), 4, "status unchanged by close after redemption");
    }

    function test_I5_closeAccountInRecoveryModeReverts() public {
        tm.setRecoveryMode(address(account), true);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(3e18)));
        account.closeAccount();
    }

    function test_I5_sweepsWorkWithoutSessions() public {
        // No session exists at all: sweeps and withdrawColl must still work.
        account.sweepMusd(500e18);
        assertEq(musd.balanceOf(owner), 500e18);
        account.sweepBtc(0); // zero-amount sweep is a no-op, not a revert
        vm.deal(address(account), 0.05 ether);
        account.sweepBtc(0.05 ether);
        assertEq(address(account).balance, 0);
        uint256 btcBefore = owner.balance;
        account.withdrawColl(0.01 ether, address(0), address(0));
        assertEq(owner.balance - btcBefore, 0.01 ether);
    }

    function test_I5_closeAccountRevokesSessions() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        account.closeAccount();
        assertEq(account.sessionEpoch(), 1, "close revokes all sessions");
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        _drawAs(agent, payee, 10e18);
    }

    function test_I5_withdrawCollAndRepay() public {
        account.repay(100e18, address(0), address(0));
        (, uint256 debtAfter,,,,) = tm.getEntireDebtAndColl(address(account));
        assertEq(debtAfter, 1902e18, "debt reduced by the repayment");
        uint256 btcBefore = owner.balance;
        account.withdrawColl(0.01 ether, address(0), address(0));
        assertEq(owner.balance - btcBefore, 0.01 ether);
    }

    function test_repayBoundedByMinDebt() public {
        // Debt is 2002; repaying 300 would leave 1702 < 1800 min net debt.
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BelowMinDebt.selector, uint256(1702e18), uint256(1800e18)));
        account.repay(300e18, address(0), address(0));
        account.repay(200e18, address(0), address(0)); // leaves 1802: allowed
        (, uint256 debtAfter,,,,) = tm.getEntireDebtAndColl(address(account));
        assertEq(debtAfter, 1802e18);
    }

    // ============ Policy + session validation ============

    function test_setPolicyRejectsBadOrdering() public {
        Policy memory p = _policy();
        p.shieldICR = 2000000000000000000; // shield == target
        vm.expectRevert(TroveAccount.BadPolicy.selector);
        account.setPolicy(p);
        p = _policy();
        p.shieldICR = 2600000000000000000; // shield > floor
        vm.expectRevert(TroveAccount.BadPolicy.selector);
        account.setPolicy(p);
        p = _policy();
        p.shieldICR = 1100000000000000000; // shield < 1.15e18
        vm.expectRevert(TroveAccount.BadPolicy.selector);
        account.setPolicy(p);
        p = _policy();
        p.targetICR = 11000000000000000000; // target > 10e18
        vm.expectRevert(TroveAccount.BadPolicy.selector);
        account.setPolicy(p);
    }

    function test_setPolicyRejectsBountyAboveCap() public {
        Policy memory p = _policy();
        p.bounty = 5000000000000000001; // 5 MUSD + 1 wei
        vm.expectRevert(TroveAccount.BountyTooHigh.selector);
        account.setPolicy(p);
    }

    function test_setPolicyRejectsLabOrdering() public {
        // Lab enforced floor < shield < target (1.2/1.5/1.6). Production
        // flips it (floor 2.50 > shield 1.60); a lab-style policy must fail.
        Policy memory p = _policy();
        p.floorICR = 1200000000000000000;
        p.shieldICR = 1500000000000000000;
        p.targetICR = 1600000000000000000;
        vm.expectRevert(TroveAccount.BadPolicy.selector);
        account.setPolicy(p);
    }

    function test_setSessionRejectsBadExpiry() public {
        vm.expectRevert(TroveAccount.BadSession.selector); // expiry in the past
        account.setSession(agent, 1, 1, 0, uint64(block.timestamp - 1), true, false);
        vm.expectRevert(TroveAccount.BadSession.selector); // expiry > now + 90 days
        account.setSession(agent, 1, 1, 0, uint64(block.timestamp + 91 days), true, false);
        account.setSession(agent, 1, 1, 0, uint64(block.timestamp + 90 days), true, false); // exactly 90d: ok
    }

    // ============ open: min debt + redemption rank ============

    function test_openBelowMinDebtReverts() public {
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        vm.prank(freshOwner);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.BelowMinDebt.selector, uint256(1000e18), uint256(1800e18))
        );
        TroveAccount(payable(fresh)).open{value: 0.05 ether}(1000e18, address(0), address(0), 0);
    }

    function test_openRedemptionExposedWithNoDebtAhead() public {
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        vm.prank(freshOwner);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.RedemptionExposed.selector, uint256(0), uint256(10000e18))
        );
        TroveAccount(payable(fresh)).open{value: 0.1 ether}(DEBT, address(0), address(0), 10000e18);
    }

    function test_openRankWalkProvesDebtAhead() public {
        // Troves ahead of the new trove (NICR below 5e15), both redeemable:
        // A: coll 0.04, debt 2000 -> NICR 2e15, ICR 200%; B: 0.06/2000 -> 3e15.
        // C sits above the new trove (NICR 6e15) and must stop the walk.
        address troveA = makeAddr("troveA");
        address troveB = makeAddr("troveB");
        address troveC = makeAddr("troveC");
        tm.setTrove(troveA, 0.04 ether, 2000e18);
        tm.setTrove(troveB, 0.06 ether, 2000e18);
        tm.setTrove(troveC, 0.12 ether, 2000e18);
        address[] memory chain = new address[](3);
        chain[0] = troveA;
        chain[1] = troveB;
        chain[2] = troveC;
        sorted.setChain(chain);
        // New trove NICR = 0.1/2000 = 5e15; debt ahead = 2000 + 2000 = 4000.
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        vm.prank(freshOwner);
        TroveAccount(payable(fresh)).open{value: 0.1 ether}(DEBT, address(0), address(0), 3000e18);
        assertEq(TroveAccount(payable(fresh)).status(), 1);
        address fresh2 = factory.createAccount(freshOwner, bytes32(uint256(0xF12E6)), _policy());
        vm.prank(freshOwner);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.RedemptionExposed.selector, uint256(4000e18), uint256(5000e18))
        );
        TroveAccount(payable(fresh2)).open{value: 0.1 ether}(DEBT, address(0), address(0), 5000e18);
    }

    // ============ buffer, allowance, views ============

    function test_parkUnparkAndClaimYield() public {
        account.park(500e18);
        assertEq(smusd.balanceOf(address(account)), 500e18);
        assertEq(musd.balanceOf(address(account)), 1500e18);
        account.unpark(200e18);
        assertEq(smusd.balanceOf(address(account)), 300e18);
        assertEq(musd.balanceOf(address(account)), 1700e18);
        smusd.setYield(address(account), 7e18);
        uint256 y = account.claimYield();
        assertEq(y, 7e18);
        assertEq(musd.balanceOf(address(account)), 1707e18, "yield stays in the account");
    }

    function test_pendingYieldFormula() public {
        // Plan 3.10: pending = balance * (yieldIndex - supplyYieldIndex) / 1e18.
        account.park(500e18);
        smusd.setYieldIndex(0.1e18);
        smusd.setSupplyYieldIndex(address(account), 0.02e18);
        assertEq(account.pendingYield(), 40e18, "500 * (0.10 - 0.02) = 40");
        assertEq(smusd.claimableYield(address(account)), 40e18, "mock agrees with the formula");
        smusd.setSupplyYieldIndex(address(account), 0.1e18);
        assertEq(account.pendingYield(), 0, "caught-up index means no pending yield");
    }

    function test_approveTokenSetsPermit2Allowance() public {
        address spender = makeAddr("permit2");
        account.approveToken(spender, 123e18);
        assertEq(musd.allowance(address(account), spender), 123e18);
    }

    function test_statusEnumBeforeAndAfterOpen() public {
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        assertEq(TroveAccount(payable(fresh)).status(), 0, "no trove yet");
        assertEq(account.status(), 1, "active after createAndOpen");
    }

    function test_neededHealthyAndStressed() public {
        (uint256 icr, uint256 repayWanted, uint256 collWanted, uint8 reason) = account.needed();
        assertEq(reason, 0, "healthy trove needs nothing");
        assertEq(repayWanted, 0);
        assertEq(collWanted, 0);
        assertGt(icr, 2e18);
        // Stressed trove: 0.03 BTC, 2000 MUSD -> ICR ~1.4985 < shield 1.60.
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0x571E55)), _policy());
        vm.prank(freshOwner);
        TroveAccount(payable(fresh)).open{value: 0.03 ether}(DEBT, address(0), address(0), 0);
        TroveAccount stressed = TroveAccount(payable(fresh));
        (icr, repayWanted, collWanted, reason) = stressed.needed();
        assertEq(reason, 1, "ICR trigger");
        assertLt(icr, 16e17);
        assertEq(repayWanted, 2e18, "repay bounded by debt - 200 - 1800 min net debt");
        assertEq(collWanted, 0.01 ether, "0.04 target coll - 0.03 held");
    }

    function test_previewDrawOkAndRefusals() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        (bool ok, uint8 reason, uint256 icrAfter, uint256 fee) = account.previewDraw(agent, payee, 100e18);
        assertTrue(ok);
        assertEq(reason, 0);
        assertEq(fee, 0.1e18);
        assertGt(icrAfter, 25e17);
        (ok, reason,,) = account.previewDraw(agent, payee, 600e18);
        assertFalse(ok);
        assertEq(reason, 3, "OVER_PER_TX");
        (ok, reason,,) = account.previewDraw(agent2, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 1, "SESSION_INACTIVE");
        // The floor case needs caps above the draw size, or per-tx fires first.
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        (ok, reason,,) = account.previewDraw(agent, payee, 1996e18);
        assertFalse(ok);
        assertEq(reason, 6, "BELOW_FLOOR");
        (ok, reason,,) = account.previewDraw(agent, payee, 0);
        assertFalse(ok);
        assertEq(reason, 9, "ZERO_AMOUNT");
    }

    function test_previewDrawRecoveryMode() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        tm.setRecoveryMode(address(account), true);
        (bool ok, uint8 reason,,) = account.previewDraw(agent, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 7, "RECOVERY_MODE");
    }

    function test_drawInRecoveryModeReverts() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        tm.setRecoveryMode(address(account), true);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(3e18)));
        _drawAs(agent, payee, 10e18);
    }

    function test_borrowToEnforcesFloorWithoutFee() public {
        // 2000e18 borrow (no draw fee on the owner path): debt 2002 -> 4004e18,
        // ICR ~2.4975 < 2.50 floor. Expected ICR is computed from the mocks,
        // not hand-computed.
        (uint256 coll, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(account));
        uint256 debtAfter = principal + interest + 2000e18 + bo.getBorrowingFee(2000e18);
        uint256 expectedIcr = coll * pf.fetchPrice() / debtAfter;
        assertLt(expectedIcr, 25e17, "test setup: this borrow must breach the floor");
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BelowFloor.selector, expectedIcr, uint256(25e17)));
        account.borrowTo(2000e18, payee, address(0), address(0));
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        account.borrowTo(100e18, payee, address(0), address(0));
        assertEq(musd.balanceOf(payee), 100e18);
        assertEq(musd.balanceOf(feeRecipient) - feeBefore, 0, "owner borrow has no fee");
    }

    function test_checkpointEmits() public {
        vm.expectEmit(false, false, false, true, address(account));
        emit TroveAccount.Checkpoint(1, 4995004995004995004, 3e18, false);
        account.checkpoint();
    }

    // ============ F2: fee parity (implementation immutables vs Factory) ============

    function test_F2_feeMismatchRevertsAtCreation() public {
        // Gate 1 (factory constructor, J3-extra round 2 item 1): a factory
        // cannot even be deployed against a mismatched implementation.
        TroveAccount impl50 = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 50
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                TroveAccountFactory.ImplementationFeeMismatch.selector, feeRecipient, uint16(50)
            )
        );
        new TroveAccountFactory(address(impl50), feeRecipient, 10);
        // Gate 2 (initialize): called directly on an implementation with
        // mismatched fee params, it reverts FeeMismatch too.
        address otherRecipient = makeAddr("otherRecipient");
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.FeeMismatch.selector, otherRecipient, uint16(10))
        );
        implementation.initialize(owner, _policy(), otherRecipient, 10);
    }

    function test_F2_feeRecipientMismatchRevertsAtCreation() public {
        address otherRecipient = makeAddr("otherRecipient");
        vm.expectRevert(
            abi.encodeWithSelector(
                TroveAccountFactory.ImplementationFeeMismatch.selector, feeRecipient, uint16(10)
            )
        );
        new TroveAccountFactory(address(implementation), otherRecipient, 10);
    }

    function test_F2_implementationRejectsFeeAboveCap() public {
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.FeeBpsTooHigh.selector, uint16(51)));
        new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 51
        );
    }
}
