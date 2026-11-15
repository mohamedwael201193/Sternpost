// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {TestTroveManager, TestBorrowerOperations, TestSavings, TestSortedTroves} from "./TroveAccount.t.sol";

/// @notice Task 1.4 acceptance tests (plan section 10, row 1.4; section 3.7
///         Shield; invariants I6, I7, I8, I9 in section 3.12; lab M4 in
///         section 4.5): ICR / rank / TCR triggers, bounded repay (G1),
///         repay-from-sMUSD, addColl-from-reserve, bounty anti-farming +
///         cooldown + hard cap, `NotStressed` / `NothingToDo` /
///         `Cooldown` / `TroveNotActive`, shield-in-Recovery-Mode, shield
///         by a stranger (random EOA, no session), and a fuzz test proving
///         I6 over 1000 runs.
/// @dev Harness mirrors TroveAccount.t.sol (same mocks, same main account:
///      owner = this test contract, 0.1 BTC collateral, 2000 MUSD debt,
///      price 100_000e18 -> ICR ~4.995e18, production policy floor 2.50 /
///      shield 1.60 / target 2.00, bounty 1 MUSD, cooldown 20).
///      Numbers: open mints `debt` MUSD and books `debt + 0.1% fee` as trove
///      debt (mock BorrowerOperations). A 2000 MUSD open therefore has debt
///      2002e18 and a min-debt repay cap of exactly 2e18 (G1).
contract TroveAccountShieldTest is Test {
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
    address public keeper = makeAddr("keeper");
    address public agent = makeAddr("agent");
    address public payee = makeAddr("payee");

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

    /// @dev Fresh stressed trove owned by this test contract. `salt` must be
    ///      unique per account in a test.
    function _stressedAccount(uint256 collAmt, uint256 debtAmt, bytes32 salt)
        internal
        returns (TroveAccount)
    {
        address a = factory.createAndOpen{value: collAmt}(salt, _policy(), debtAmt, address(0), address(0), 0);
        return TroveAccount(payable(a));
    }

    function _debtOf(address a) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(a);
        return principal + interest;
    }

    function _icrOf(address a) internal view returns (uint256) {
        return tm.getCurrentICR(a, pf.fetchPrice());
    }

    function _shieldAs(address who, TroveAccount a) internal returns (uint256 repaid, uint256 collAdded) {
        vm.prank(who);
        (repaid, collAdded) = a.shield();
    }

    // ============ Lab M4 mirror: repay from sMUSD, stranger keeper ============

    function test_shield_from_smusd() public {
        // Lab tx 0xf6de87bc...095f4b shape: ICR 1.4649 -> 1.5999, bounty
        // 1 MUSD, random EOA. Production numbers: 0.045 BTC / 3000 MUSD
        // (debt 3003 with the 0.1% fee), ICR ~1.4985, repay wanted 753,
        // capped by debt - 200 - 1800 = 1003, so the full 753 repays.
        TroveAccount stressed = _stressedAccount(0.045 ether, 3000e18, bytes32(uint256(0x5A1)));
        stressed.park(2500e18); // balance 500 left, 2500 parked
        (uint256 icrBefore, uint256 rw,,) = stressed.needed();
        assertEq(rw, 753e18, "repay wanted is the uncapped target gap");
        assertLt(icrBefore, 16e17, "stressed below the shield line");

        vm.expectEmit(true, false, false, true, address(stressed));
        emit TroveAccount.Shielded(keeper, 753e18, 0, icrBefore, 2e18, 1, 1e18);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, stressed);

        assertEq(repaid, 753e18, "repaid in full from balance + sMUSD");
        assertEq(collAdded, 0, "no collateral leg: repay reached the target");
        assertEq(smusd.balanceOf(address(stressed)), 2246e18, "unparked 254 (753 + 1 bounty - 500 balance)");
        assertEq(musd.balanceOf(address(stressed)), 0, "500 + 254 unparked - 753 repaid - 1 bounty");
        assertEq(musd.balanceOf(keeper), 1e18, "stranger keeper is paid the 1 MUSD bounty");
        assertEq(_icrOf(address(stressed)), 2e18, "ICR restored to target");
        assertEq(_debtOf(address(stressed)), 2250e18);
    }

    // ============ addColl from reserve BTC ============

    function test_shield_addCollFromReserve() public {
        // 0.03 BTC / 2000 MUSD (debt 2002): repay wanted 502, capped to 2
        // by G1; coll wanted 0.01 BTC. Reserve 0.05 BTC closes the gap.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A2)));
        (uint256 icrBefore, uint256 rw, uint256 cw, uint8 reason) = stressed.needed();
        assertEq(reason, 1, "ICR trigger");
        assertEq(rw, 2e18, "repay bounded by debt - 200 - 1800");
        assertEq(cw, 0.01 ether, "0.04 target coll - 0.03 held");
        vm.deal(address(stressed), 0.05 ether);

        vm.expectEmit(true, false, false, true, address(stressed));
        emit TroveAccount.Shielded(keeper, 2e18, 0.01 ether, icrBefore, 2e18, 1, 1e18);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, stressed);

        assertEq(repaid, 2e18);
        assertEq(collAdded, 0.01 ether, "reserve BTC tops the trove up");
        assertEq(address(stressed).balance, 0.04 ether, "reserve spent exactly the gap");
        assertEq(_icrOf(address(stressed)), 2e18, "ICR restored to target");
        assertEq(musd.balanceOf(keeper), 1e18, "ICR improved 0.5015e18 >= 0.5pp, bounty paid");
    }

    // ============ I6: min-debt bound — repay 500 must not over-repay ============

    function test_shield_minDebtBound_noOverRepay() public {
        // Lab test_min_net_debt_blocks_repay shape, via shield(): a 2000
        // MUSD trove wants 502 repaid to reach target, but G1 caps the
        // repay at 2. Debt after must stay >= 1800 + 200 = 2000.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A3)));
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18, "repay capped at debt - 200 - minNetDebt, not the 502 wanted");
        assertEq(collAdded, 0, "no reserve BTC in this account");
        assertEq(_debtOf(address(stressed)), 2000e18, "net debt never below minNetDebt + gas comp");
        assertEq(_icrOf(address(stressed)), 15e17, "ICR only 1.4985 -> 1.50: the min-debt-bounded rehearsal case");
    }

    // ============ I7: bounty farming blocked ============

    function test_bounty_farming_blocked() public {
        // Same min-debt-bounded trove: the repay moves ICR by only 0.15pp
        // (< 0.5pp) and adds only 2 MUSD of value (< 10x the 1 MUSD
        // bounty), so the shield succeeds but pays NO bounty — and a
        // second shield after the cooldown finds nothing left to do
        // (repay cap now 0, no reserve), so a keeper cannot loop it.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A4)));
        uint256 icrBefore;
        (icrBefore,,,) = stressed.needed();

        vm.expectEmit(true, false, false, true, address(stressed));
        emit TroveAccount.Shielded(keeper, 2e18, 0, icrBefore, 15e17, 1, 0);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18);
        assertEq(collAdded, 0);
        assertEq(musd.balanceOf(keeper), 0, "no bounty: ICR step 0.15pp < 0.5pp and value 2 < 10x bounty");

        vm.roll(block.number + 20); // cooldown elapsed
        vm.expectRevert(TroveAccount.NothingToDo.selector);
        _shieldAs(keeper, stressed);
    }

    // ============ I7: cooldown ============

    function test_shield_cooldown() public {
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A5)));
        (uint256 repaidFirst,) = _shieldAs(keeper, stressed); // repaid 2, ICR 1.50, still stressed
        assertEq(repaidFirst, 2e18);
        assertEq(stressed.lastShieldBlock(), block.number);

        // Same block: 20 blocks of cooldown remain.
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.Cooldown.selector, uint256(20)));
        _shieldAs(keeper, stressed);

        // After the cooldown the shield works again: give it reserve BTC
        // so the second shield can finish the job via the coll leg
        // (the repay cap is now 0: debt 2000 = minNetDebt + gas comp).
        vm.roll(block.number + 20);
        vm.deal(address(stressed), 0.01 ether);
        (uint256 repaidSecond, uint256 collAddedSecond) = _shieldAs(keeper, stressed);
        assertEq(repaidSecond, 0, "repay cap exhausted after the first shield");
        assertEq(collAddedSecond, 0.01 ether, "second shield restores via reserve BTC");
        assertEq(_icrOf(address(stressed)), 2e18);
        assertEq(musd.balanceOf(keeper), 1e18, "second shield improves ICR 0.50e18, bounty paid once");

        // And the cooldown bites again immediately.
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.Cooldown.selector, uint256(20)));
        _shieldAs(keeper, stressed);
    }

    // ============ NotStressed / NothingToDo ============

    function test_shield_notStressed_reverts() public {
        (uint256 icr,,,) = account.needed();
        assertEq(icr, 4995004995004995004, "healthy main account ICR");
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.NotStressed.selector, icr));
        _shieldAs(keeper, account);
    }

    function test_shield_nothingToDo() public {
        // Stressed, but the account holds no MUSD, no sMUSD and no reserve
        // BTC: neither leg can move anything.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A6)));
        stressed.sweepMusd(2000e18); // drain the minted MUSD to the owner
        assertEq(musd.balanceOf(address(stressed)), 0);
        assertEq(smusd.balanceOf(address(stressed)), 0);
        assertEq(address(stressed).balance, 0);
        vm.expectRevert(TroveAccount.NothingToDo.selector);
        _shieldAs(keeper, stressed);
    }

    // ============ I8: TroveNotActive ============

    function test_shield_troveNotActive() public {
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5A7)));
        tm.setStatus(address(stressed), 4); // closedByRedemption
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(4)));
        _shieldAs(keeper, stressed);
        tm.setStatus(address(stressed), 1); // back to active: the revert was status-driven
        (uint256 repaid,) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18);
    }

    // ============ Rank trigger (required name) ============

    function test_shield_rank_trigger() public {
        // ICR 1.7982: healthy vs the 1.60 shield line, below the 2.00
        // target. Rank is what fires: trove A (0.03/2000, NICR 1.5e15)
        // sits ahead of us (NICR ~1.7982e15) with 2000 redeemable MUSD;
        // trove B (0.12/2000, NICR 6e15) stops the walk. Debt ahead 2000
        // < minDebtAhead 10000, so the rank trigger fires (reason 2).
        TroveAccount trove = _stressedAccount(0.036 ether, DEBT, bytes32(uint256(0x5A8)));
        address troveA = makeAddr("rankA");
        address troveB = makeAddr("rankB");
        tm.setTrove(troveA, 0.03 ether, 2000e18);
        tm.setTrove(troveB, 0.12 ether, 2000e18);
        address[] memory chain = new address[](2);
        chain[0] = troveA;
        chain[1] = troveB;
        sorted.setChain(chain);

        // Without minDebtAhead the same trove is NOT stressed (ICR trigger
        // off, TCR healthy): the rank trigger is what fires below.
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.NotStressed.selector, _icrOf(address(trove))));
        _shieldAs(keeper, trove);

        Policy memory p = _policy();
        p.minDebtAhead = 10000e18;
        trove.setPolicy(p);
        (uint256 icrBefore, uint256 rw, uint256 cw, uint8 reason) = trove.needed();
        assertEq(reason, 2, "needed() reports the RANK trigger");
        assertEq(rw, 2e18, "min-debt-bounded repay");
        assertEq(cw, 0.004 ether, "0.04 target coll - 0.036 held");
        vm.deal(address(trove), 0.01 ether);

        vm.expectEmit(true, false, false, true, address(trove));
        emit TroveAccount.Shielded(keeper, 2e18, 0.004 ether, icrBefore, 2e18, 2, 1e18);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, trove);
        assertEq(repaid, 2e18);
        assertEq(collAdded, 0.004 ether, "reserve BTC raises NICR toward target");
        assertEq(_icrOf(address(trove)), 2e18);
        assertEq(musd.balanceOf(keeper), 1e18, "rank improvement is real: ICR step 0.20e18 >= 0.5pp");
    }

    // ============ TCR trigger ============

    function test_shield_tcr_trigger() public {
        // Same trove shape as the rank test (ICR 1.7982, no rank policy):
        // at TCR 3.0 nothing fires; at TCR 1.52 (< 155%, Recovery Mode
        // approaching but not yet in it) the TCR trigger fires (reason 3)
        // and shield repays + adds coll only — it never draws.
        TroveAccount trove = _stressedAccount(0.036 ether, DEBT, bytes32(uint256(0x5A9)));
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.NotStressed.selector, _icrOf(address(trove))));
        _shieldAs(keeper, trove);

        tm.setTCR(1520000000000000000); // 1.52e18: below 155%, above RM 1.50
        (uint256 icrBefore,,,) = trove.needed();
        vm.deal(address(trove), 0.01 ether);
        vm.expectEmit(true, false, false, true, address(trove));
        emit TroveAccount.Shielded(keeper, 2e18, 0.004 ether, icrBefore, 2e18, 3, 1e18);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, trove);
        assertEq(repaid, 2e18);
        assertEq(collAdded, 0.004 ether);
        assertEq(_icrOf(address(trove)), 2e18);
        assertEq(musd.balanceOf(keeper), 1e18);
    }

    // ============ I9: shield succeeds in Recovery Mode, draw reverts ============

    function test_shield_inRecoveryMode_succeeds_drawReverts() public {
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5AA)));
        tm.setTCR(14e17); // TCR 1.40 < 1.50: global Recovery Mode
        (uint256 icrBefore,,,) = stressed.needed();

        vm.expectEmit(true, false, false, true, address(stressed));
        emit TroveAccount.Shielded(keeper, 2e18, 0, icrBefore, 15e17, 1, 0);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18, "shield continues in Recovery Mode (I9)");
        assertEq(collAdded, 0);

        // ...while a draw reverts RecoveryMode before Mezo is called.
        stressed.setSession(agent, 1000e18, 500e18, 0, uint64(block.timestamp + 7 days), true, false);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(14e17)));
        stressed.draw(payee, 10e18);
    }

    // ============ I7: valueAdded gate pays the bounty when the ICR step is tiny ============

    function test_shield_valueAddedGate_paysBounty() public {
        // ICR 1.996 (via the TCR trigger: above the shield line, below
        // target). The full repay to target is only 200.2 MUSD, so the ICR
        // step is 0.4pp < 0.5pp — but valueAdded 200.2 >= 10x the 1 MUSD
        // bounty, so the bounty IS paid via the OR branch.
        TroveAccount trove = _stressedAccount(1997996e12, 100000e18, bytes32(uint256(0x5AB)));
        tm.setTCR(1520000000000000000);
        (uint256 icrBefore, uint256 rw,,) = trove.needed();
        assertEq(icrBefore, 1996e15, "ICR 1.996");
        assertGe(rw, 10e18, "repay adds >= 10x the bounty of value");

        vm.expectEmit(true, false, false, true, address(trove));
        emit TroveAccount.Shielded(keeper, rw, 0, icrBefore, 2e18, 3, 1e18);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, trove);
        assertEq(repaid, rw);
        assertEq(collAdded, 0);
        uint256 icrAfter = _icrOf(address(trove));
        assertEq(icrAfter, 2e18);
        assertLt(icrAfter - icrBefore, 5e15, "ICR step 0.4pp is below the 0.5pp bounty gate");
        assertEq(musd.balanceOf(keeper), 1e18, "bounty paid via valueAdded >= 10x bounty");
    }

    // ============ I7: bounty hard cap 5 MUSD ============

    function test_shield_bounty_cap_fiveMusd() public {
        TroveAccount stressed = _stressedAccount(0.045 ether, 3000e18, bytes32(uint256(0x5AC)));
        Policy memory p = _policy();
        p.bounty = 5e18; // the hard cap: setPolicy allows exactly 5
        stressed.setPolicy(p);
        (uint256 repaid,) = _shieldAs(keeper, stressed);
        assertEq(repaid, 753e18);
        assertEq(musd.balanceOf(keeper), 5e18, "at most policy.bounty is paid, and 5 MUSD is the cap");
    }

    // ============ I6 fuzz: shield never breaches minNetDebt + gas comp ============

    function testFuzz_shieldNeverBreachesMinDebt(uint256 collRaw, uint256 debtRaw) public {
        uint256 collAmt = bound(collRaw, 0.01 ether, 0.045 ether);
        uint256 debtAmt = bound(debtRaw, 3000e18, 10000e18);
        // ICR is always < 1.60 here (max 0.045*100k/3000 = 1.50), so the
        // ICR trigger always fires; debt >= 3000 so the G1 cap is > 0.
        tm.setTrove(address(account), collAmt, debtAmt);
        tm.setStatus(address(account), 1);
        musd.mint(address(account), 100_000e18);
        vm.deal(address(account), 1 ether);
        uint256 debtBefore = _debtOf(address(account));
        uint256 icrBefore = _icrOf(address(account));
        uint256 keeperBefore = musd.balanceOf(keeper);

        (uint256 repaid,) = _shieldAs(keeper, account);

        assertGt(repaid, 0, "repay leg runs on a funded stressed trove");
        assertLe(repaid, debtBefore - 2000e18, "repaid <= debt - 200 - minNetDebt (I6)");
        assertGe(_debtOf(address(account)), 2000e18, "net debt never below minNetDebt + gas comp (I6)");
        assertEq(_icrOf(address(account)), 2e18, "funded shield restores ICR to target exactly");
        assertEq(musd.balanceOf(keeper) - keeperBefore, 1e18, "bounty exactly policy.bounty (I7)");
        assertGe(_icrOf(address(account)), icrBefore, "shield never lowers ICR");
    }
}
