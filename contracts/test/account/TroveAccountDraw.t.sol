// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {TestTroveManager, TestBorrowerOperations, TestSavings, TestSortedTroves} from "./TroveAccount.t.sol";

/// @notice Task 1.3 acceptance tests (plan section 10, row 1.3; invariants
///         section 3.12, security rules section 7.2): I1, I8, I9, I10, I11,
///         S8, S9, plus previewDraw reason codes 0-9, the EIP-1271
///         validation path, and status reporting.
/// @dev Harness mirrors TroveAccount.t.sol (same mocks, same main account:
///      owner = this test contract, 0.1 BTC collateral, 2000 MUSD debt,
///      price 100_000e18 -> ICR ~4.995e18, production policy floor 2.50 /
///      shield 1.60 / target 2.00, fee 10 bps). The `shield()` clause of I8
///      and I9 is NOT testable here: shield() is task 1.4's deliverable and
///      does not exist in this file yet (see the contract header comment);
///      the draw/drawBySig/claim/close/sweep/repay/addColl clauses are
///      proven here, and 1.4 must re-prove I8/I9 with shield() included.
contract TroveAccountDrawTest is Test {
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
    uint256 public constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

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
        musd.mint(address(smusd), 100_000e18);
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

    function _drawAs(address a, address p, uint256 amount) internal {
        vm.prank(a);
        account.draw(p, amount);
    }

    function _signIntent(uint256 pk, address a, address p, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = account.intentDigest(a, p, amount, account.intentNonce(a), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _signIntentOn(TroveAccount acct, uint256 pk, address a, address p, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = acct.intentDigest(a, p, amount, acct.intentNonce(a), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _debtOf(address b) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(b);
        return principal + interest;
    }

    // ============ I1: post-draw ICR >= floor ============

    function test_I1_successfulDrawLeavesIcrAtOrAboveFloor() public {
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        (bool ok, uint8 reason, uint256 icrAfterPreview,) = account.previewDraw(agent, payee, 100e18);
        assertTrue(ok);
        assertEq(reason, 0);
        _drawAs(agent, payee, 100e18);
        uint256 icrAfter = tm.getCurrentICR(address(account), pf.fetchPrice());
        assertEq(icrAfter, icrAfterPreview, "previewDraw icrAfter matches the real post-draw ICR");
        assertGe(icrAfter, 25e17, "I1: post-draw ICR >= floorICR");
    }

    function test_I1_successfulDrawBySigLeavesIcrAtOrAboveFloor() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 10000e18, 5000e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        (bool ok,, uint256 icrAfterPreview,) = account.previewDraw(signer, payee, 100e18);
        assertTrue(ok);
        bytes memory sig = _signIntent(pk, signer, payee, 100e18, deadline);
        account.drawBySig(signer, payee, 100e18, deadline, sig);
        uint256 icrAfter = tm.getCurrentICR(address(account), pf.fetchPrice());
        assertEq(icrAfter, icrAfterPreview, "previewDraw icrAfter matches the real post-draw ICR");
        assertGe(icrAfter, 25e17, "I1: post-drawBySig ICR >= floorICR");
    }

    function test_I1_drawBySigBreachingFloorRevertsBelowFloor() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 10000e18, 5000e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        (, uint8 reason, uint256 icrAfter,) = account.previewDraw(signer, payee, 1996e18);
        assertEq(reason, 6, "preview says BELOW_FLOOR");
        bytes memory sig = _signIntent(pk, signer, payee, 1996e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.BelowFloor.selector, icrAfter, uint256(25e17)));
        account.drawBySig(signer, payee, 1996e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0, "reverted drawBySig consumes no nonce");
    }

    // ============ I8: non-active trove freezes draws, keeps exits ============

    function test_I8_drawRevertsWhenTroveNotActive() public {
        // status 0: fresh account, never opened (live session, caps fine).
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        TroveAccount freshAcct = TroveAccount(payable(fresh));
        vm.prank(freshOwner);
        freshAcct.setSession(agent, 1000e18, 500e18, 0, uint64(block.timestamp + 7 days), true, false);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(0)));
        freshAcct.draw(payee, 10e18);

        // status 2: closed by owner.
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        account.closeAccount();
        assertEq(account.status(), 2);
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(2)));
        _drawAs(agent, payee, 10e18);

        // status 3: liquidated.
        tm.setStatus(address(account), 3);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(3)));
        _drawAs(agent, payee, 10e18);

        // status 4: redeemed.
        tm.setStatus(address(account), 4);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(4)));
        _drawAs(agent, payee, 10e18);
    }

    function test_I8_drawBySigRevertsWhenTroveNotActive() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        tm.setStatus(address(account), 3);
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(3)));
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0, "reverted drawBySig consumes no nonce");
        tm.setStatus(address(account), 4);
        sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.TroveNotActive.selector, uint8(4)));
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0);
    }

    function test_I8_claimCloseSweepsStillWorkWhenNotActive() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        // Liquidated (status 3): draws are frozen, exits are not.
        tm.setStatus(address(account), 3);
        bo.setSurplus(address(account), 0.02 ether);
        account.claimCollateral();
        assertEq(address(account).balance, 0.02 ether, "surplus BTC lands in the account");
        account.sweepBtc(0.02 ether);
        assertEq(address(account).balance, 0);
        uint256 ownerMusdBefore = musd.balanceOf(owner);
        account.closeAccount(); // status 3: no trove to close, sweeps everything
        assertEq(musd.balanceOf(owner) - ownerMusdBefore, 2000e18, "all MUSD swept to the owner");
        assertEq(musd.balanceOf(address(account)), 0);

        // Redeemed (status 4): same exits work.
        tm.setStatus(address(account), 4);
        bo.setSurplus(address(account), 0.03 ether);
        account.claimCollateral();
        account.sweepBtc(0.03 ether);
        assertEq(address(account).balance, 0);
    }

    // ============ I9: Recovery Mode blocks draws, allows repay/addColl ============

    function test_I9_drawRevertsRecoveryModeBeforeMezo() public {
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        tm.setRecoveryMode(address(account), true);
        uint256 debtBefore = _debtOf(address(account));
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(3e18)));
        _drawAs(agent, payee, 10e18);
        assertEq(_debtOf(address(account)), debtBefore, "no Mezo borrow happened");
        assertEq(musd.balanceOf(payee), 0, "payee received nothing");
        // The gate is the RM check, not a broken session: RM off -> same draw works.
        tm.setRecoveryMode(address(account), false);
        _drawAs(agent, payee, 10e18);
        assertEq(musd.balanceOf(payee), 10e18);
    }

    function test_I9_drawBySigRevertsRecoveryMode() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        tm.setRecoveryMode(address(account), true);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(3e18)));
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0, "RM-reverted drawBySig consumes no nonce");
    }

    function test_I9_repayAndAddCollSucceedInRecoveryMode() public {
        tm.setRecoveryMode(address(account), true);
        account.repay(100e18, address(0), address(0));
        assertEq(_debtOf(address(account)), 1902e18, "repay works in Recovery Mode");
        account.addColl{value: 0.01 ether}(address(0), address(0));
        (uint256 coll,,,,,) = tm.getEntireDebtAndColl(address(account));
        assertEq(coll, COLL + 0.01 ether, "addColl works in Recovery Mode");
        // And the draw gate is still up while RM lasts.
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(3e18)));
        _drawAs(agent, payee, 10e18);
    }

    // ============ I10: fee = ceil(amount * feeBps / 10000), cap 50 bps ============

    function test_I10_feeFormulaAcrossAmounts() public {
        _setSession(agent, 100000e18, 50000e18, 0, true, false);
        uint256[6] memory amounts = [uint256(1), 9999, 10000, 10001, 123456789, 100e18];
        for (uint256 i; i < amounts.length; i++) {
            uint256 amount = amounts[i];
            uint256 expected = (amount * 10 + 9_999) / 10_000;
            (,,, uint256 fee) = account.previewDraw(agent, payee, amount);
            assertEq(fee, expected, "previewDraw fee is ceil(amount * 10 / 10000)");
            uint256 feeBefore = musd.balanceOf(feeRecipient);
            uint256 payeeBefore = musd.balanceOf(payee);
            _drawAs(agent, payee, amount);
            assertEq(musd.balanceOf(feeRecipient) - feeBefore, expected, "draw pays exactly the fee");
            assertEq(musd.balanceOf(payee) - payeeBefore, amount, "payee receives exactly amount");
        }
    }

    function test_I10_feeNeverExceedsHalfPercentPlusOneWei() public {
        // Max-fee deployment: feeBps = 50 (the cap). 51 reverts at
        // construction (proven in TroveAccount.t.sol, test_F2_*).
        TroveAccount impl50 = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 50
        );
        TroveAccountFactory factory50 = new TroveAccountFactory(address(impl50), feeRecipient, 50);
        address a = factory50.createAndOpen{value: COLL}(bytes32(uint256(0xF1F1)), _policy(), DEBT, address(0), address(0), 0);
        TroveAccount acct50 = TroveAccount(payable(a));
        acct50.setSession(agent, 10000e18, 5000e18, 0, uint64(block.timestamp + 7 days), true, false);
        uint256 amount = 100e18;
        (,,, uint256 fee) = acct50.previewDraw(agent, payee, amount);
        assertEq(fee, 0.5e18, "50 bps of 100 MUSD is 0.5 MUSD");
        assertLe(fee, amount / 200 + 1, "I10: fee <= 0.5% of amount + 1 wei");
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        vm.prank(agent);
        acct50.draw(payee, amount);
        assertEq(musd.balanceOf(feeRecipient) - feeBefore, 0.5e18);
        // The 1-wei rounding case at max fee: ceil(1 * 50 / 10000) = 1 wei.
        (,,, fee) = acct50.previewDraw(agent, payee, 1);
        assertEq(fee, 1, "ceil(1 wei * 50 / 10000) = 1 wei, still <= 0.5% + 1 wei");
    }

    function test_I10_feeOnDrawBySig() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        uint256 feeBefore = musd.balanceOf(feeRecipient);
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(musd.balanceOf(feeRecipient) - feeBefore, 0.05e18, "drawBySig pays the same 10 bps fee");
        assertEq(musd.balanceOf(payee), 50e18, "payee receives exactly amount");
    }

    function test_I10_feeRecipientImmutable() public {
        assertEq(account.feeRecipient(), feeRecipient);
        assertEq(account.feeBps(), 10);
        // No setter exists: the only fee values a clone can carry are the
        // implementation immutables the Factory passed at creation (F2).
        TroveAccount impl50 = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 50
        );
        assertEq(impl50.feeBps(), 50);
        assertEq(impl50.feeRecipient(), feeRecipient);
    }

    // ============ I11: per-agent nonce, exactly +1, no replay, no interference ============

    function test_I11_nonceIncrementsExactlyOncePerAcceptedIntent() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(pk, signer, payee, 50e18, deadline);
        account.drawBySig(signer, payee, 50e18, deadline, sig1);
        assertEq(account.intentNonce(signer), 1);
        bytes memory sig2 = _signIntent(pk, signer, payee, 50e18, deadline);
        account.drawBySig(signer, payee, 50e18, deadline, sig2);
        assertEq(account.intentNonce(signer), 2, "exactly +1 per accepted intent");
        assertEq(musd.balanceOf(payee), 100e18);
    }

    function test_I11_failedDrawBySigDoesNotConsumeNonce() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        // Absolute deadline (block.timestamp starts at 1): do NOT derive it
        // from block.timestamp and reuse it across a warp — under via-IR the
        // optimizer rematerializes the timestamp-derived local after
        // vm.warp, so `deadline` would read as the NEW timestamp + 10 min
        // (observed: 601 -> 1202 after warp(602)). Test-only quirk.
        uint256 deadline = 601;
        // Expired intent.
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(TroveAccount.Expired.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0);
        // Wrong signer.
        vm.warp(deadline); // back inside the deadline window (601 !> 601)
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(agent2, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 0);
        // Valid sig but the draw itself fails (over per-tx): nonce untouched.
        bytes memory bigSig = _signIntent(pk, signer, payee, 600e18, deadline);
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccount.OverPerTx.selector, uint256(6006e17), uint256(500e18))
        );
        account.drawBySig(signer, payee, 600e18, deadline, bigSig);
        assertEq(account.intentNonce(signer), 0);
        // The original intent still works afterwards: nothing was consumed.
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 1);
    }

    function test_I11_twoAgentsIntentsNeverInterfere() public {
        uint256 pkA = 0xA11CE;
        uint256 pkB = 0xB11CE;
        address signerA = vm.addr(pkA);
        address signerB = vm.addr(pkB);
        _setSession(signerA, 1000e18, 500e18, 0, true, false);
        _setSession(signerB, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sigA = _signIntent(pkA, signerA, payee, 50e18, deadline);
        bytes memory sigB = _signIntent(pkB, signerB, payee, 70e18, deadline);
        account.drawBySig(signerA, payee, 50e18, deadline, sigA);
        assertEq(account.intentNonce(signerA), 1);
        assertEq(account.intentNonce(signerB), 0, "B's nonce untouched by A's intent");
        account.drawBySig(signerB, payee, 70e18, deadline, sigB);
        assertEq(account.intentNonce(signerB), 1);
        assertEq(account.intentNonce(signerA), 1, "A's nonce untouched by B's intent");
        // A's second intent (nonce 1) and B's replay (nonce 0, spent) behave independently.
        bytes memory sigA2 = _signIntent(pkA, signerA, payee, 50e18, deadline);
        account.drawBySig(signerA, payee, 50e18, deadline, sigA2);
        assertEq(account.intentNonce(signerA), 2);
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signerB, payee, 70e18, deadline, sigB);
        assertEq(account.intentNonce(signerB), 1, "B's replay consumed nothing");
    }

    // ============ S8: no replay across accounts or chains ============

    function test_S8_signatureCannotReplayAcrossAccounts() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        // Second account, same owner, same agent session, different address.
        address b = factory.createAndOpen{value: COLL}(bytes32(uint256(0xB00B)), _policy(), DEBT, address(0), address(0), 0);
        TroveAccount accountB = TroveAccount(payable(b));
        accountB.setSession(signer, 1000e18, 500e18, 0, uint64(block.timestamp + 7 days), true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        // Intent signed for account A must fail on account B (domain binds
        // verifyingContract), even though the session is live on B.
        bytes memory sigA = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.expectRevert(TroveAccount.BadSig.selector);
        accountB.drawBySig(signer, payee, 50e18, deadline, sigA);
        assertEq(accountB.intentNonce(signer), 0);
        // A fresh intent signed for B works.
        bytes memory sigB = _signIntentOn(accountB, pk, signer, payee, 50e18, deadline);
        accountB.drawBySig(signer, payee, 50e18, deadline, sigB);
        assertEq(accountB.intentNonce(signer), 1);
        assertEq(account.intentNonce(signer), 0, "A's nonce untouched by B's intent");
    }

    function test_S8_signatureCannotReplayAcrossChains() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 dsBefore = account.domainSeparator();
        bytes memory sig = _signIntent(pk, signer, payee, 50e18, deadline);
        // Same chain, same account: works.
        account.drawBySig(signer, payee, 50e18, deadline, sig);
        assertEq(account.intentNonce(signer), 1);
        // Move to another chain: the old domain no longer matches.
        vm.chainId(31611);
        assertTrue(account.domainSeparator() != dsBefore, "domain separator binds chainId");
        bytes memory sig2 = _signIntent(pk, signer, payee, 50e18, deadline);
        // sig2 was signed over the NEW chain's digest, so it must work there.
        account.drawBySig(signer, payee, 50e18, deadline, sig2);
        assertEq(account.intentNonce(signer), 2);
        // But an intent signed on the OLD chain must fail on the new one.
        vm.chainId(31337);
        bytes memory sigOldChain = _signIntent(pk, signer, payee, 50e18, deadline);
        vm.chainId(31611);
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sigOldChain);
        assertEq(account.intentNonce(signer), 2);
        vm.chainId(31337); // restore the default chain for later tests
    }

    function test_S8_domainSeparatorBindsChainAndAccount() public {
        address b = factory.createAndOpen{value: COLL}(bytes32(uint256(0xB00B)), _policy(), DEBT, address(0), address(0), 0);
        TroveAccount accountB = TroveAccount(payable(b));
        assertTrue(account.domainSeparator() != accountB.domainSeparator(), "domain binds verifyingContract");
        bytes32 ds = account.domainSeparator();
        vm.chainId(31612);
        assertTrue(account.domainSeparator() != ds, "domain binds chainId");
        vm.chainId(31337);
        assertEq(account.domainSeparator(), ds, "domain is deterministic per (chainId, account)");
    }

    // ============ S9: signature malleability rejected ============

    function test_S9_highSRejected() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 d = account.intentDigest(signer, payee, 50e18, account.intentNonce(signer), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        assertLe(uint256(s), account.LOW_S_MAX(), "vm.sign produces a low-s signature");
        // Malleated twin: s' = n - s, v flipped. Raw ecrecover still returns
        // the signer, but the contract must reject it as high-s.
        bytes32 sHigh = bytes32(SECP256K1_N - uint256(s));
        uint8 vFlip = v == 27 ? 28 : 27;
        assertEq(ecrecover(d, vFlip, r, sHigh), signer, "malleated twin recovers the signer under raw ecrecover");
        bytes memory sigHigh = abi.encodePacked(r, sHigh, vFlip);
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sigHigh);
        assertEq(account.intentNonce(signer), 0, "high-s attempt consumed no nonce");
        // Same rejection on the EIP-1271 path.
        bytes32 h = keccak256("x402 payload");
        (v, r, s) = vm.sign(pk, h);
        bytes memory sigHigh1271 = abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? 28 : 27);
        assertEq(account.isValidSignature(h, sigHigh1271), bytes4(0xffffffff), "high-s rejected by isValidSignature");
    }

    function test_S9_badVRejected() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 d = account.intentDigest(signer, payee, 50e18, account.intentNonce(signer), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        for (uint8 badV = 0; badV < 2; badV++) {
            uint8 vv = badV == 0 ? 0 : 29;
            bytes memory sigBadV = abi.encodePacked(r, s, vv);
            vm.expectRevert(TroveAccount.BadSig.selector);
            account.drawBySig(signer, payee, 50e18, deadline, sigBadV);
        }
        assertEq(account.intentNonce(signer), 0);
        // EIP-1271 path: v = 0 and v = 29 both invalid; v = 27 valid.
        bytes32 h = keccak256("x402 payload");
        (v, r, s) = vm.sign(pk, h);
        assertEq(account.isValidSignature(h, abi.encodePacked(r, s, v)), bytes4(0x1626ba7e), "v=27 valid");
        assertEq(account.isValidSignature(h, abi.encodePacked(r, s, uint8(0))), bytes4(0xffffffff), "v=0 invalid");
        assertEq(account.isValidSignature(h, abi.encodePacked(r, s, uint8(29))), bytes4(0xffffffff), "v=29 invalid");
    }

    function test_S9_zeroAddressRecoveryRejected() public {
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        uint256 deadline = block.timestamp + 10 minutes;
        // r = 0, s = 0: ecrecover returns address(0).
        assertEq(ecrecover(bytes32(0), 27, bytes32(0), bytes32(0)), address(0), "sanity: degenerate sig recovers zero");
        bytes memory sigZero = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sigZero);
        assertEq(account.intentNonce(signer), 0);
        bytes32 h = keccak256("x402 payload");
        assertEq(account.isValidSignature(h, sigZero), bytes4(0xffffffff), "zero recovery rejected by isValidSignature");
        // Short signature (64 bytes) is rejected on both paths.
        bytes memory sigShort = new bytes(64);
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, 50e18, deadline, sigShort);
        assertEq(account.isValidSignature(h, sigShort), bytes4(0xffffffff));
    }

    // ============ previewDraw: all reason codes 0-9 ============

    function test_previewDrawAllReasonCodes() public {
        // 0 OK.
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        (bool ok, uint8 reason,,) = account.previewDraw(agent, payee, 100e18);
        assertTrue(ok);
        assertEq(reason, 0, "0 OK");
        // 9 ZERO_AMOUNT.
        (ok, reason,,) = account.previewDraw(agent, payee, 0);
        assertFalse(ok);
        assertEq(reason, 9, "9 ZERO_AMOUNT");
        // 1 SESSION_INACTIVE (agent2 has no session).
        (ok, reason,,) = account.previewDraw(agent2, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 1, "1 SESSION_INACTIVE");
        // 2 PAYEE_NOT_ALLOWED.
        _setSession(agent, 1000e18, 500e18, 0, false, false);
        (ok, reason,,) = account.previewDraw(agent, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 2, "2 PAYEE_NOT_ALLOWED");
        // 3 OVER_PER_TX (gross 600.6 > perTx 500).
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        (ok, reason,,) = account.previewDraw(agent, payee, 600e18);
        assertFalse(ok);
        assertEq(reason, 3, "3 OVER_PER_TX");
        // 4 OVER_BUDGET (gross 100.1 > budget 50, perTx 1000).
        _setSession(agent, 50e18, 1000e18, 0, true, false);
        (ok, reason,,) = account.previewDraw(agent, payee, 100e18);
        assertFalse(ok);
        assertEq(reason, 4, "4 OVER_BUDGET");
        // 5 OVER_DAILY (gross 100.1 > daily 50, budget/perTx large).
        _setSession(agent, 1000e18, 1000e18, 50e18, true, false);
        (ok, reason,,) = account.previewDraw(agent, payee, 100e18);
        assertFalse(ok);
        assertEq(reason, 5, "5 OVER_DAILY");
        // 6 BELOW_FLOOR.
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        uint256 icrAfter;
        (ok, reason, icrAfter,) = account.previewDraw(agent, payee, 1996e18);
        assertFalse(ok);
        assertEq(reason, 6, "6 BELOW_FLOOR");
        assertLt(icrAfter, 25e17);
        // 7 RECOVERY_MODE.
        tm.setRecoveryMode(address(account), true);
        (ok, reason,,) = account.previewDraw(agent, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 7, "7 RECOVERY_MODE");
        tm.setRecoveryMode(address(account), false);
        // 8 TROVE_NOT_ACTIVE.
        tm.setStatus(address(account), 3);
        (ok, reason,,) = account.previewDraw(agent, payee, 10e18);
        assertFalse(ok);
        assertEq(reason, 8, "8 TROVE_NOT_ACTIVE");
        tm.setStatus(address(account), 1);
        // Back to OK after restoring state.
        (ok, reason,,) = account.previewDraw(agent, payee, 10e18);
        assertTrue(ok);
        assertEq(reason, 0);
    }

    function test_previewDrawMatchesRealDrawIcr() public {
        // previewDraw reads getEntireDebtAndColl ONCE (pending already
        // folded into its first three returns by the TroveManager) and must
        // agree with the real post-draw ICR.
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        (bool ok,, uint256 icrPreview,) = account.previewDraw(agent, payee, 100e18);
        assertTrue(ok);
        _drawAs(agent, payee, 100e18);
        assertEq(tm.getCurrentICR(address(account), pf.fetchPrice()), icrPreview, "preview == real ICR after draw");
    }

    // ============ EIP-1271 validation path ============

    function test_EIP1271_validSignatureForLiveX402Session() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        assertEq(account.isValidSignature(h, abi.encodePacked(r, s, v)), bytes4(0x1626ba7e));
    }

    function test_EIP1271_expiredSessionReturnsInvalid() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        account.setSession(signer, 1000e18, 500e18, 0, uint64(block.timestamp + 1 hours), true, true);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(h, sig), bytes4(0x1626ba7e), "live session validates");
        vm.warp(block.timestamp + 2 hours);
        assertEq(account.isValidSignature(h, sig), bytes4(0xffffffff), "expired session invalid");
    }

    function test_EIP1271_wrongHashReturnsInvalid() public {
        uint256 pk = 0xBEEF;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(account.isValidSignature(h, sig), bytes4(0x1626ba7e));
        assertEq(
            account.isValidSignature(keccak256("a different payload"), sig),
            bytes4(0xffffffff),
            "same sig, different hash -> invalid"
        );
    }

    function test_EIP1271_nonSessionSignerReturnsInvalid() public {
        uint256 pk = 0xDEAD;
        address stranger = vm.addr(pk);
        bytes32 h = keccak256("x402 payload");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        assertEq(account.isValidSignature(h, abi.encodePacked(r, s, v)), bytes4(0xffffffff), "no session -> invalid");
    }

    // ============ Status reporting ============

    function test_statusReportsAllEnumValues() public {
        address freshOwner = makeAddr("freshOwner");
        vm.deal(freshOwner, 10 ether);
        address fresh = factory.createAccount(freshOwner, bytes32(uint256(0xF12E5)), _policy());
        TroveAccount freshAcct = TroveAccount(payable(fresh));
        assertEq(freshAcct.status(), 0, "0 none");
        assertEq(account.status(), 1, "1 active");
        tm.setStatus(address(account), 2);
        assertEq(account.status(), 2, "2 closedByOwner");
        tm.setStatus(address(account), 3);
        assertEq(account.status(), 3, "3 closedByLiquidation");
        tm.setStatus(address(account), 4);
        assertEq(account.status(), 4, "4 closedByRedemption");
    }
}
