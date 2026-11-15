// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Batcher} from "../../src/account/Batcher.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {TestTroveManager, TestBorrowerOperations, TestSavings, TestSortedTroves} from "./TroveAccount.t.sol";

/// @notice Task 1.7 invariant suite (plan section 10, row 1.7; invariants
///         section 3.12; threat-model rules section 7.2). A handler drives
///         one production TroveAccount (mock Mezo stack) through random
///         sequences of draws, signed draws, sessions, parks, shields,
///         repays, sweeps, price/TCR moves and block/time travel, tracking
///         ghost sums. The invariants assert the plan's I1/I2/I4/I6/I7/I10/
///         I11/I12/I13 plus S20 (Batcher holds no funds) after every step.
///         Invariant config: 256 runs, depth 64 (plan row 1.7).
/// @dev Harness mirrors TroveAccount.t.sol (same mocks, same main account:
///      owner = this handler, 0.1 BTC collateral, 2000 MUSD debt, price
///      100_000e18 -> ICR ~4.995e18, production policy floor 2.50 / shield
///      1.60 / target 2.00, bounty 1 MUSD, cooldown 20). `borrowTo` and
///      `closeAccount` are deliberately NOT handlers: the former would pay
///      an unmetered address (breaking I12/I13), the latter ends the trove
///      (I5 is proven by the fuzz suite instead). `withdrawColl` is not a
///      handler either: it moves BTC only and its RM-block is covered by
///      the fork suite.
contract AccountHandler is Test {
    MockMUSD public musd;
    MockPriceFeed public pf;
    TestTroveManager public tm;
    TestBorrowerOperations public bo;
    TestSavings public smusd;
    TestSortedTroves public sorted;
    TroveAccount public implementation;
    TroveAccountFactory public factory;
    TroveAccount public account;
    Batcher public batcher;

    address public feeRecipient = makeAddr("feeRecipient");
    address public payee = makeAddr("payee");
    address public keeper = makeAddr("keeper");
    uint256 public constant AGENT1_PK = 0xA11CE1;
    uint256 public constant AGENT2_PK = 0xA11CE2;
    address public agent1 = vm.addr(AGENT1_PK);
    address public agent2 = vm.addr(AGENT2_PK);

    bytes32 public constant SALT = bytes32(uint256(0xACC0));
    uint256 public constant COLL = 0.1 ether;
    uint256 public constant DEBT = 2000e18;
    uint256 public constant FLOOR = 2.5e18;
    uint256 public constant MIN_DEBT_PLUS_COMP = 2000e18; // 1800 min net + 200 gas comp (I6)
    uint256 public constant BOUNTY = 1e18;

    // ============ Ghost state (I12/I13 accounting) ============
    uint256 public ghostMinted; // MUSD ever minted to the account (open + draws)
    uint256 public ghostPayeeAmount; // sum of draw `amount` paid to the payee
    uint256 public ghostFeeExpected; // sum of ceil(amount * 10 / 10000)
    uint256 public ghostBounties; // sum of shield bounties paid to the keeper
    uint256 public ghostRepaid; // sum of MUSD burned by repay + shield repay
    uint256 public ghostSwept; // sum of MUSD swept to the owner
    uint256 public ghostYield; // sum of sMUSD yield claimed into the account
    uint256 public ghostDraws;
    uint256 public ghostDrawBySig1;
    uint256 public ghostDrawBySig2;
    uint256 public ghostShieldCount;
    uint256 public ghostBatchDraws;
    uint256 public lastDrawIcr; // ICR right after the most recent successful draw (I1)
    uint64 public lastShieldBlock;
    uint64 public prevShieldBlock;
    uint256 public minShieldSpacing = type(uint256).max; // min blocks between shields (I7)

    receive() external payable {}

    constructor() {
        musd = new MockMUSD();
        pf = new MockPriceFeed();
        tm = new TestTroveManager();
        bo = new TestBorrowerOperations(musd, tm, pf);
        smusd = new TestSavings(musd);
        sorted = new TestSortedTroves();
        batcher = new Batcher();
        vm.deal(address(this), 100 ether);
        vm.deal(address(bo), 100 ether);
        musd.mint(address(smusd), 100_000e18);
        implementation = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 10
        );
        factory = new TroveAccountFactory(address(implementation), feeRecipient, 10);
        address a = factory.createAndOpen{value: COLL}(SALT, _policy(), DEBT, address(0), address(0), 0);
        account = TroveAccount(payable(a));
        ghostMinted = DEBT; // open mints exactly `debt` MUSD to the account
        // Live sessions for both agents from the start so draws can succeed.
        account.setSession(agent1, 10000e18, 1000e18, 5000e18, uint64(block.timestamp + 7 days), true, false);
        account.setSession(agent2, 10000e18, 1000e18, 5000e18, uint64(block.timestamp + 7 days), true, false);
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

    function _debt() internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(address(account));
        return principal + interest;
    }

    function _fee(uint256 amount) internal pure returns (uint256) {
        return (amount * 10 + 9999) / 10000;
    }

    function _recordDraw(uint256 amount) internal {
        uint256 fee = _fee(amount);
        ghostDraws++;
        ghostPayeeAmount += amount;
        ghostFeeExpected += fee;
        ghostMinted += amount + fee; // the mock mints exactly `gross` on withdrawMUSD
        lastDrawIcr = tm.getCurrentICR(address(account), pf.fetchPrice());
        assertGe(lastDrawIcr, FLOOR, "I1: post-draw ICR below floor");
    }

    function _agentAndPk(uint256 seed) internal view returns (address agent, uint256 pk) {
        return seed % 2 == 0 ? (agent1, AGENT1_PK) : (agent2, AGENT2_PK);
    }

    // ============ Handlers ============

    function draw(uint256 amountSeed) public {
        (address agent,) = _agentAndPk(amountSeed);
        uint256 amount = bound(amountSeed, 1, 1200e18);
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        uint256 payeeBefore = musd.balanceOf(payee);
        vm.prank(agent);
        try account.draw(payee, amount) {
            _recordDraw(amount);
            assertEq(musd.balanceOf(feeRecipient) - feeBefore, _fee(amount), "I10: fee paid");
            assertEq(musd.balanceOf(payee) - payeeBefore, amount, "I12: payee paid exact amount");
        } catch {}
    }

    function drawBySig(uint256 amountSeed) public {
        (address agent, uint256 pk) = _agentAndPk(amountSeed);
        uint256 amount = bound(amountSeed, 1, 1200e18);
        uint256 deadline = block.timestamp + 10 minutes;
        uint256 nonceBefore = account.intentNonce(agent);
        bytes32 d = account.intentDigest(agent, payee, amount, nonceBefore, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        bytes memory sig = abi.encodePacked(r, s, v);
        try account.drawBySig(agent, payee, amount, deadline, sig) {
            assertEq(account.intentNonce(agent), nonceBefore + 1, "I11: nonce +1 per accepted intent");
            if (agent == agent1) ghostDrawBySig1++;
            else ghostDrawBySig2++;
            _recordDraw(amount);
            // A used signature can never replay (I11).
            (bool ok,) = address(account).call(
                abi.encodeWithSignature(
                    "drawBySig(address,address,uint256,uint256,bytes)", agent, payee, amount, deadline, sig
                )
            );
            assertFalse(ok, "I11: replayed intent must revert");
            assertEq(account.intentNonce(agent), nonceBefore + 1, "I11: replay consumes no nonce");
        } catch {}
    }

    function batchDraw(uint256 seed1, uint256 seed2) public {
        uint256 amount1 = bound(seed1, 1, 800e18);
        uint256 amount2 = bound(seed2, 1, 800e18);
        uint256 deadline = block.timestamp + 10 minutes;
        address[] memory accts = new address[](2);
        accts[0] = address(account);
        accts[1] = address(account);
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](2);
        intents[0] = _intent(agent1, AGENT1_PK, amount1, deadline);
        intents[1] = _intent(agent2, AGENT2_PK, amount2, deadline);
        try batcher.multiDraw(accts, intents) {
            ghostDrawBySig1++;
            ghostDrawBySig2++;
            ghostBatchDraws += 2;
            _recordDraw(amount1);
            _recordDraw(amount2);
            assertEq(musd.balanceOf(address(batcher)), 0, "S20: Batcher holds no MUSD");
        } catch {}
    }

    function _intent(address agent, uint256 pk, uint256 amount, uint256 deadline)
        internal
        view
        returns (Batcher.DrawIntent memory)
    {
        bytes32 d = account.intentDigest(agent, payee, amount, account.intentNonce(agent), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return Batcher.DrawIntent({agent: agent, payee: payee, amount: amount, deadline: deadline, sig: abi.encodePacked(r, s, v)});
    }

    function setSession(uint256 seed) public {
        (address agent,) = _agentAndPk(seed);
        uint128 budget = uint128(bound(seed >> 8, 100e18, 10000e18));
        uint128 perTx = uint128(bound(seed >> 16, 10e18, 1000e18));
        uint128 daily = uint128(bound(seed >> 24, 0, 5000e18));
        account.setSession(agent, budget, perTx, daily, uint64(block.timestamp + 7 days), true, false);
    }

    function revokeSession(uint256 seed) public {
        (address agent,) = _agentAndPk(seed);
        account.revokeSession(agent);
    }

    function revokeAll() public {
        account.revokeAll();
    }

    function park(uint256 seed) public {
        uint256 bal = musd.balanceOf(address(account));
        if (bal == 0) return;
        uint256 amount = bound(seed, 1, bal);
        account.park(amount);
    }

    function unpark(uint256 seed) public {
        uint256 bal = smusd.balanceOf(address(account));
        if (bal == 0) return;
        uint256 amount = bound(seed, 1, bal);
        account.unpark(amount);
    }

    function shield() public {
        uint256 keeperBefore = musd.balanceOf(keeper);
        vm.prank(keeper);
        try account.shield() returns (uint256 repaid, uint256 collAdded) {
            uint256 bountyPaid = musd.balanceOf(keeper) - keeperBefore;
            assertLe(bountyPaid, BOUNTY, "I7: bounty above policy cap");
            if (ghostShieldCount > 0) {
                uint256 spacing = block.number - lastShieldBlock;
                if (spacing < minShieldSpacing) minShieldSpacing = spacing;
                assertGe(spacing, 20, "I7: shield inside cooldown");
            }
            prevShieldBlock = lastShieldBlock;
            lastShieldBlock = uint64(block.number);
            ghostShieldCount++;
            ghostBounties += bountyPaid;
            ghostRepaid += repaid;
            assertGe(_debt(), MIN_DEBT_PLUS_COMP, "I6: shield left debt below minNetDebt + gas comp");
            collAdded; // collateral leg is BTC-side; MUSD accounting is unaffected
        } catch {}
    }

    function repay(uint256 seed) public {
        uint256 debt = _debt();
        uint256 maxRepay = debt > 1800e18 ? debt - 1800e18 : 0;
        uint256 bal = musd.balanceOf(address(account));
        uint256 cap = bal < maxRepay ? bal : maxRepay;
        if (cap == 0) return;
        uint256 amount = bound(seed, 1, cap);
        try account.repay(amount, address(0), address(0)) {
            ghostRepaid += amount;
            assertGe(_debt(), 1800e18, "G1: repay left debt below min net debt");
        } catch {}
    }

    function addColl(uint256 seed) public {
        uint256 amount = bound(seed, 1, 0.05 ether);
        if (amount > address(this).balance) return;
        account.addColl{value: amount}(address(0), address(0));
    }

    function sweepMusd(uint256 seed) public {
        uint256 bal = musd.balanceOf(address(account));
        if (bal == 0) return;
        uint256 amount = bound(seed, 1, bal);
        account.sweepMusd(amount);
        ghostSwept += amount;
    }

    function setYieldAndClaim(uint256 seed) public {
        uint256 y = bound(seed, 0, 10e18);
        smusd.setYield(address(account), y);
        uint256 claimed = account.claimYield();
        assertEq(claimed, y, "claimYield returns the set yield");
        ghostYield += claimed;
    }

    function claimCollateral() public {
        account.claimCollateral(); // no-op at zero surplus; must never revert (I8)
    }

    function checkpoint() public {
        account.checkpoint();
    }

    function setPrice(uint256 seed) public {
        pf.set(bound(seed, 20000e18, 120000e18));
    }

    function setTCR(uint256 seed) public {
        tm.setTCR(bound(seed, 1400000000000000000, 3000000000000000000));
    }

    function rollBlocks(uint256 seed) public {
        vm.roll(block.number + bound(seed, 1, 25));
    }

    function warpTime(uint256 seed) public {
        vm.warp(block.timestamp + bound(seed, 1, 8 days));
    }
}

/// @notice Invariant assertions over the handler's ghost sums (plan 3.12).
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract TroveAccountInvariantTest is StdInvariant, Test {
    AccountHandler public handler;

    function setUp() public {
        handler = new AccountHandler();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](19);
        selectors[0] = AccountHandler.draw.selector;
        selectors[1] = AccountHandler.drawBySig.selector;
        selectors[2] = AccountHandler.batchDraw.selector;
        selectors[3] = AccountHandler.setSession.selector;
        selectors[4] = AccountHandler.revokeSession.selector;
        selectors[5] = AccountHandler.revokeAll.selector;
        selectors[6] = AccountHandler.park.selector;
        selectors[7] = AccountHandler.unpark.selector;
        selectors[8] = AccountHandler.shield.selector;
        selectors[9] = AccountHandler.repay.selector;
        selectors[10] = AccountHandler.addColl.selector;
        selectors[11] = AccountHandler.sweepMusd.selector;
        selectors[12] = AccountHandler.setYieldAndClaim.selector;
        selectors[13] = AccountHandler.claimCollateral.selector;
        selectors[14] = AccountHandler.checkpoint.selector;
        selectors[15] = AccountHandler.setPrice.selector;
        selectors[16] = AccountHandler.setTCR.selector;
        selectors[17] = AccountHandler.rollBlocks.selector;
        selectors[18] = AccountHandler.warpTime.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _debt() internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) =
            handler.tm().getEntireDebtAndColl(address(handler.account()));
        return principal + interest;
    }

    function _session(address agent) internal view returns (uint128 budget, uint128 spent) {
        (budget, spent,,,,,,,,,,) = handler.account().sessions(agent);
    }

    // I1: after any successful agent draw, ICR >= floor (recorded at draw time).
    function invariant_I1_lastDrawIcrAtOrAboveFloor() public view {
        if (handler.ghostDraws() > 0) {
            assertGe(handler.lastDrawIcr(), 2.5e18, "I1");
        }
    }

    // I2: for every session, spent <= budget.
    function invariant_I2_spentWithinBudget() public view {
        (uint128 b1, uint128 s1) = _session(handler.agent1());
        (uint128 b2, uint128 s2) = _session(handler.agent2());
        assertLe(s1, b1, "I2 agent1");
        assertLe(s2, b2, "I2 agent2");
    }

    // I4: owner never changes after initialize; no function changes it.
    function invariant_I4_ownerImmutable() public view {
        assertEq(handler.account().owner(), address(handler), "I4");
    }

    // G1/I6 floor: net debt never drops below the 1800 MUSD minimum.
    function invariant_I6_debtNeverBelowMinNet() public view {
        if (handler.account().status() == 1) {
            assertGe(_debt(), 1800e18, "I6/G1");
        }
    }

    // I7: bounty <= 1 MUSD per shield, at most once per 20 blocks.
    function invariant_I7_bountyBoundedAndCooledDown() public view {
        assertLe(handler.ghostBounties(), handler.ghostShieldCount() * 1e18, "I7 cap");
        if (handler.ghostShieldCount() >= 2) {
            assertGe(handler.minShieldSpacing(), 20, "I7 cooldown");
        }
    }

    // I10: fee = ceil(amount * feeBps / 10000); fee recipient holds exactly the ghost sum.
    function invariant_I10_feeAccounting() public view {
        assertEq(handler.musd().balanceOf(handler.feeRecipient()), handler.ghostFeeExpected(), "I10");
    }

    // I11: intentNonce increases by exactly 1 per accepted drawBySig, per agent.
    function invariant_I11_nonceAccounting() public view {
        assertEq(handler.account().intentNonce(handler.agent1()), handler.ghostDrawBySig1(), "I11 agent1");
        assertEq(handler.account().intentNonce(handler.agent2()), handler.ghostDrawBySig2(), "I11 agent2");
    }

    // I12: total MUSD out to non-owner addresses = sum of agent amount + fee + shield bounties.
    function invariant_I12_outflowAccounting() public view {
        assertEq(handler.musd().balanceOf(handler.payee()), handler.ghostPayeeAmount(), "I12 payee");
        assertEq(handler.musd().balanceOf(handler.keeper()), handler.ghostBounties(), "I12 keeper");
    }

    // I13: balance + sMUSD + repaid + out + swept + bounties reconciles with minted + yield.
    function invariant_I13_reconciliation() public view {
        uint256 lhs = handler.musd().balanceOf(address(handler.account()))
            + handler.smusd().balanceOf(address(handler.account())) + handler.ghostRepaid()
            + handler.ghostPayeeAmount() + handler.ghostFeeExpected() + handler.ghostBounties()
            + handler.ghostSwept();
        uint256 rhs = handler.ghostMinted() + handler.ghostYield();
        assertEq(lhs, rhs, "I13");
    }

    // S20: the Batcher never holds funds.
    function invariant_S20_batcherHoldsNoFunds() public view {
        assertEq(handler.musd().balanceOf(address(handler.batcher())), 0, "S20 MUSD");
        assertEq(address(handler.batcher()).balance, 0, "S20 BTC");
    }
}
