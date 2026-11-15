// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {Batcher} from "../../src/account/Batcher.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {ITM} from "../../src/account/interfaces/ITM.sol";
import {ISortedTroves} from "../../src/account/interfaces/ISortedTroves.sol";

/// @notice Minimal TroveManager stand-in for the Batcher suite: only the
///         reads TroveAccount makes on the draw / claim / checkpoint paths.
///         Borrowing fee 0.1%, min net debt 1800 MUSD, gas comp 200 MUSD
///         (plan 3.3, G1); price comes from MockPriceFeed (100_000e18).
contract BatcherMockTM {
    mapping(address => uint256) public coll;
    mapping(address => uint256) public debt;
    mapping(address => uint8) public status;
    uint256 public tcr = 3e18;

    function setTrove(address b, uint256 c, uint256 d) external {
        coll[b] = c;
        debt[b] = d;
    }
    function setStatus(address b, uint8 s) external {
        status[b] = s;
    }
    function addDebt(address b, uint256 d) external {
        debt[b] += d;
    }
    function subDebt(address b, uint256 d) external {
        debt[b] -= d;
    }
    function addColl(address b, uint256 c) external {
        coll[b] += c;
    }
    function subColl(address b, uint256 c) external {
        coll[b] -= c;
    }

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
    function checkRecoveryMode(uint256) external pure returns (bool) {
        return false;
    }
    function getTCR(uint256) external view returns (uint256) {
        return tcr;
    }
}

/// @notice Minimal BorrowerOperations stand-in. `claimCollateral` models
///         BOTH live behaviours the fork test must distinguish, via the
///         `revertOnZeroSurplus` toggle: Liquity's CollSurplusPool requires
///         a positive balance (`"CollSurplusPool: No collateral available
///         to claim"`), so the live Mezo call may REVERT on zero surplus
///         instead of no-op. The Batcher must survive either one.
/// @dev The mock COLLAPSES the CollSurplusPool into the BO itself: the
///         surplus lives in `surplus[]`, so the BO answers `getCollateral`
///         from the same mapping `claimCollateral` pays out of. That is
///         why `collSurplusPool()` returns `address(this)` — on live Mezo
///         the BO declares `ICollSurplusPool public collSurplusPool`
///         (musd repo BO.sol:106) and `getCollateral` returns
///         `balances[account]`; the real TroveAccount's read-first guard
///         (1.3 closefix) calls exactly these two getters, so the mock
///         must expose them or every claim reverts on the missing getter.
contract BatcherMockBO {
    MockMUSD public musd;
    BatcherMockTM public tm;
    MockPriceFeed public pf;
    mapping(address => uint256) public surplus;
    bool public revertOnZeroSurplus;

    constructor(MockMUSD m, BatcherMockTM t, MockPriceFeed p) {
        musd = m;
        tm = t;
        pf = p;
    }

    function setSurplus(address b, uint256 a) external {
        surplus[b] = a;
    }
    function setRevertOnZeroSurplus(bool r) external {
        revertOnZeroSurplus = r;
    }
    /// @notice Live BO getter (musd repo BO.sol:106). Collapsed mock:
    ///         the pool IS this contract, see the contract doc above.
    function collSurplusPool() external view returns (address) {
        return address(this);
    }
    /// @notice Live CollSurplusPool getter, answered from `surplus[]`.
    function getCollateral(address a) external view returns (uint256) {
        return surplus[a];
    }
    function minNetDebt() external pure returns (uint256) {
        return 1800e18;
    }
    function getBorrowingFee(uint256 d) external pure returns (uint256) {
        return d * 1e15 / 1e18; // 0.1%
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
        if (amt == 0 && revertOnZeroSurplus) {
            revert("CollSurplusPool: No collateral available to claim");
        }
        surplus[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok);
    }

    receive() external payable {}
}

/// @notice Minimal sMUSD stand-in. `claimYield` models both behaviours via
///         `revertOnZeroYield`, mirroring the claimCollateral toggle.
contract BatcherMockSMUSD {
    MockMUSD public musd;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public yieldOwed;
    bool public revertOnZeroYield;
    uint256 public yieldIndex;
    mapping(address => uint256) public supplyYieldIndex;

    constructor(MockMUSD m) {
        musd = m;
    }

    function setYield(address a, uint256 y) external {
        yieldOwed[a] = y;
    }
    function setRevertOnZeroYield(bool r) external {
        revertOnZeroYield = r;
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
        if (y == 0 && revertOnZeroYield) revert("no yield");
        yieldOwed[msg.sender] = 0;
        musd.transfer(msg.sender, y);
        return y;
    }
    function claimableYield(address a) external view returns (uint256) {
        return yieldOwed[a];
    }
}

contract BatcherMockSorted {
    function getLast() external pure returns (address) {
        return address(0);
    }
    function getPrev(address) external pure returns (address) {
        return address(0);
    }
    function getNext(address) external pure returns (address) {
        return address(0);
    }
    function contains(address) external pure returns (bool) {
        return false;
    }
    function findInsertPosition(uint256, address, address) external pure returns (address, address) {
        return (address(0), address(0));
    }
}

/// @notice J3 probe, kept as a regression mock: an account whose
///         `claimCollateral()` DECREASES its own balance (sends 0.01 ETH
///         to a sink). A genuine TroveAccount clone cannot do this (its
///         claim only receives), but the Batcher is best-effort for ANY
///         address the keeper passes, so a balance drop mid-claim must
///         report `claimed == 0`, never panic the whole batch.
contract BalanceDropper {
    address public sink;

    constructor(address _sink) {
        sink = _sink;
    }

    function claimCollateral() external {
        (bool ok,) = sink.call{value: 0.01 ether}("");
        require(ok);
    }

    receive() external payable {}
}

/// @notice Regression mock for the Batcher's best-effort path: an account
///         whose `claimCollateral()` always reverts. The batch must report
///         `ok == false, claimed == 0` for it and still settle every good
///         account in the same batch.
contract RevertingClaimer {
    function claimCollateral() external {
        revert("boom");
    }

    receive() external payable {}
}

/// @notice Live Mezo TroveManager redemption entry point. In Mezo's musd
///         repo the redemption lives on TroveManager (NOT on
///         BorrowerOperations as in Liquity v1): `redeemCollateral(amount,
///         firstHint, upperPartialHint, lowerPartialHint,
///         partialHintNICR, maxIterations)`, no max-fee parameter, and
///         `_maxIterations == 0` means unlimited. Anyone may call it; it
///         requires the caller's MUSD balance to cover `_amount` and TCR
///         above MCR, and walks SortedTroves from the lowest NICR.
/// @dev Used ONLY by the fork test below.
interface IMezoRedeem {
    function redeemCollateral(
        uint256 amount,
        address firstHint,
        address upperPartialHint,
        address lowerPartialHint,
        uint256 partialHintNICR,
        uint256 maxIterations
    ) external;
}

/// @notice Live Mezo CollSurplusPool read (musd repo: `getCollateral`
///         returns the surplus BTC owed to a borrower). Fork test only.
interface ICollSurplusPool {
    function getCollateral(address account) external view returns (uint256);
}

/// @notice Task 1.6 acceptance tests (plan section 10, task 1.6; plan 3.1,
///         3.5, 3.7; threat rule S20): the Batcher promotes the proven lab
///         multicall, adds a typed `multiDraw` helper, and batches the
///         permissionless `claimCollateral` / `claimYield` / `checkpoint`
///         calls across accounts. The acceptance invariant is asserted in
///         EVERY test below, not just claimed: `address(batcher).balance`
///         is 0 after every promote / claim / checkpoint path.
/// @dev Unit tests run against the mocks above (no fork, no RPC). The fork
///         test at the bottom is env-gated: it is SKIPPED unless
///         `BATCHER_FORK=1` is set, and then runs against a pinned mainnet
///         fork (read-only RPC; nothing is broadcast).
contract BatcherTest is Test {
    MockMUSD public musd;
    MockPriceFeed public pf;
    BatcherMockTM public tm;
    BatcherMockBO public bo;
    BatcherMockSMUSD public smusd;
    BatcherMockSorted public sorted;
    TroveAccount public implementation;
    TroveAccountFactory public factory;
    Batcher public batcher;
    TroveAccount public accountA;
    TroveAccount public accountB;
    address public feeRecipient = makeAddr("feeRecipient");
    address public owner = address(this);
    address public payee = makeAddr("payee");
    address public stranger = makeAddr("stranger");

    uint256 public constant PK1 = 0xA11CE;
    uint256 public constant PK2 = 0xB0B;
    address public agent1 = vm.addr(PK1);
    address public agent2 = vm.addr(PK2);

    bytes32 public constant SALT_A = bytes32(uint256(0xBA7C1));
    bytes32 public constant SALT_B = bytes32(uint256(0xBA7C2));
    uint256 public constant COLL = 0.1 ether;
    uint256 public constant DEBT = 2000e18;

    receive() external payable {}

    function setUp() public {
        musd = new MockMUSD();
        pf = new MockPriceFeed();
        tm = new BatcherMockTM();
        bo = new BatcherMockBO(musd, tm, pf);
        smusd = new BatcherMockSMUSD(musd);
        sorted = new BatcherMockSorted();
        vm.deal(address(this), 100 ether);
        vm.deal(address(bo), 100 ether);
        musd.mint(address(smusd), 100_000e18); // yield payouts
        implementation = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 10
        );
        factory = new TroveAccountFactory(address(implementation), feeRecipient, 10);
        batcher = new Batcher();
        address a = factory.createAndOpen{value: COLL}(SALT_A, _policy(), DEBT, address(0), address(0), 0);
        accountA = TroveAccount(payable(a));
        address b = factory.createAndOpen{value: COLL}(SALT_B, _policy(), DEBT, address(0), address(0), 0);
        accountB = TroveAccount(payable(b));
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

    function _setSession(TroveAccount acct, address agent, uint128 budget, uint128 perTx) internal {
        acct.setSession(agent, budget, perTx, 0, uint64(block.timestamp + 7 days), true, false);
    }

    function _signIntent(TroveAccount acct, uint256 pk, address agent, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = acct.intentDigest(agent, payee, amount, acct.intentNonce(agent), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _assertBatcherEmpty() internal view {
        assertEq(address(batcher).balance, 0, "S20: Batcher balance must always be 0");
    }

    function _oneAccount() internal view returns (address[] memory accts) {
        accts = new address[](1);
        accts[0] = address(accountA);
    }

    function _twoAccounts() internal view returns (address[] memory accts) {
        accts = new address[](2);
        accts[0] = address(accountA);
        accts[1] = address(accountB);
    }

    // ============ multiDraw: two agents, one tx (lab M2b mirror) ============

    function test_multiDrawTwoAgentsOneTx() public {
        _setSession(accountA, agent1, 1000e18, 500e18);
        _setSession(accountA, agent2, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        bytes memory sig2 = _signIntent(accountA, PK2, agent2, 40e18, deadline);

        address[] memory accts = new address[](2);
        accts[0] = address(accountA);
        accts[1] = address(accountA);
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](2);
        intents[0] = Batcher.DrawIntent(agent1, payee, 60e18, deadline, sig1);
        intents[1] = Batcher.DrawIntent(agent2, payee, 40e18, deadline, sig2);

        // Any relayer may submit: the Batcher holds no privilege.
        vm.prank(stranger);
        batcher.multiDraw(accts, intents);

        assertEq(musd.balanceOf(payee), 100e18, "both draws paid the payee in one tx");
        assertEq(accountA.intentNonce(agent1), 1, "agent1 nonce consumed once");
        assertEq(accountA.intentNonce(agent2), 1, "agent2 nonce consumed once");
        _assertBatcherEmpty();
    }

    function test_multiDrawTwoAccounts() public {
        _setSession(accountA, agent1, 1000e18, 500e18);
        _setSession(accountB, agent2, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sigA = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        bytes memory sigB = _signIntent(accountB, PK2, agent2, 40e18, deadline);

        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](2);
        intents[0] = Batcher.DrawIntent(agent1, payee, 60e18, deadline, sigA);
        intents[1] = Batcher.DrawIntent(agent2, payee, 40e18, deadline, sigB);

        batcher.multiDraw(_twoAccounts(), intents);

        assertEq(musd.balanceOf(payee), 100e18, "one draw per account, one tx");
        assertEq(accountA.intentNonce(agent1), 1);
        assertEq(accountB.intentNonce(agent2), 1);
        _assertBatcherEmpty();
    }

    function test_multiDrawLengthMismatchReverts() public {
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](1);
        intents[0] = Batcher.DrawIntent(agent1, payee, 60e18, block.timestamp + 10 minutes, new bytes(65));
        vm.expectRevert(abi.encodeWithSelector(Batcher.LengthMismatch.selector, uint256(2), uint256(1)));
        batcher.multiDraw(_twoAccounts(), intents);
        _assertBatcherEmpty();
    }

    function test_multiDrawEmptyIsNoop() public {
        batcher.multiDraw(new address[](0), new Batcher.DrawIntent[](0));
        _assertBatcherEmpty();
    }

    /// @notice All-or-nothing (lab `multi` semantics): one bad signature
    ///         reverts the whole batch and consumes NO nonce, pays NOBODY.
    function test_multiDrawAtomicityOnBadSig() public {
        _setSession(accountA, agent1, 1000e18, 500e18);
        _setSession(accountA, agent2, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        // sig2 is signed by agent1's key but submitted for agent2.
        bytes memory badSig = _signIntent(accountA, PK1, agent2, 40e18, deadline);

        address[] memory accts = new address[](2);
        accts[0] = address(accountA);
        accts[1] = address(accountA);
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](2);
        intents[0] = Batcher.DrawIntent(agent1, payee, 60e18, deadline, sig1);
        intents[1] = Batcher.DrawIntent(agent2, payee, 40e18, deadline, badSig);

        vm.expectRevert(TroveAccount.BadSig.selector);
        batcher.multiDraw(accts, intents);

        assertEq(musd.balanceOf(payee), 0, "atomic: the good draw did not pay out");
        assertEq(accountA.intentNonce(agent1), 0, "atomic: no nonce consumed");
        assertEq(accountA.intentNonce(agent2), 0, "atomic: no nonce consumed");
        _assertBatcherEmpty();
    }

    // ============ multi: lab path, verbatim semantics ============

    function test_multiTwoDrawBySigLabPath() public {
        _setSession(accountA, agent1, 1000e18, 500e18);
        _setSession(accountA, agent2, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        bytes memory sig2 = _signIntent(accountA, PK2, agent2, 40e18, deadline);

        address[] memory targets = new address[](2);
        targets[0] = address(accountA);
        targets[1] = address(accountA);
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeWithSelector(
            TroveAccount.drawBySig.selector, agent1, payee, 60e18, deadline, sig1
        );
        data[1] = abi.encodeWithSelector(
            TroveAccount.drawBySig.selector, agent2, payee, 40e18, deadline, sig2
        );

        bytes[] memory out = batcher.multi(targets, data);
        assertEq(out.length, 2, "multi returns one returndata blob per call");
        assertEq(musd.balanceOf(payee), 100e18, "lab path: two draws, one tx");
        _assertBatcherEmpty();
    }

    function test_multiRevertsAndBubblesReason() public {
        _setSession(accountA, agent1, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        address[] memory targets = new address[](2);
        targets[0] = address(accountA);
        targets[1] = address(accountA);
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeWithSelector(
            TroveAccount.drawBySig.selector, agent1, payee, 60e18, deadline, sig1
        );
        // Second call replays the same intent: BadSig, bubbled out of multi.
        data[1] = data[0];
        vm.expectRevert(TroveAccount.BadSig.selector);
        batcher.multi(targets, data);
        assertEq(accountA.intentNonce(agent1), 0, "reverted batch consumed nothing");
        _assertBatcherEmpty();
    }

    // ============ claimCollateral batch ============

    function test_claimCollateralBatchClaimsSurplus() public {
        tm.setStatus(address(accountA), 4);
        tm.setStatus(address(accountB), 4);
        bo.setSurplus(address(accountA), 0.02 ether);
        bo.setSurplus(address(accountB), 0.005 ether);
        uint256 balABefore = address(accountA).balance;
        uint256 balBBefore = address(accountB).balance;

        vm.prank(stranger); // permissionless: any keeper may sweep
        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(_twoAccounts());

        assertTrue(ok[0], "A claimed");
        assertTrue(ok[1], "B claimed");
        assertEq(claimed[0], 0.02 ether, "A surplus lands in the account");
        assertEq(claimed[1], 0.005 ether, "B surplus lands in the account");
        assertEq(address(accountA).balance - balABefore, 0.02 ether);
        assertEq(address(accountB).balance - balBBefore, 0.005 ether);
        assertEq(bo.surplus(address(accountA)), 0, "surplus pool drained for A");
        _assertBatcherEmpty();
    }

    /// @notice THE J3 CASE, revert flavour — SUBSUMED by the 1.3 closefix
    ///         guard. The read-first guard in TroveAccount._claimCollateral
    ///         (1.3) reads the surplus via BO's collSurplusPool and NO-OPS
    ///         (emitting CollateralClaimed(0)) when it is zero, so a real
    ///         TroveAccount clone NEVER reaches the reverting BO call for
    ///         an already-claimed account: the batch reports `ok == true,
    ///         claimed == 0` for B. `revertOnZeroSurplus` stays set to
    ///         prove the guard never reaches the reverting call — if the
    ///         guard regressed, this test would fail with ok[1] == false.
    ///         The Batcher's best-effort `ok == false` path itself is
    ///         preserved by test_claimCollateralBatchReportsRevertingAccount.
    function test_claimCollateralBatchToleratesZeroSurplusRevert() public {
        bo.setRevertOnZeroSurplus(true);
        tm.setStatus(address(accountA), 4);
        bo.setSurplus(address(accountA), 0.02 ether);
        // B was redeemed but its surplus was already claimed: zero balance.

        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(_twoAccounts());

        assertTrue(ok[0], "A still claims");
        assertTrue(ok[1], "B zero-surplus is no-op'd by the 1.3 guard, never reaches the reverting call");
        assertEq(claimed[0], 0.02 ether);
        assertEq(claimed[1], 0, "nothing claimed for B");
        _assertBatcherEmpty();
    }

    /// @notice Regression for the Batcher's best-effort `ok == false`
    ///         path: an account whose claimCollateral() always reverts
    ///         must NOT brick the batch. A claims exactly; the reverting
    ///         account reports `ok == false, claimed == 0`; the batcher
    ///         stays empty. (The rewritten
    ///         test_claimCollateralBatchToleratesZeroSurplusRevert no
    ///         longer exercises this path: the 1.3 guard no-ops zero
    ///         surplus before any reverting call.)
    function test_claimCollateralBatchReportsRevertingAccount() public {
        RevertingClaimer claimer = new RevertingClaimer();
        bo.setSurplus(address(accountA), 0.02 ether);
        uint256 balABefore = address(accountA).balance;

        address[] memory accts = new address[](2);
        accts[0] = address(accountA);
        accts[1] = address(claimer);

        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(accts);

        assertTrue(ok[0], "good account still claims");
        assertFalse(ok[1], "reverting account reports ok == false, not propagated");
        assertEq(claimed[0], 0.02 ether, "good account claims exactly");
        assertEq(claimed[1], 0, "nothing claimed for the reverting account");
        assertEq(address(accountA).balance - balABefore, 0.02 ether);
        _assertBatcherEmpty();
    }

    /// @notice THE J3 CASE, no-op flavour: if the live call instead no-ops
    ///         on zero surplus, the batch reports `ok == true, claimed == 0`
    ///         for that account. Either live behaviour is handled.
    function test_claimCollateralBatchToleratesZeroSurplusNoop() public {
        bo.setRevertOnZeroSurplus(false);
        bo.setSurplus(address(accountA), 0.02 ether);

        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(_twoAccounts());

        assertTrue(ok[0]);
        assertTrue(ok[1], "no-op zero-surplus still reports success");
        assertEq(claimed[0], 0.02 ether);
        assertEq(claimed[1], 0);
        _assertBatcherEmpty();
    }

    function test_claimCollateralBatchEmptyIsNoop() public {
        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(new address[](0));
        assertEq(ok.length, 0);
        assertEq(claimed.length, 0);
        _assertBatcherEmpty();
    }

    function testFuzz_claimCollateralBatchSweepsExactSurplus(uint256 surplusA, uint256 surplusB) public {
        surplusA = bound(surplusA, 0, 10 ether);
        surplusB = bound(surplusB, 0, 10 ether);
        bo.setSurplus(address(accountA), surplusA);
        bo.setSurplus(address(accountB), surplusB);
        uint256 balABefore = address(accountA).balance;
        uint256 balBBefore = address(accountB).balance;

        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(_twoAccounts());

        assertTrue(ok[0]);
        assertTrue(ok[1]);
        assertEq(claimed[0], surplusA, "claimed == surplus exactly (A)");
        assertEq(claimed[1], surplusB, "claimed == surplus exactly (B)");
        assertEq(address(accountA).balance - balABefore, surplusA);
        assertEq(address(accountB).balance - balBBefore, surplusB);
        _assertBatcherEmpty();
    }

    /// @notice J3 F1 REGRESSION: a balance-dropping account in the middle
    ///         of a batch must NOT panic (0x11) the whole batch. A and B
    ///         hold real surplus; the dropper holds 1 ETH and its claim
    ///         sends 0.01 ETH to a sink, so its balance DECREASES during
    ///         the call. The batch succeeds, A/B claim exactly, the
    ///         dropper reports `ok == true, claimed == 0` (saturating
    ///         delta), and no good claim rolls back.
    function test_claimCollateralBatchToleratesBalanceDropMidBatch() public {
        address sink = makeAddr("sink");
        BalanceDropper dropper = new BalanceDropper(sink);
        vm.deal(address(dropper), 1 ether);
        bo.setSurplus(address(accountA), 0.02 ether);
        bo.setSurplus(address(accountB), 0.005 ether);

        address[] memory accts = new address[](3);
        accts[0] = address(accountA);
        accts[1] = address(dropper);
        accts[2] = address(accountB);

        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(accts);

        assertTrue(ok[0], "A claimed");
        assertTrue(ok[1], "dropper call itself succeeded");
        assertTrue(ok[2], "B claimed");
        assertEq(claimed[0], 0.02 ether, "A surplus exact despite the dropper");
        assertEq(claimed[1], 0, "saturating delta: a balance drop reports 0, never underflows");
        assertEq(claimed[2], 0.005 ether, "B surplus exact despite the dropper");
        assertEq(address(dropper).balance, 0.99 ether, "dropper really did lose 0.01 ETH mid-claim");
        assertEq(sink.balance, 0.01 ether, "the dropped ETH reached the sink");
        _assertBatcherEmpty();
    }

    // ============ MAX_BATCH: keeper-side cap (J3 F2) ============

    function _nAccounts(uint256 n) internal view returns (address[] memory accts) {
        accts = new address[](n);
        for (uint256 i; i < n; i++) {
            accts[i] = address(accountA);
        }
    }

    function test_claimCollateralBatchAtMaxBatchSucceeds() public {
        (bool[] memory ok, uint256[] memory claimed) = batcher.claimCollateralBatch(_nAccounts(100));
        assertEq(ok.length, 100, "exactly MAX_BATCH entries accepted");
        assertTrue(ok[0], "first entry ok");
        assertTrue(ok[99], "last entry ok");
        assertEq(claimed[0], 0, "zero surplus on the repeated account");
        _assertBatcherEmpty();
    }

    function test_claimCollateralBatchOverMaxBatchReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Batcher.BatchTooLarge.selector, uint256(101), uint256(100)));
        batcher.claimCollateralBatch(_nAccounts(101));
        _assertBatcherEmpty();
    }

    function test_claimYieldBatchOverMaxBatchReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Batcher.BatchTooLarge.selector, uint256(101), uint256(100)));
        batcher.claimYieldBatch(_nAccounts(101));
        _assertBatcherEmpty();
    }

    function test_checkpointBatchOverMaxBatchReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Batcher.BatchTooLarge.selector, uint256(101), uint256(100)));
        batcher.checkpointBatch(_nAccounts(101));
        _assertBatcherEmpty();
    }

    function test_multiOverMaxBatchReverts() public {
        address[] memory targets = _nAccounts(101);
        bytes[] memory data = new bytes[](101);
        vm.expectRevert(abi.encodeWithSelector(Batcher.BatchTooLarge.selector, uint256(101), uint256(100)));
        batcher.multi(targets, data);
        _assertBatcherEmpty();
    }

    function test_multiDrawOverMaxBatchReverts() public {
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](101);
        vm.expectRevert(abi.encodeWithSelector(Batcher.BatchTooLarge.selector, uint256(101), uint256(100)));
        batcher.multiDraw(_nAccounts(101), intents);
        _assertBatcherEmpty();
    }

    // ============ claimYield batch ============

    function test_claimYieldBatchStaysInAccount() public {
        accountA.park(500e18);
        accountB.park(300e18);
        smusd.setYield(address(accountA), 7e18);
        smusd.setYield(address(accountB), 3e18);

        (bool[] memory ok, uint256[] memory yields) = batcher.claimYieldBatch(_twoAccounts());

        assertTrue(ok[0]);
        assertTrue(ok[1]);
        assertEq(yields[0], 7e18, "A yield claimed into A");
        assertEq(yields[1], 3e18, "B yield claimed into B");
        assertEq(musd.balanceOf(address(accountA)), 1500e18 + 7e18, "yield stays in the account");
        assertEq(musd.balanceOf(address(accountB)), 1700e18 + 3e18, "yield stays in the account");
        assertEq(musd.balanceOf(address(batcher)), 0, "no MUSD ever touches the Batcher");
        _assertBatcherEmpty();
    }

    function test_claimYieldBatchToleratesZeroYieldRevert() public {
        smusd.setRevertOnZeroYield(true);
        smusd.setYield(address(accountA), 7e18);
        // B has no yield owed: its claim reverts under this flavour.

        (bool[] memory ok, uint256[] memory yields) = batcher.claimYieldBatch(_twoAccounts());

        assertTrue(ok[0], "A still claims");
        assertFalse(ok[1], "B zero-yield revert is reported, not propagated");
        assertEq(yields[0], 7e18);
        assertEq(yields[1], 0);
        _assertBatcherEmpty();
    }

    function test_claimYieldBatchZeroYieldNoop() public {
        smusd.setRevertOnZeroYield(false);
        (bool[] memory ok, uint256[] memory yields) = batcher.claimYieldBatch(_twoAccounts());
        assertTrue(ok[0]);
        assertTrue(ok[1]);
        assertEq(yields[0], 0);
        assertEq(yields[1], 0);
        _assertBatcherEmpty();
    }

    // ============ checkpoint batch ============

    function test_checkpointBatchEmitsForBoth() public {
        (bool[] memory ok) = batcher.checkpointBatch(_twoAccounts());
        assertTrue(ok[0], "A checkpointed");
        assertTrue(ok[1], "B checkpointed");
        _assertBatcherEmpty();
    }

    // ============ balance-always-0: the Batcher cannot receive funds ============

    function test_batcherRejectsPlainEthTransfer() public {
        (bool ok,) = address(batcher).call{value: 1 ether}("");
        assertFalse(ok, "no receive()/fallback: plain ETH transfer reverts");
        _assertBatcherEmpty();
    }

    function test_batcherRejectsValueOnMulti() public {
        // The compiler itself refuses `{value: ...}` on these calls
        // (non-payable), so prove it with a low-level call carrying value.
        bytes memory data =
            abi.encodeWithSelector(Batcher.multi.selector, new address[](0), new bytes[](0));
        (bool ok,) = address(batcher).call{value: 1 ether}(data);
        assertFalse(ok, "multi is not payable");
        _assertBatcherEmpty();
    }

    function test_batcherRejectsValueOnClaimBatch() public {
        bytes memory data =
            abi.encodeWithSelector(Batcher.claimCollateralBatch.selector, _oneAccount());
        (bool ok,) = address(batcher).call{value: 1 ether}(data);
        assertFalse(ok, "claimCollateralBatch is not payable");
        _assertBatcherEmpty();
    }

    function test_combinedSweepLeavesBatcherEmpty() public {
        // One keeper transaction shape: draw batch + claim batch +
        // yield batch + checkpoint batch, back to back.
        _setSession(accountA, agent1, 1000e18, 500e18);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(accountA, PK1, agent1, 60e18, deadline);
        address[] memory accts = new address[](1);
        accts[0] = address(accountA);
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](1);
        intents[0] = Batcher.DrawIntent(agent1, payee, 60e18, deadline, sig1);
        batcher.multiDraw(accts, intents);

        bo.setSurplus(address(accountA), 0.01 ether);
        smusd.setYield(address(accountA), 2e18);
        batcher.claimCollateralBatch(accts);
        batcher.claimYieldBatch(accts);
        batcher.checkpointBatch(accts);

        assertEq(musd.balanceOf(payee), 60e18);
        // The mock BO keeps the opening collateral (as the live BO does:
        // it sits in ActivePool, not in the account), so the account holds
        // exactly the claimed surplus after the sweep.
        assertEq(address(accountA).balance, 0.01 ether, "surplus landed in the account");
        _assertBatcherEmpty();
    }

    // ============ FORK: claimCollateral after a simulated redemption ============
    //
    // Run with: BATCHER_FORK=1 forge test --match-test testFork_ -vv
    // (read-only fork of mainnet; NOTHING is broadcast).
    //
    // Design: mainnet has only 4 troves, so the redemption walk is cheap.
    // A fresh production account opens a 0.05 BTC / 2000 MUSD trove at
    // NICR ~2.27e15, which sits between trove #2 (NICR ~2.16e15) and trove #3
    // (~2.83e15) in redemption order. Redeeming ~6006 MUSD through the
    // live TroveManager then fully redeems #1, #2 and our trove, leaving a
    // real surplus in CollSurplusPool. The test then proves (a) the Batcher
    // claims that surplus into the account, and (b) the LIVE zero-surplus
    // behaviour (revert vs no-op) and that the batch survives it.
    // The oracle precompile cannot be read on a fork (plan G3), so the
    // PriceFeed is stubbed with a fixed price via `vm.mockCall` — the
    // same pattern the lab fork tests use (`vm.mockCall(PF,
    // fetchPrice)`). NOTE: `vm.etch` was tried first and does NOT work
    // here: the code lands (extcodesize 39) but every call to the etched
    // address fails with `NotActivated` on this fork (verified with a
    // probe test); `mockCall` returns the stubbed price correctly.

    uint256 internal constant FORK_BLOCK = 13243357; // mainnet, read 2026-11-15
    uint256 internal constant FORK_PRICE = 65565407150000000000000; // live BTC price, read 2026-11-15
    address internal constant MAINNET_BO = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
    address internal constant MAINNET_TM = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address internal constant MAINNET_PF = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;
    address internal constant MAINNET_MUSD = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
    address internal constant MAINNET_SMUSD = 0xb4D498029af77680cD1eF828b967f010d06C51CC;
    address internal constant MAINNET_SORTED = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;
    address internal constant MAINNET_CSP = 0xBF51807ACb3394B8550f0554FB9098856Ef5F491;

    function testFork_claimCollateralAfterSimulatedRedemption() public {
        if (!vm.envOr("BATCHER_FORK", false)) {
            vm.skip(true);
        }
        vm.createSelectFork("mezo_mainnet", FORK_BLOCK);

        // G3: stub the PriceFeed with a fixed price via mockCall (see the
        // comment above: vm.etch does not work on this fork).
        vm.mockCall(MAINNET_PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(FORK_PRICE));

        vm.deal(address(this), 100 ether);
        address forkFeeRecipient = makeAddr("forkFeeRecipient");
        TroveAccount forkImpl = new TroveAccount(
            MAINNET_BO, MAINNET_TM, MAINNET_PF, MAINNET_MUSD, MAINNET_SMUSD, MAINNET_SORTED, forkFeeRecipient, 10
        );
        TroveAccountFactory forkFactory = new TroveAccountFactory(address(forkImpl), forkFeeRecipient, 10);
        Batcher forkBatcher = new Batcher();

        // Open: 0.05 BTC / 2000 MUSD. Composite debt is 2202.0 MUSD (2000 + 0.1% borrowing fee on the drawn amount = 2.0 + 200 gas comp, plan 3.13/G1), so
        // ICR at the stubbed price is ~1.49x and NICR is ~2.27e15:
        // behind #1 (~1.77e15) and #2 (~2.16e15), ahead of #3 (~2.83e15).
        address acct = forkFactory.createAndOpen{value: 0.05 ether}(
            bytes32(uint256(0xF0126)), _policy(), 2000e18, address(0), address(0), 0
        );
        assertEq(ITM(MAINNET_TM).getTroveStatus(acct), 1, "trove active after open");
        uint256 icr = ITM(MAINNET_TM).getCurrentICR(acct, FORK_PRICE);
        assertGt(icr, 1.45e18, "ICR above 1.45 at stub price");
        assertLt(icr, 1.52e18, "ICR below 1.52 at stub price");

        // Size the redemption: full debts of the two troves ahead of us
        // plus our own, with a 50 MUSD margin (any excess partially
        // redeems trove #3 on this read-only fork; that is harmless).
        address first = ISortedTroves(MAINNET_SORTED).getLast();
        address second = ISortedTroves(MAINNET_SORTED).getPrev(first);
        uint256 redeemAmount = _forkDebt(first) + _forkDebt(second) + _forkDebt(acct) + 50e18;
        emit log_named_uint("redeemAmount MUSD", redeemAmount / 1e18);
        deal(MAINNET_MUSD, address(this), 10_000e18);

        IMezoRedeem(MAINNET_TM).redeemCollateral(redeemAmount, address(0), address(0), address(0), 0, 0);

        assertEq(ITM(MAINNET_TM).getTroveStatus(acct), 4, "trove redeemed (status 4)");
        uint256 surplus = ICollSurplusPool(MAINNET_CSP).getCollateral(acct);
        emit log_named_uint("surplus BTC (wei)", surplus);
        assertGt(surplus, 0, "redemption left a real surplus in CollSurplusPool");

        // (a) The Batcher claims the real surplus into the account.
        address[] memory accts = new address[](1);
        accts[0] = acct;
        uint256 acctBalBefore = acct.balance;
        (bool[] memory ok, uint256[] memory claimed) = forkBatcher.claimCollateralBatch(accts);
        assertTrue(ok[0], "batch claim of real surplus succeeds");
        assertEq(claimed[0], surplus, "claimed == surplus exactly");
        assertEq(acct.balance - acctBalBefore, surplus, "surplus BTC landed in the account");
        assertEq(ICollSurplusPool(MAINNET_CSP).getCollateral(acct), 0, "surplus pool drained");
        assertEq(address(forkBatcher).balance, 0, "S20: Batcher balance stays 0 on the fork");

        // (b) LIVE zero-surplus behaviour, established on the fork: does a
        //     second claim revert (Liquity CollSurplusPool requires
        //     balance > 0) or no-op? Either way the batch must survive it.
        (bool directOk,) = acct.call(abi.encodeWithSelector(TroveAccount.claimCollateral.selector));
        if (directOk) {
            emit log_string("LIVE: zero-surplus claimCollateral NO-OPS (does not revert)");
        } else {
            emit log_string("LIVE: zero-surplus claimCollateral REVERTS (CollSurplusPool requires balance > 0)");
        }
        (bool[] memory ok2, uint256[] memory claimed2) = forkBatcher.claimCollateralBatch(accts);
        assertEq(claimed2[0], 0, "nothing left to claim");
        assertEq(ok2[0], directOk, "batch mirrors the live per-account outcome without bricking");
        assertEq(address(forkBatcher).balance, 0, "S20: Batcher balance stays 0 after zero-surplus batch");

        // Yield + checkpoint batches on the same forked account.
        (bool[] memory yok, uint256[] memory yields) = forkBatcher.claimYieldBatch(accts);
        assertEq(yields[0], 0, "no sMUSD parked, no yield");
        emit log_named_uint("LIVE: claimYield ok (1 = success, 0 = live call reverts)", yok[0] ? 1 : 0);
        (bool[] memory cok) = forkBatcher.checkpointBatch(accts);
        assertTrue(cok[0], "checkpoint succeeds on the forked account");
        assertEq(address(forkBatcher).balance, 0, "S20: Batcher balance stays 0 after all fork batches");
    }

    function _forkDebt(address trove) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = ITM(MAINNET_TM).getEntireDebtAndColl(trove);
        return principal + interest;
    }
}
