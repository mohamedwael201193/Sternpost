// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {ISortedTroves} from "../../src/account/interfaces/ISortedTroves.sol";
import {ITM} from "../../src/account/interfaces/ITM.sol";
import {IERC20} from "../../src/account/interfaces/IERC20.sol";
import {TestTroveManager, TestBorrowerOperations, TestSavings, TestSortedTroves} from "./TroveAccount.t.sol";

/// @notice Task 1.4 acceptance tests (plan section 10, row 1.4; section 3.7
///         Shield; invariants I6, I7, I8, I9 in section 3.12; lab M4 in
///         section 4.5): ICR / rank / TCR triggers, bounded repay (G1),
///         repay-from-sMUSD, addColl-from-reserve, bounty anti-farming +
///         cooldown + hard cap, `NotStressed` / `NothingToDo` /
///         `Cooldown` / `TroveNotActive`, shield-in-Recovery-Mode, shield
///         by a stranger (random EOA, no session), and a fuzz test proving
///         I6 over 1000 runs (foundry.toml `[fuzz] runs = 1000`).
///         1.4 FIX ROUND (J3 FAIL on 3aaadf1, 9 findings + J2 caveats):
///         F1 min value-moved bounty gate + owner cooldown bypass; F2
///         owner-armed exit blocks front-running shields; F3 cooldown
///         bounds in `_validatePolicy`; F4 zero-price revert; F5 `needed()`
///         reports the TCR trigger; F6 price read once (expectCall);
///         F7 hints refreshed after the repay leg; F8 lifetime aggregate
///         bounty cap 50 MUSD; F9 reentrancy / fork / price-0 /
///         cooldown-0 / close-race / crash-during-cooldown coverage.
///         Labels: MOCK = mock Mezo stack (MockMezo/Test* doubles);
///         FORK = `testFork_` against live Mezo contracts on a mainnet
///         fork (price feed stubbed via mockCall, plan G3). A test that
///         says MOCK does not validate the live Mezo path.
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
        assertEq(musd.balanceOf(keeper), 1e18, "ICR step 0.5015e18 (50.15pp) >= 0.005e18 (0.5pp), bounty paid");
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
        assertEq(musd.balanceOf(keeper), 1e18, "second shield improves ICR by 0.50e18 (50pp), bounty paid once");

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
        assertEq(musd.balanceOf(keeper), 1e18, "rank improvement is real: ICR step 0.2018e18 (20.18pp) >= 0.005e18 (0.5pp)");
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
    // MOCK-ONLY (J2 caveat F2): Recovery Mode is simulated via the mock
    // TroveManager's setTCR, so this test cannot validate the real Mezo
    // RM path. The live path is covered by the FORK test below, which
    // shields a real trove on a mainnet fork (healthy TCR only — no
    // live-fork Recovery-Mode shield test exists in this commit).

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

    // ============ F1 fix: micro-shield bounty farming — min value moved ============

    function test_shield_microShield_noBountyDespiteStep() public {
        // Geometry: the ICR step from a repay is ~ICR * repaid / debtAfter,
        // so a 0.5pp step on a ~2000 MUSD trove needs only ~6.5 MUSD
        // repaid — under the old step-only rule that earned the full
        // 1 MUSD bounty for 8 MUSD of value moved. The fix round also
        // requires valueAdded >= MIN_BOUNTY_VALUE_MOVED (10 MUSD): this
        // shield improves ICR by 0.62pp yet pays NO bounty.
        // Trove: coll 0.031124 BTC, debt 2008 MUSD (set directly on the
        // mock, exact values — open would add the 0.1% fee). Repay cap =
        // 2008 - 200 - 1800 = 8; ICR before 1.55, after 1.5562.
        tm.setTrove(address(account), 0.031124 ether, 2008e18);
        tm.setStatus(address(account), 1);
        (uint256 icrBefore,,,) = account.needed();
        assertEq(icrBefore, 1550000000000000000, "ICR 1.55");
        (uint256 repaid,) = _shieldAs(keeper, account);
        assertEq(repaid, 8e18, "repay capped by debt - 200 - minNetDebt");
        assertEq(_icrOf(address(account)), 1556200000000000000, "ICR step 0.62pp >= 0.5pp");
        assertEq(musd.balanceOf(keeper), 0, "no bounty: valueAdded 8 < MIN_BOUNTY_VALUE_MOVED 10");
        assertEq(account.totalBountyPaid(), 0);
    }

    // ============ F1 fix: owner bypasses the cooldown (rescue lockout) ============

    function test_shield_ownerBypassesCooldown() public {
        // Same-block rescue: the keeper shields (repay 2, ICR 1.50, still
        // stressed), the owner then shields again in the SAME block — the
        // cooldown does not bind the owner — and finishes the job from
        // reserve BTC. A keeper trying the same block still hits Cooldown.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5B1)));
        (uint256 repaidFirst,) = _shieldAs(keeper, stressed);
        assertEq(repaidFirst, 2e18);
        vm.deal(address(stressed), 0.01 ether);
        (uint256 repaidSecond, uint256 collAddedSecond) = _shieldAs(owner, stressed);
        assertEq(repaidSecond, 0, "repay cap exhausted after the first shield");
        assertEq(collAddedSecond, 0.01 ether, "owner rescue finishes via reserve BTC");
        assertEq(_icrOf(address(stressed)), 2e18);
        assertEq(musd.balanceOf(owner), 1e18, "owner rescue earns the bounty - from its own funds");
        // The owner's shield advanced lastShieldBlock, so a keeper is still locked out.
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.Cooldown.selector, uint256(20)));
        _shieldAs(keeper, stressed);
    }

    // ============ F2 fix: owner-armed exit blocks the front-running shield ============

    function test_shield_exitArmed_blocksFrontrun_closeSucceeds() public {
        // Close-race: the owner arms the exit, a keeper front-running the
        // close gets ExitArmed and extracts nothing, and the owner's
        // closeAccount() then succeeds and clears the flag.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5B2)));
        vm.expectEmit(false, false, false, true, address(stressed));
        emit TroveAccount.ExitArmedSet(true);
        stressed.armExit();
        assertTrue(stressed.exitArmed());
        vm.expectRevert(TroveAccount.ExitArmed.selector);
        _shieldAs(keeper, stressed);
        assertEq(musd.balanceOf(keeper), 0, "front-runner extracted nothing");
        assertEq(stressed.lastShieldBlock(), 0, "blocked shield advanced nothing");
        stressed.closeAccount();
        assertEq(stressed.status(), 2, "closedByOwner");
        assertFalse(stressed.exitArmed(), "close clears the flag");
    }

    function test_shield_exitDisarm_restoresShield() public {
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5B3)));
        stressed.armExit();
        vm.expectRevert(TroveAccount.ExitArmed.selector);
        _shieldAs(keeper, stressed);
        stressed.disarmExit();
        assertFalse(stressed.exitArmed());
        (uint256 repaid,) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18, "shield works again after disarm");
    }

    function test_armExit_onlyOwner() public {
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5B4)));
        vm.prank(keeper);
        vm.expectRevert(TroveAccount.NotOwner.selector);
        stressed.armExit();
        vm.prank(keeper);
        vm.expectRevert(TroveAccount.NotOwner.selector);
        stressed.disarmExit();
    }

    // ============ F3 fix: cooldown bounds in _validatePolicy ============

    function test_setPolicyRejectsCooldownZeroAndHuge() public {
        Policy memory p = _policy();
        p.cooldownBlocks = 0; // 0 would disable the anti-farming guard
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BadCooldown.selector, uint32(0)));
        account.setPolicy(p);
        p = _policy();
        p.cooldownBlocks = type(uint32).max; // huge would brick shield()
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BadCooldown.selector, type(uint32).max));
        account.setPolicy(p);
        // Boundaries are accepted: 1 block and 10_000 blocks.
        p = _policy();
        p.cooldownBlocks = 1;
        account.setPolicy(p);
        p.cooldownBlocks = 10_000;
        account.setPolicy(p);
        (,,,,, uint32 cd) = account.policy();
        assertEq(cd, 10_000, "max cooldown stored");
    }

    // ============ F4 fix: zero-price oracle ============

    function test_shield_zeroPrice_reverts() public {
        // MOCK: the zero price is simulated via MockPriceFeed.set(0). At
        // price 0 the ICR is undefined (icrBefore 0, icrAfter 0) and the
        // old code still repaid up to the G1 cap and could pay a bounty
        // on valueAdded alone. The fix reverts ZeroPrice instead of
        // shielding blind.
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5B5)));
        pf.set(0);
        vm.expectRevert(TroveAccount.ZeroPrice.selector);
        _shieldAs(keeper, stressed);
        assertEq(musd.balanceOf(keeper), 0, "no bounty at price 0");
        assertEq(stressed.lastShieldBlock(), 0, "reverted shield advanced nothing");
        // The view stays honest too: no repay is wanted without a price.
        (uint256 icr, uint256 rw, uint256 cw, uint8 reason) = stressed.needed();
        assertEq(icr, 0);
        assertEq(rw, 0, "_repayWanted returns 0 at price 0");
        assertEq(cw, 0, "_collWanted already returned 0 at price 0");
        assertEq(reason, 1, "ICR trigger reported, but with nothing wanted");
        pf.set(100_000e18); // price returns: the shield works again.
        (uint256 repaid,) = _shieldAs(keeper, stressed);
        assertEq(repaid, 2e18);
    }

    // ============ F5 fix: needed() reports the TCR trigger ============

    function test_needed_reportsTcrTrigger() public {
        TroveAccount trove = _stressedAccount(0.036 ether, DEBT, bytes32(uint256(0x5B6)));
        (,,, uint8 reasonHealthy) = trove.needed();
        assertEq(reasonHealthy, 0, "healthy TCR, no trigger");
        tm.setTCR(1520000000000000000); // 1.52 < 1.55 threshold, above RM 1.50
        (uint256 icr, uint256 rw, uint256 cw, uint8 reason) = trove.needed();
        assertEq(reason, 3, "needed() reports the TCR trigger");
        assertLt(icr, 2e18, "ICR 1.7982 below target");
        assertGt(icr, 16e17, "ICR 1.7982 above the shield line");
        assertEq(rw, 2e18, "min-debt-bounded repay");
        assertEq(cw, 0.004 ether, "0.04 target coll - 0.036 held");
        tm.setTCR(3e18); // restore the default
    }

    // ============ F6 fix: price read once (expectCall count) ============

    function test_readOnce_shieldRankPath() public {
        // The rank walk used to re-read the price feed. expectCall with
        // a count proves shield() calls fetchPrice() exactly once on the
        // rank path. Price reads after the shield would break the count,
        // so this test reads the price via the `price()` getter, never
        // fetchPrice(), after setting the expectation.
        TroveAccount trove = _stressedAccount(0.036 ether, DEBT, bytes32(uint256(0x5B7)));
        address troveA = makeAddr("rankA6");
        address troveB = makeAddr("rankB6");
        tm.setTrove(troveA, 0.03 ether, 2000e18);
        tm.setTrove(troveB, 0.12 ether, 2000e18);
        address[] memory chain = new address[](2);
        chain[0] = troveA;
        chain[1] = troveB;
        sorted.setChain(chain);
        Policy memory p = _policy();
        p.minDebtAhead = 10000e18;
        trove.setPolicy(p);
        vm.deal(address(trove), 0.01 ether);

        vm.expectCall(address(pf), abi.encodeWithSignature("fetchPrice()"), 1);
        (uint256 repaid, uint256 collAdded) = _shieldAs(keeper, trove);
        assertEq(repaid, 2e18);
        assertEq(collAdded, 0.004 ether);
        uint256 icrAfter = tm.getCurrentICR(address(trove), pf.price());
        assertEq(icrAfter, 2e18);
    }

    function test_readOnce_openRankWalk() public {
        // The open path: createAndOpen with minDebtAhead > 0 used to read
        // the price twice (rank walk + opening ICR). Now once.
        address troveA = makeAddr("openA");
        address troveB = makeAddr("openB");
        address troveC = makeAddr("openC");
        tm.setTrove(troveA, 0.04 ether, 2000e18);
        tm.setTrove(troveB, 0.06 ether, 2000e18);
        tm.setTrove(troveC, 0.12 ether, 2000e18);
        address[] memory chain = new address[](3);
        chain[0] = troveA;
        chain[1] = troveB;
        chain[2] = troveC;
        sorted.setChain(chain);
        vm.expectCall(address(pf), abi.encodeWithSignature("fetchPrice()"), 1);
        address a = factory.createAndOpen{value: 0.1 ether}(
            bytes32(uint256(0x5B8)), _policy(), DEBT, address(0), address(0), 3000e18
        );
        assertEq(TroveAccount(payable(a)).status(), 1);
    }

    // ============ F7 fix: hints refreshed after the repay leg ============

    function test_shield_hintsRefreshedAfterRepay() public {
        // The repay moves NICR, so the addColl leg must use fresh hints.
        // DynamicSortedTroves returns LOW hints while NICR < 1.55e15 and
        // HIGH hints above it. Trove 0.15 BTC / 10010 MUSD (debt after
        // the 0.1% open fee): NICR 1.4985e15 before the repay, 1.5773e15
        // after repaying 500 (MUSD drained to 500 first, so the repay is
        // partial and a collateral gap remains). expectCall pins the
        // exact hints each leg uses: repay LOW, addColl HIGH. On the old
        // code addColl reused the LOW hints and this test fails.
        MockMUSD m7 = new MockMUSD();
        MockPriceFeed pf7 = new MockPriceFeed();
        TestTroveManager tm7 = new TestTroveManager();
        TestBorrowerOperations bo7 = new TestBorrowerOperations(m7, tm7, pf7);
        TestSavings sm7 = new TestSavings(m7);
        address lowUp = makeAddr("lowUp");
        address lowLo = makeAddr("lowLo");
        address highUp = makeAddr("highUp");
        address highLo = makeAddr("highLo");
        DynamicSortedTroves dyn = new DynamicSortedTroves(tm7, 155e13, lowUp, lowLo, highUp, highLo);
        m7.mint(address(sm7), 100_000e18);
        TroveAccount impl7 = new TroveAccount(
            address(bo7), address(tm7), address(pf7), address(m7), address(sm7), address(dyn), feeRecipient, 10
        );
        TroveAccountFactory fac7 = new TroveAccountFactory(address(impl7), feeRecipient, 10);
        address a7 = fac7.createAndOpen{value: 0.15 ether}(
            bytes32(uint256(0x5B9)), _policy(), 10000e18, address(0), address(0), 0
        );
        TroveAccount stressed = TroveAccount(payable(a7));
        stressed.sweepMusd(9500e18); // balance 500: the repay is partial
        vm.deal(address(stressed), 0.05 ether);
        vm.expectCall(
            address(bo7), abi.encodeWithSignature("repayMUSD(uint256,address,address)", 500e18, lowUp, lowLo), 1
        );
        vm.expectCall(address(bo7), abi.encodeWithSignature("addColl(address,address)", highUp, highLo), 1);
        vm.prank(keeper);
        (uint256 repaid, uint256 collAdded) = stressed.shield();
        assertEq(repaid, 500e18);
        assertEq(collAdded, 0.0402 ether, "0.1902 target coll - 0.15 held");
        assertEq(tm7.getCurrentICR(address(stressed), pf7.price()), 2e18);
    }

    // ============ F8 fix: lifetime aggregate bounty cap ============

    function test_shield_aggregateBountyCap_fiftyMusd() public {
        // The per-call cap is 5 MUSD, but nothing capped the lifetime
        // total. The fix caps lifetime bounties at 50 MUSD per trove:
        // ten full 5-MUSD bounties, then the shield still works but pays
        // 0. Each round re-stresses the same trove (mock setTrove +
        // fresh MUSD + cooldown roll) so every round is bounty-eligible.
        TroveAccount stressed = _stressedAccount(0.045 ether, 3000e18, bytes32(uint256(0x5BB)));
        Policy memory p = _policy();
        p.bounty = 5e18;
        stressed.setPolicy(p);
        for (uint256 round; round < 11; round++) {
            tm.setTrove(address(stressed), 0.045 ether, 3003e18);
            musd.mint(address(stressed), 1000e18);
            if (round > 0) vm.roll(block.number + 21);
            uint256 keeperBefore = musd.balanceOf(keeper);
            (uint256 repaid,) = _shieldAs(keeper, stressed);
            assertEq(repaid, 753e18, "full repay to target every round");
            uint256 paid = musd.balanceOf(keeper) - keeperBefore;
            if (round < 10) {
                assertEq(paid, 5e18, "full 5 MUSD bounty while cap remains");
            } else {
                assertEq(paid, 0, "11th shield: aggregate cap exhausted, bounty 0");
            }
        }
        assertEq(stressed.totalBountyPaid(), 50e18, "lifetime total is exactly the 50 MUSD cap");
        assertEq(_icrOf(address(stressed)), 2e18, "capped-out trove still shields to target");
    }

    // ============ F9: reentrancy ============

    function test_shield_reentrancy_blocked() public {
        // shield() holds the nonReentrant lock across its external calls
        // (sMUSD withdraw, BO repay/addColl, MUSD transfer). A malicious
        // sMUSD that calls back into shield() during withdraw() must
        // revert Reentrancy — and the whole outer shield reverts with it.
        MockMUSD m9 = new MockMUSD();
        MockPriceFeed pf9 = new MockPriceFeed();
        TestTroveManager tm9 = new TestTroveManager();
        TestBorrowerOperations bo9 = new TestBorrowerOperations(m9, tm9, pf9);
        TestSortedTroves sorted9 = new TestSortedTroves();
        ReentrantSmusd evil = new ReentrantSmusd(m9);
        m9.mint(address(evil), 1000e18);
        TroveAccount impl9 = new TroveAccount(
            address(bo9), address(tm9), address(pf9), address(m9), address(evil), address(sorted9), feeRecipient, 10
        );
        TroveAccountFactory fac9 = new TroveAccountFactory(address(impl9), feeRecipient, 10);
        address a9 = fac9.createAndOpen{value: 0.03 ether}(
            bytes32(uint256(0x5BA)), _policy(), DEBT, address(0), address(0), 0
        );
        TroveAccount stressed = TroveAccount(payable(a9));
        evil.setTarget(stressed);
        stressed.sweepMusd(1999e18); // balance 1 < repayWanted + bounty = 3: withdraw path
        vm.expectRevert(TroveAccount.Reentrancy.selector);
        vm.prank(keeper);
        stressed.shield();
        assertEq(stressed.lastShieldBlock(), 0, "reverted shield advanced nothing");
    }

    // ============ F9: crash-during-cooldown (durable on-chain state) ============

    function test_crashDuringCooldown_stateSurvives() public {
        // Foundry cannot kill the chain mid-test, so this proves the
        // property a crash would exercise: the cooldown is durable
        // on-chain storage (lastShieldBlock), not memory. It still binds
        // a DIFFERENT keeper after blocks pass, a reverted attempt does
        // not move it, and a failed shield never sets it.
        address keeper2 = makeAddr("keeper2");
        TroveAccount stressed = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5BC)));
        (uint256 repaidFirst,) = _shieldAs(keeper, stressed);
        assertEq(repaidFirst, 2e18);
        uint256 shieldBlock = stressed.lastShieldBlock();
        assertEq(shieldBlock, block.number);
        // A different keeper, 10 blocks later (still inside the 20-block window).
        vm.roll(block.number + 10);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.Cooldown.selector, uint256(10)));
        vm.prank(keeper2);
        stressed.shield();
        assertEq(stressed.lastShieldBlock(), shieldBlock, "reverted attempt did not move lastShieldBlock");
        // Past the window the shield works again — from reserve BTC this time.
        vm.roll(block.number + 10);
        vm.deal(address(stressed), 0.01 ether);
        vm.prank(keeper2);
        (uint256 repaidSecond, uint256 collAddedSecond) = stressed.shield();
        assertEq(repaidSecond, 0);
        assertEq(collAddedSecond, 0.01 ether);
        // And a shield that FAILS (nothing to do) never sets lastShieldBlock.
        TroveAccount empty = _stressedAccount(0.03 ether, DEBT, bytes32(uint256(0x5BD)));
        empty.sweepMusd(2000e18);
        vm.expectRevert(TroveAccount.NothingToDo.selector);
        vm.prank(keeper);
        empty.shield();
        assertEq(empty.lastShieldBlock(), 0, "failed shield advanced nothing");
    }

    // ============ F9: FORK — shield on the live Mezo path ============
    //
    // Run with: SHIELD_FORK=1 forge test --match-test testFork_ -vv
    // (read-only fork of mainnet; NOTHING is broadcast.)
    //
    // Design: mirrors the Batcher fork test (same pinned block, same
    // addresses, same mockCall price stub — the oracle precompile cannot
    // be read on a fork, plan G3). A fresh production account opens a
    // 0.05 BTC / 2000 MUSD trove at ICR ~1.49 on the LIVE TroveManager /
    // BorrowerOperations / SortedTroves, then a stranger keeper shields
    // it. This is the only shield test that exercises the REAL repayMUSD
    // / SortedTroves hints path — every other shield test is MOCK.
    // Expected: repay 202 (live composite debt 2202, G1 cap
    // 2202 - 200 - 1800), ICR 1.49 -> ~1.64, bounty 1 MUSD.

    address internal constant FORK_BO = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
    address internal constant FORK_TM = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address internal constant FORK_PF = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;
    address internal constant FORK_MUSD = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
    address internal constant FORK_SMUSD = 0xb4D498029af77680cD1eF828b967f010d06C51CC;
    address internal constant FORK_SORTED = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;
    uint256 internal constant FORK_BLOCK = 13243357; // mainnet, read 2026-11-15
    uint256 internal constant FORK_PRICE = 65565407150000000000000; // live BTC price, read 2026-11-15

    function testFork_shieldOnLiveMezoPath() public {
        if (!vm.envOr("SHIELD_FORK", false)) {
            vm.skip(true);
        }
        vm.createSelectFork("mezo_mainnet", FORK_BLOCK);
        vm.mockCall(FORK_PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(FORK_PRICE));

        vm.deal(address(this), 100 ether);
        address forkFeeRecipient = makeAddr("forkFeeRecipient");
        TroveAccount forkImpl = new TroveAccount(
            FORK_BO, FORK_TM, FORK_PF, FORK_MUSD, FORK_SMUSD, FORK_SORTED, forkFeeRecipient, 10
        );
        TroveAccountFactory forkFactory = new TroveAccountFactory(address(forkImpl), forkFeeRecipient, 10);
        address acct = forkFactory.createAndOpen{value: 0.05 ether}(
            bytes32(uint256(0x5F0126)), _policy(), 2000e18, address(0), address(0), 0
        );
        TroveAccount forkAcct = TroveAccount(payable(acct));
        assertEq(ITM(FORK_TM).getTroveStatus(acct), 1, "trove active after open");
        uint256 icrBefore = ITM(FORK_TM).getCurrentICR(acct, FORK_PRICE);
        assertGt(icrBefore, 1.45e18, "ICR above 1.45 at stub price");
        assertLt(icrBefore, 1.52e18, "ICR below 1.52 at stub price");

        address forkKeeper = makeAddr("forkKeeper");
        vm.prank(forkKeeper);
        (uint256 repaid, uint256 collAdded) = forkAcct.shield();
        assertEq(repaid, 202e18, "live G1 cap: 2202 - 200 - 1800");
        assertEq(collAdded, 0, "no reserve BTC in the fork account");
        uint256 icrAfter = ITM(FORK_TM).getCurrentICR(acct, FORK_PRICE);
        assertGt(icrAfter, icrBefore, "shield improves ICR on the live path");
        assertEq(IERC20(FORK_MUSD).balanceOf(forkKeeper), 1e18, "stranger keeper is paid the 1 MUSD bounty");
        assertEq(forkAcct.totalBountyPaid(), 1e18);
    }
}

/// @notice SortedTroves double whose hints flip when the trove's NICR
///         crosses a threshold (F7 test): LOW hints below the threshold,
///         HIGH hints above it. The repay moves NICR across the threshold,
///         so the addColl leg must observe HIGH hints.
contract DynamicSortedTroves is ISortedTroves {
    TestTroveManager public tm;
    uint256 public thresholdNicr;
    address public lowUp;
    address public lowLo;
    address public highUp;
    address public highLo;

    constructor(
        TestTroveManager tm_,
        uint256 threshold_,
        address lowUp_,
        address lowLo_,
        address highUp_,
        address highLo_
    ) {
        tm = tm_;
        thresholdNicr = threshold_;
        lowUp = lowUp_;
        lowLo = lowLo_;
        highUp = highUp_;
        highLo = highLo_;
    }

    function _nicr(address t) internal view returns (uint256) {
        (uint256 c, uint256 p, uint256 i,,,) = tm.getEntireDebtAndColl(t);
        uint256 d = p + i;
        return d == 0 ? type(uint256).max : c * 1e20 / d;
    }

    function getLast() external pure returns (address) {
        return address(0);
    }

    function getPrev(address t) external view returns (address) {
        return _nicr(t) < thresholdNicr ? lowUp : highUp;
    }

    function getNext(address t) external view returns (address) {
        return _nicr(t) < thresholdNicr ? lowLo : highLo;
    }

    function contains(address) external pure returns (bool) {
        return true;
    }

    function findInsertPosition(uint256, address, address) external pure returns (address, address) {
        return (address(0), address(0));
    }
}

/// @notice Malicious sMUSD double (F9 reentrancy test): withdraw() pays
///         the MUSD, then calls back into the account's shield(). The
///         callback must revert Reentrancy because the outer shield()
///         still holds the lock.
contract ReentrantSmusd {
    MockMUSD public musd;
    TroveAccount public target;

    constructor(MockMUSD m) {
        musd = m;
    }

    function setTarget(TroveAccount t) external {
        target = t;
    }

    function deposit(uint256) external {}

    function withdraw(uint256 a) external {
        musd.transfer(msg.sender, a);
        target.shield();
    }

    function claimYield() external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 100_000e18;
    }

    function claimableYield(address) external pure returns (uint256) {
        return 0;
    }

    function yieldIndex() external pure returns (uint256) {
        return 0;
    }

    function supplyYieldIndex(address) external pure returns (uint256) {
        return 0;
    }
}
