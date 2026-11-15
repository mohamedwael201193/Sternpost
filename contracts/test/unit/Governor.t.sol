// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

contract GovernorUnitTest is MockBase {
    function test_safeDraw_paysPayee_andArmsStandby() public {
        _draw(100e18);
        assertEq(musd.balanceOf(payee), 100e18);
        assertEq(g.remainingBudget(app), 900e18);
        (uint256 amt,, uint256 n, bool live) = g.standby();
        assertEq(amt, 100e18); assertEq(n, 1); assertTrue(live);
        assertGe(g.icr(), g.floorICR());
    }

    function test_unsafeDraw_revertsBelowFloor() public {
        uint256 n = 0; uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        // 0.1 BTC * 100k = 10k coll; floor 3.0 => max debt ~3333; drawing 400 => 2400.4 debt ok; push price down
        pf.set(65_000e18); // ICR now 3.25; draw 400 -> 6500/2400.4 = 2.70 < 3
        vm.prank(app);
        vm.expectPartialRevert(SternpostGovernor.Unsafe.selector);
        g.draw(400e18, payee, dl, _w(400e18, address(g), n, dl), hdl, _r(400e18, n + 1, hdl));
        assertEq(sigs.getNonce(borrower), 0, "nonce untouched on refusal");
    }

    function test_preview_matchesOutcome() public {
        (bool ok, string memory why, uint256 icrAfter) = g.previewDraw(app, 100e18, payee);
        assertTrue(ok); assertEq(bytes(why).length, 0);
        _draw(100e18);
        assertEq(icrAfter, g.icr(), "projected == realised");
        pf.set(65_000e18);
        (ok, why,) = g.previewDraw(app, 400e18, payee);
        assertFalse(ok); assertEq(why, "BELOW_FLOOR");
        (ok, why,) = g.previewDraw(address(0x1234), 1e18, payee);
        assertEq(why, "APP_NOT_AUTHORIZED");
        (ok, why,) = g.previewDraw(app, 401e18, payee);
        assertEq(why, "OVER_PER_DRAW");
        (ok, why,) = g.previewDraw(app, 0, payee);
        assertEq(why, "ZERO_AMOUNT");
    }

    function test_directNativeSubmission_isBlocked() public {
        uint256 dl = block.timestamp + 60; bytes memory w = _w(100e18, address(g), 0, dl);
        vm.prank(attacker);
        vm.expectRevert(SternpostGovernor.BypassBlocked.selector);
        sigs.withdrawMUSDWithSignature(100e18, address(0), address(0), borrower, address(g), w, dl);
        assertEq(tm.debt(borrower), 2_000e18); assertEq(sigs.getNonce(borrower), 0);
    }

    function test_receive_rejectsWrongCallerOrValue() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker); (bool ok,) = address(g).call(""); assertFalse(ok);
        vm.prank(address(ap)); (ok,) = address(g).call(""); assertFalse(ok, "ap outside draw");
        vm.prank(attacker); (ok,) = address(g).call{value: 1}(""); assertFalse(ok);
    }

    function test_callbackRemoved_failsClosed_andHealRecovers() public {
        ap.setCallback(false); // simulate an upstream Mezo upgrade that drops the zero-value callback
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        vm.prank(app);
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.CallbackMismatch.selector, uint8(0)));
        g.draw(100e18, payee, dl, _w(100e18, address(g), 0, dl), hdl, _r(100e18, 1, hdl));
        // a leaked signature now lands as excess, never releasable, and heal() repays it
        vm.prank(attacker); sigs.withdrawMUSDWithSignature(100e18, address(0), address(0), borrower, address(g), _w(100e18, address(g), 0, dl), dl);
        assertEq(g.excess(), 100e18);
        vm.prank(borrower); vm.expectRevert(SternpostGovernor.NoExcess.selector); g.withdrawBuffer(100e18 + 1);
        vm.prank(attacker); g.heal(100e18, hdl, _r(100e18, 1, hdl));
        assertEq(g.excess(), 0); assertEq(tm.debt(borrower), 2_000e18 + 0.1e18, "only fee remains");
        assertEq(musd.balanceOf(attacker), 0);
    }

    function test_heal_withoutExcess_noSideEffect() public {
        vm.prank(attacker); vm.expectRevert(SternpostGovernor.NoExcess.selector); g.heal(1, block.timestamp + 1, _r(1, 0, block.timestamp + 1));
        assertEq(g.buffer(), 100e18);
    }

    function test_draw_requiresMatchingHeal() public {
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days; bytes memory w = _w(10e18, address(g), 0, dl);
        vm.startPrank(app);
        vm.expectRevert(SternpostGovernor.BadHeal.selector); g.draw(10e18, payee, dl, w, hdl, _r(9e18, 1, hdl));
        vm.expectRevert(SternpostGovernor.BadHeal.selector); g.draw(10e18, payee, dl, w, hdl, _r(10e18, 0, hdl));
        vm.expectRevert(SternpostGovernor.BadHeal.selector); g.draw(10e18, payee, dl, w, block.timestamp - 1, _r(10e18, 1, block.timestamp - 1));
        vm.expectRevert(SternpostGovernor.BadHeal.selector); g.draw(10e18, payee, dl, w, hdl, hex"00");
        vm.stopPrank();
    }

    function test_windowTooLong() public {
        uint256 dl = block.timestamp + 121;
        vm.prank(app); vm.expectRevert(SternpostGovernor.WindowTooLong.selector);
        g.draw(1e18, payee, dl, _w(1e18, address(g), 0, dl), dl, _r(1e18, 1, dl));
    }

    function test_budgets_perDraw_expiry_payee() public {
        uint256 dl = block.timestamp + 60;
        vm.prank(address(0x99)); vm.expectRevert(SternpostGovernor.AppNotAuthorized.selector); g.draw(1, payee, dl, "", 0, "");
        vm.prank(app); vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.OverPerDraw.selector, 401e18, 400e18)); g.draw(401e18, payee, dl, "", 0, "");
        _draw(400e18); _draw(400e18);
        vm.prank(app); vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.OverBudget.selector, 300e18, 200e18)); g.draw(300e18, payee, dl, "", 0, "");
        vm.prank(borrower); g.authorizeApp(app, 10e18, 10e18, uint64(block.timestamp + 1 days), address(0xCAFE));
        vm.prank(app); vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.PayeeNotAllowed.selector, payee)); g.draw(1e18, payee, dl, "", 0, "");
        vm.warp(block.timestamp + 2 days);
        vm.prank(app); vm.expectRevert(SternpostGovernor.AppExpired.selector); g.draw(1e18, address(0xCAFE), block.timestamp + 1, "", 0, "");
        vm.prank(borrower); g.removeApp(app);
        vm.prank(app); vm.expectRevert(SternpostGovernor.AppNotAuthorized.selector); g.draw(1e18, address(0xCAFE), block.timestamp + 1, "", 0, "");
    }

    function test_onlyBorrower_controls() public {
        vm.startPrank(attacker);
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.setPolicy(4e18, 2e18);
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.authorizeApp(attacker, 1, 1, uint64(block.timestamp + 1), address(0));
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.revoke(0, "");
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.unfreeze();
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.withdrawBuffer(1);
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector); g.parkReserve(1);
        vm.stopPrank();
    }

    function test_badPolicies() public {
        vm.startPrank(borrower);
        vm.expectRevert(SternpostGovernor.BadPolicy.selector); g.setPolicy(2e18, 2e18);
        vm.expectRevert(SternpostGovernor.BadPolicy.selector); g.setPolicy(3e18, 1e18);
        vm.expectRevert(SternpostGovernor.BadPolicy.selector); g.authorizeApp(app, 1, 2, uint64(block.timestamp + 1), address(0));
        vm.expectRevert(SternpostGovernor.BadPolicy.selector); g.authorizeApp(app, 1, 1, uint64(block.timestamp), address(0));
        g.setPolicy(4e18, 2e18); assertEq(g.floorICR(), 4e18);
        vm.stopPrank();
    }

    function test_revoke_withNonceBurn_killsOutstandingSignature() public {
        uint256 dl = block.timestamp + 60; bytes memory w = _w(50e18, address(g), 0, dl);
        vm.prank(borrower); g.revoke{value: 1}(dl, _ac(1, 0, dl));
        assertTrue(g.frozen()); assertEq(sigs.getNonce(borrower), 1);
        vm.prank(app); vm.expectRevert(SternpostGovernor.IsFrozen.selector); g.draw(50e18, payee, dl, w, dl, w);
        vm.prank(attacker); vm.expectRevert(); sigs.withdrawMUSDWithSignature(50e18, address(0), address(0), borrower, address(g), w, dl);
        vm.prank(borrower); g.unfreeze(); assertFalse(g.frozen());
    }

    function test_nonceBurn_disarmsStandby_rearmRestores() public {
        _draw(100e18);
        (,,, bool live) = g.standby(); assertTrue(live);
        uint256 dl = block.timestamp + 60;
        vm.prank(borrower); sigs.addCollWithSignature{value: 1}(address(0), address(0), borrower, _ac(1, 1, dl), dl);
        (,,, live) = g.standby(); assertFalse(live, "nonce burn disarms standby");
        g.rearm(100e18, block.timestamp + 1 days, _r(100e18, 2, block.timestamp + 1 days));
        (,,, live) = g.standby(); assertTrue(live);
        vm.expectRevert(SternpostGovernor.BadHeal.selector); g.rearm(100e18, block.timestamp + 1 days, _r(100e18, 1, block.timestamp + 1 days));
    }

    function test_defend_repaysWhenStressed() public {
        _draw(100e18);
        vm.expectPartialRevert(SternpostGovernor.NotStressed.selector); g.defend();
        pf.set(30_000e18); // ICR 3000/2100.1 = 1.43 < 1.5
        uint256 before = g.icr();
        vm.prank(attacker); g.defend();
        assertGt(g.icr(), before); assertTrue(g.frozen()); assertEq(g.buffer(), 0);
        vm.expectRevert(); g.defend();
    }

    function test_defend_unparksReserve() public {
        _draw(100e18);
        vm.prank(borrower); g.parkReserve(100e18);
        assertEq(sav.balanceOf(address(g)), 100e18); assertEq(g.excess(), 0);
        pf.set(30_000e18);
        g.defend();
        assertEq(g.parked(), 0); assertEq(sav.balanceOf(address(g)), 0);
    }

    function test_reserve_parkUnparkWithdraw() public {
        vm.startPrank(borrower);
        g.parkReserve(60e18); assertEq(g.parked(), 60e18);
        vm.expectRevert(SternpostGovernor.NoExcess.selector); g.withdrawBuffer(41e18);
        g.unparkReserve(60e18); g.withdrawBuffer(100e18);
        assertEq(musd.balanceOf(borrower), 200e18);
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector); g.parkReserve(1);
        vm.stopPrank();
    }

    function test_twoApps_sameNonce_onlyOneSucceeds() public {
        address app2 = address(0xA22);
        vm.prank(borrower); g.authorizeApp(app2, 100e18, 100e18, uint64(block.timestamp + 1 days), address(0));
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        bytes memory w1 = _w(10e18, address(g), 0, dl); bytes memory w2 = _w(20e18, address(g), 0, dl);
        vm.prank(app); g.draw(10e18, payee, dl, w1, hdl, _r(10e18, 1, hdl));
        vm.prank(app2); vm.expectRevert(SternpostGovernor.BadHeal.selector); g.draw(20e18, payee, dl, w2, hdl, _r(20e18, 1, hdl));
        vm.prank(app2); vm.expectRevert(); g.draw(20e18, payee, dl, w2, hdl, _r(20e18, 2, hdl)); // stale withdraw nonce
        assertEq(g.remainingBudget(app2), 100e18, "failed draw does not spend budget");
    }

    function test_fund_zero_reverts() public {
        vm.prank(borrower); vm.expectRevert(SternpostGovernor.ZeroAmount.selector); g.fund(0);
    }

    function test_factory_predicts_andRejectsDuplicate() public {
        assertEq(factory.governorOf(borrower), address(g));
        assertEq(factory.predictGovernor(borrower, 3e18, 1.5e18), address(g));
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostFactory.AlreadyCreated.selector, address(g))); factory.createGovernor(3e18, 1.5e18);
    }

    function test_constructor_rejectsFloorBelowMCR() public {
        vm.prank(address(0x777)); vm.expectRevert(SternpostGovernor.BadPolicy.selector); factory.createGovernor(1.2e18, 1.05e18);
    }

    // --- Phase 0 chain (0.1): previewDraw must not double-count pending redistribution ---
    function test_preview_matches_icr_with_pending() public {
        // Pending already folded in by getEntireDebtAndColl: coll 0.1+0.01, debt 2000+100+5.
        tm.setPending(borrower, 0.01e18, 100e18, 5e18);
        assertEq(g.projectedICR(0), g.icr(), "projected(0) == icr with non-zero pending");
        (bool ok, string memory why, uint256 icrAfter) = g.previewDraw(app, 100e18, payee);
        assertTrue(ok); assertEq(bytes(why).length, 0);
        _draw(100e18);
        assertEq(icrAfter, g.icr(), "projected == realised with pending");
    }

    // --- Phase 0 chain (0.3): Recovery Mode and trove status ---
    function test_draw_revertsInRecoveryMode() public {
        tm.setTCR(1.4e18);
        (bool ok, string memory why,) = g.previewDraw(app, 10e18, payee);
        assertFalse(ok); assertEq(why, "RECOVERY_MODE");
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        vm.prank(app);
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.RecoveryMode.selector, 1.4e18));
        g.draw(10e18, payee, dl, _w(10e18, address(g), 0, dl), hdl, _r(10e18, 1, hdl));
        assertEq(sigs.getNonce(borrower), 0, "nonce untouched in Recovery Mode");
        assertEq(g.remainingBudget(app), 1_000e18, "budget untouched in Recovery Mode");
        tm.setTCR(2.5e18);
        _draw(10e18); // draws work again once the system recovers
        assertEq(musd.balanceOf(payee), 10e18);
    }

    function test_draw_revertsWhenTroveRedeemed() public {
        tm.setStatus(borrower, 4); // closedByRedemption: getCurrentICR would still look healthy
        (bool ok, string memory why,) = g.previewDraw(app, 10e18, payee);
        assertFalse(ok); assertEq(why, "TROVE_CLOSED");
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        vm.prank(app);
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.TroveNotActive.selector, uint8(4)));
        g.draw(10e18, payee, dl, _w(10e18, address(g), 0, dl), hdl, _r(10e18, 1, hdl));
        assertEq(sigs.getNonce(borrower), 0);
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.TroveNotActive.selector, uint8(4)));
        g.defend();
        tm.setStatus(borrower, 1);
        _draw(10e18); // active again
    }

    function test_checkpoint_emitsHealthChecked() public {
        vm.expectEmit(false, false, false, true, address(g));
        emit SternpostGovernor.HealthChecked(5e18, 2.5e18, false, 1);
        g.checkpoint();
        tm.setTCR(1.4e18);
        vm.expectEmit(false, false, false, true, address(g));
        emit SternpostGovernor.HealthChecked(5e18, 1.4e18, true, 1);
        g.checkpoint();
    }

    // --- Phase 0 chain (0.2): defend clamp + rearm no-shrink ---
    function test_defend_clampsAfterPartialRedemption() public {
        _draw(100e18); // standby 100 (sig for 100), buffer 100, debt 2100.1
        tm.subDebt(borrower, 1900e18); // partial redemption: debt 200.1, only 0.1 above gas comp
        pf.set(3_000e18); // ICR 0.1*3000/200.1 = 1.499 < defend 1.5
        // The clamped repay (0.1) is smaller than the signed standby (100). Mezo's RepayMUSD
        // signature binds the amount, so the stored signature cannot authorise it: defend() fails
        // closed with a named error instead of an opaque Mezo revert.
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.StandbyShortfall.selector, 0.1e18, 100e18));
        g.defend();
        assertEq(g.buffer(), 100e18, "failed defend leaves the buffer untouched");
        // Re-arm for exactly the repayable amount, then the clamped defend executes.
        uint256 dl = block.timestamp + 1 days;
        vm.prank(borrower);
        g.rearm(0.1e18, dl, _r(0.1e18, 1, dl));
        g.defend();
        assertTrue(g.frozen());
        assertEq(g.buffer(), 100e18 - 0.1e18);
        assertEq(tm.debt(borrower), 200e18);
    }

    function test_defend_bufferSmallerThanStandby() public {
        _draw(100e18); // standby 100, buffer 100, debt 2100.1
        vm.prank(borrower); g.withdrawBuffer(70e18); // buffer 30
        pf.set(30_000e18); // ICR 3000/2100.1 = 1.428 < 1.5
        // Old code did `buffer -= s.amount` here and panicked (0x11) exactly when the guard was needed.
        vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.StandbyShortfall.selector, 30e18, 100e18));
        g.defend();
        assertEq(g.buffer(), 30e18, "no underflow: buffer intact after the refused defend");
        uint256 dl = block.timestamp + 1 days;
        vm.prank(borrower);
        g.rearm(30e18, dl, _r(30e18, 1, dl));
        g.defend();
        assertTrue(g.frozen());
        assertEq(g.buffer(), 0);
        assertEq(tm.debt(borrower), 2_070.1e18);
    }

    function test_rearm_shrinkOnlyBorrower() public {
        _draw(100e18); // standby 100 at nonce 1
        uint256 dl = block.timestamp + 1 days;
        // A stranger cannot shrink the standby with a smaller valid signature.
        vm.prank(attacker);
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector);
        g.rearm(50e18, dl, _r(50e18, 1, dl));
        // The borrower can shrink it, and anyone may re-arm the same or a larger amount.
        vm.prank(borrower);
        g.rearm(50e18, dl, _r(50e18, 1, dl));
        (uint256 amt,,, bool live) = g.standby();
        assertEq(amt, 50e18); assertTrue(live);
        vm.prank(attacker);
        g.rearm(100e18, dl, _r(100e18, 1, dl));
        (amt,,,) = g.standby();
        assertEq(amt, 100e18);
    }

    // --- Phase 0 chain (0.4): minimum defend line is 1.35e18 (above Mezo's 110% MCR with margin, deliberately below the 150% CCR so defend() must also work in Recovery Mode) ---
    function test_minDefendLine_is135() public {
        vm.prank(address(0x777));
        vm.expectRevert(SternpostGovernor.BadPolicy.selector);
        factory.createGovernor(3e18, 1.2e18);
        vm.prank(address(0x777));
        vm.expectRevert(SternpostGovernor.BadPolicy.selector);
        factory.createGovernor(3e18, 1.34e18);
        vm.prank(borrower);
        vm.expectRevert(SternpostGovernor.BadPolicy.selector);
        g.setPolicy(3e18, 1.34e18);
        vm.prank(address(0xBEEF2));
        SternpostGovernor g2 = factory.createGovernor(2.5e18, 1.35e18);
        assertEq(g2.defendICR(), 1.35e18);
        assertEq(g2.feeBps(), 0);
    }

    // --- Phase 0 chain (0.7): immutable draw fee ---
    function test_fee_goesToRecipient_budgetAndIcrOnGross() public {
        SternpostFactory f10 = new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)), 10, FEE_RECIPIENT);
        assertEq(f10.feeBps(), 10);
        assertEq(factory.predictGovernor(borrower, 3e18, 1.5e18), address(g), "zero-fee factory still predicts");
        vm.prank(borrower);
        SternpostGovernor g10 = f10.createGovernor(3e18, 1.5e18);
        assertEq(g10.feeRecipient(), FEE_RECIPIENT);
        assertEq(f10.predictGovernor(borrower, 3e18, 1.5e18), address(g10), "prediction includes the fee params");
        vm.prank(borrower);
        g10.authorizeApp(app, 1_000e18, 400e18, uint64(block.timestamp + 30 days), address(0));
        musd.mint(borrower, 100e18);
        vm.startPrank(borrower); musd.approve(address(g10), type(uint256).max); g10.fund(100e18); vm.stopPrank();
        uint256 n = sigs.getNonce(borrower); uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 7 days;
        (bool ok,, uint256 icrAfter) = g10.previewDraw(app, 100e18, payee);
        assertTrue(ok);
        vm.prank(app);
        g10.draw(100e18, payee, dl, _w(100e18, address(g10), n, dl), hdl, _r(100e18, n + 1, hdl));
        assertEq(musd.balanceOf(payee), 99.9e18, "payee receives amount minus the 10 bps fee");
        assertEq(musd.balanceOf(FEE_RECIPIENT), 0.1e18, "fee goes to the immutable recipient");
        assertEq(g10.remainingBudget(app), 900e18, "budget is spent on the gross amount");
        assertEq(icrAfter, g10.icr(), "ICR check is on the gross drawn amount");
    }

    function test_feeBpsAbove50_reverts() public {
        vm.expectRevert(SternpostFactory.BadFee.selector);
        new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)), 51, FEE_RECIPIENT);
        vm.expectRevert(SternpostFactory.BadFee.selector);
        new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)), 10, address(0));
        vm.expectRevert(SternpostFactory.BadFee.selector);
        new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)), 10, 0x000000000000000000000000000000000000dEaD);
        vm.expectRevert(SternpostGovernor.BadFee.selector);
        new SternpostGovernor(borrower, IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)), 3e18, 1.5e18, 51, FEE_RECIPIENT);
    }
}
