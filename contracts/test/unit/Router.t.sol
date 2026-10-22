// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";
import {MockSavingsRate, MockBTC, MockDex} from "../mocks/MockRoutes.sol";
import {SternpostRouter} from "../../src/routes/SternpostRouter.sol";
import {IMUSDSavingsRate, IMezoRouter, IFactoryView} from "../../src/interfaces/IRoutes.sol";

abstract contract RouterBase is MockBase {
    SternpostRouter rt; MockSavingsRate smusd; MockBTC btc; MockDex dex;
    address agent = address(0xA6E7);
    uint256 constant DL = 60; uint256 constant HDL = 1 days;

    function setUp() public virtual override {
        super.setUp();
        smusd = new MockSavingsRate(musd); btc = new MockBTC(); dex = new MockDex(musd); dex.setPrice(100_000e18);
        vm.deal(address(dex), 100 ether);
        rt = new SternpostRouter(IFactoryView(address(factory)), IBorrowerOperationsSignatures(address(sigs)),
            IERC20Min(address(musd)), IMUSDSavingsRate(address(smusd)), IMezoRouter(address(dex)), address(0xFAC7),
            IERC20Min(address(btc)), false);
        vm.startPrank(borrower);
        g.authorizeApp(address(rt), 1_000e18, 400e18, uint64(block.timestamp + 30 days), address(rt));
        rt.setRoutes(7);
        vm.stopPrank();
    }
    function _n() internal view returns (uint256) { return sigs.getNonce(borrower); }
    address who; bytes err; bool partialErr;
    function _expect() internal {
        if (err.length != 0) { if (partialErr) vm.expectPartialRevert(bytes4(err)); else vm.expectRevert(err); }
        err = ""; partialErr = false;
    }
    function _save(uint256 a) internal returns (uint256) {
        uint256 n = _n(); uint256 dl = block.timestamp + DL; uint256 h = block.timestamp + HDL;
        bytes memory w = _w(a, address(g), n, dl); bytes memory r = _r(a, n + 1, h);
        address c = who == address(0) ? borrower : who; _expect(); vm.prank(c);
        return rt.drawAndSave(address(g), a, dl, w, h, r);
    }
    function _swap(uint256 a, uint256 minOut) internal returns (uint256) {
        uint256 n = _n(); uint256 dl = block.timestamp + DL; uint256 h = block.timestamp + HDL;
        bytes memory w = _w(a, address(g), n, dl); bytes memory r = _r(a, n + 1, h);
        address c = who == address(0) ? borrower : who; _expect(); vm.prank(c);
        return rt.drawAndSwap(address(g), a, minOut, dl, w, h, r);
    }
    function _leg(uint256 a, uint256 coll, uint256 n) internal view returns (SternpostRouter.Leg memory l) {
        uint256 dl = block.timestamp + DL; uint256 h = block.timestamp + HDL;
        l = SternpostRouter.Leg(a, dl, _w(a, address(g), n, dl), h, _r(a, n + 1, h), coll, dl, _ac(coll, n + 1, dl));
    }
    function _legs(uint256 k, uint256 a) internal view returns (SternpostRouter.Leg[] memory ls) {
        ls = new SternpostRouter.Leg[](k); uint256 n = _n();
        for (uint256 i; i < k; ++i) ls[i] = _leg(a, rt.quoteSwap(a) * 99 / 100, n + 2 * i);
    }
}

contract RouterTest is RouterBase {
    // ------------------------------------------------------------ Save
    function test_save_depositsSharesToBorrower() public {
        uint256 s = _save(100e18);
        assertEq(s, 100e18); assertEq(smusd.balanceOf(borrower), 100e18);
        assertEq(musd.balanceOf(address(rt)), 0); assertEq(smusd.balanceOf(address(rt)), 0);
        assertEq(musd.allowance(address(rt), address(smusd)), 0, "approval reset");
    }
    function test_save_borrowerCanWithdrawAndClaimYield() public {
        _save(100e18);
        smusd.accrue(borrower, 3e18);
        uint256 m0 = musd.balanceOf(borrower);
        vm.startPrank(borrower); smusd.claimYield(); smusd.withdraw(100e18); vm.stopPrank();
        assertEq(musd.balanceOf(borrower) - m0, 103e18);
    }
    function test_save_emitsEvent() public {
        vm.expectEmit(true, true, false, true, address(rt)); emit SternpostRouter.Saved(address(g), borrower, 50e18, 50e18);
        _save(50e18);
    }
    // ------------------------------------------------------------ Swap
    function test_swap_btcToBorrower() public {
        uint256 q = rt.quoteSwap(100e18); uint256 b0 = borrower.balance;
        uint256 out = _swap(100e18, q);
        assertEq(out, q); assertEq(borrower.balance - b0, q);
        assertEq(musd.balanceOf(address(rt)), 0); assertEq(musd.allowance(address(rt), address(dex)), 0);
    }
    function test_swap_slippageReverts_stateUnchanged() public {
        uint256 q = rt.quoteSwap(100e18); dex.setSkim(100); uint256 n = _n(); uint256 d0 = tm.debt(borrower);
        who = borrower; err = bytes("INSUFFICIENT_OUTPUT_AMOUNT"); _swap(100e18, q); who = address(0);
        assertEq(_n(), n); assertEq(tm.debt(borrower), d0);
    }
    function test_swap_zeroMinOutRejected() public {
        who = borrower; err = abi.encodeWithSelector(SternpostRouter.Slippage.selector, 0, 0); _swap(100e18, 0); who = address(0);
    }
    // ------------------------------------------------------------ Loop
    function test_loop_oneLeg_addsCollateral_floorHolds() public {
        uint256 c0 = tm.coll(borrower); SternpostRouter.Leg[] memory ls = _legs(1, 100e18);
        vm.prank(borrower); uint256 added = rt.loop(address(g), ls);
        assertEq(tm.coll(borrower) - c0, added); assertEq(added, ls[0].collAmount);
        assertGe(g.icr(), g.floorICR()); assertEq(address(rt).balance, 0); assertEq(musd.balanceOf(address(rt)), 0);
    }
    function test_loop_surplusBtcGoesToBorrower() public {
        SternpostRouter.Leg[] memory ls = _legs(1, 100e18); uint256 q = rt.quoteSwap(100e18); uint256 b0 = borrower.balance;
        vm.prank(borrower); rt.loop(address(g), ls);
        assertEq(borrower.balance - b0, q - ls[0].collAmount);
    }
    function test_loop_threeLegs() public {
        uint256 c0 = tm.coll(borrower); SternpostRouter.Leg[] memory ls = _legs(3, 100e18);
        vm.prank(borrower); uint256 added = rt.loop(address(g), ls);
        assertEq(tm.coll(borrower) - c0, added); assertEq(_n(), 6);
    }
    function test_loop_maxLegs() public {
        SternpostRouter.Leg[] memory ls = _legs(4, 10e18);
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostRouter.BadLegs.selector, 4)); rt.loop(address(g), ls);
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostRouter.BadLegs.selector, 0));
        rt.loop(address(g), new SternpostRouter.Leg[](0));
    }
    function test_loop_floorBreachInLaterLegRevertsAll() public {
        // Leg 1 keeps ICR above the floor, leg 2 would breach it: the whole loop reverts, nothing is left behind.
        vm.prank(borrower); g.setPolicy(4e18, 1.5e18);
        dex.setPrice(1e30); // swap returns dust, so collateral barely grows
        uint256 n = _n(); uint256 c0 = tm.coll(borrower); uint256 d0 = tm.debt(borrower);
        SternpostRouter.Leg[] memory ls = new SternpostRouter.Leg[](2);
        for (uint256 i; i < 2; ++i) ls[i] = _leg(390e18, 1, n + 2 * i);
        vm.prank(borrower); vm.expectPartialRevert(SternpostGovernor.Unsafe.selector); rt.loop(address(g), ls);
        assertEq(_n(), n, "atomic"); assertEq(tm.coll(borrower), c0); assertEq(tm.debt(borrower), d0);
    }
    function test_loop_routerFloorCheck_independentOfGovernor() public {
        // Defense in depth: if collateral price feed moves between the governor's check and the router's
        // (simulated by pricing the trove lower mid-loop), the router re-checks the floor itself.
        SternpostRouter.Leg[] memory ls = _legs(1, 100e18);
        dex.setReenter(address(pf), abi.encodeCall(MockPriceFeed.set, (50_000e18)));
        vm.prank(borrower); vm.expectPartialRevert(SternpostRouter.Unsafe.selector); rt.loop(address(g), ls);
    }
    function test_loop_slippageUsesSignedCollAmount() public {
        uint256 q = rt.quoteSwap(100e18); SternpostRouter.Leg[] memory ls = new SternpostRouter.Leg[](1);
        ls[0] = _leg(100e18, q + 1, _n());
        vm.prank(borrower); vm.expectRevert(bytes("INSUFFICIENT_OUTPUT_AMOUNT")); rt.loop(address(g), ls);
    }
    function test_loop_wrongAddCollSigReverts() public {
        SternpostRouter.Leg[] memory ls = _legs(1, 100e18); ls[0].addCollSig = _ac(ls[0].collAmount + 1, 1, ls[0].addCollDeadline);
        vm.prank(borrower); vm.expectRevert(bytes("bad sig")); rt.loop(address(g), ls);
    }
    // ------------------------------------------------------------ access control
    function test_strangerCannotRoute() public {
        who = attacker; err = abi.encodeWithSelector(SternpostRouter.NotAllowed.selector, attacker); _save(10e18); who = address(0);
    }
    function test_operatorCanRoute_outputStillToBorrower() public {
        vm.prank(borrower); rt.setOperator(agent, true);
        who = agent; _save(10e18); who = address(0);
        assertEq(smusd.balanceOf(borrower), 10e18); assertEq(smusd.balanceOf(agent), 0);
        vm.prank(borrower); rt.setOperator(agent, false);
        who = agent; err = abi.encodeWithSelector(SternpostRouter.NotAllowed.selector, agent); _save(10e18); who = address(0);
    }
    function test_routeDisabled() public {
        vm.prank(borrower); rt.setRoutes(1);
        who = borrower; err = abi.encodeWithSelector(SternpostRouter.RouteDisabled.selector, 2); _swap(10e18, 1); who = address(0);
        SternpostRouter.Leg[] memory ls = _legs(1, 10e18);
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostRouter.RouteDisabled.selector, 4)); rt.loop(address(g), ls);
    }
    function test_setRoutesMasksUnknownBits() public {
        vm.prank(borrower); rt.setRoutes(0xFF); assertEq(rt.routesOf(borrower), 7);
    }
    function test_spoofedGovernorRejected() public {
        FakeGov fake = new FakeGov(borrower);
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostRouter.NotGovernor.selector, address(fake)));
        rt.drawAndSave(address(fake), 1, 0, "", 0, "");
    }
    function test_governorPolicyStillApplies() public {
        who = borrower; err = abi.encodeWithSelector(SternpostGovernor.OverPerDraw.selector, 500e18, 400e18); _save(500e18); who = address(0);
        vm.prank(borrower); g.revoke(0, "");
        who = borrower; err = abi.encodePacked(SternpostGovernor.IsFrozen.selector); _save(10e18); who = address(0);
    }
    function test_unsafeDrawRefusedByGovernor() public {
        vm.prank(borrower); g.authorizeApp(address(rt), 10_000e18, 10_000e18, uint64(block.timestamp + 30 days), address(rt));
        who = borrower; err = abi.encodePacked(SternpostGovernor.Unsafe.selector); partialErr = true; _save(2_000e18); who = address(0);
    }
    function test_payeeLockedToRouter_directAppCannotSkipRouting() public {
        // The router is the only payee for this app policy; the router itself never draws for anyone but via routes.
        (,,,, address p) = g.appPolicy(address(rt)); assertEq(p, address(rt));
    }
    function test_unexpectedBtcRejected() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(rt).call{value: 1}(""); assertFalse(ok);
    }
    function test_reentrancyBlocked() public {
        uint256 n = _n(); uint256 dl = block.timestamp + DL; uint256 h = block.timestamp + HDL;
        dex.setReenter(address(rt), abi.encodeCall(SternpostRouter.drawAndSave, (address(g), 1, dl, "", h, "")));
        vm.prank(borrower); vm.expectRevert(SternpostRouter.Reentrancy.selector);
        rt.drawAndSwap(address(g), 10e18, 1, dl, _w(10e18, address(g), n, dl), h, _r(10e18, n + 1, h));
    }
    function test_zeroAmount() public {
        vm.prank(borrower); vm.expectRevert(SternpostRouter.ZeroAmount.selector); rt.drawAndSave(address(g), 0, 0, "", 0, "");
    }
}

contract FakeGov { address public borrower; constructor(address b) { borrower = b; } }

contract RouterFuzzTest is RouterBase {
    function testFuzz_save(uint96 a) public {
        uint256 amt = bound(uint256(a), 1, 400e18);
        _save(amt);
        assertEq(smusd.balanceOf(borrower), amt); assertEq(musd.balanceOf(address(rt)), 0);
    }
    function testFuzz_swapSlippage(uint96 a, uint16 skim) public {
        uint256 amt = bound(uint256(a), 1e15, 400e18); uint256 s = bound(uint256(skim), 0, 500);
        uint256 q = rt.quoteSwap(amt); dex.setSkim(s); uint256 n = _n();
        try this.doSwap(amt, q) { assertEq(s, 0); } catch { assertGt(s, 0); assertEq(_n(), n); }
        assertEq(musd.balanceOf(address(rt)), 0);
    }
    function doSwap(uint256 amt, uint256 q) external { _swap(amt, q); }
    function testFuzz_loop(uint96 a, uint8 k) public {
        uint256 legs = bound(uint256(k), 1, 3); uint256 amt = bound(uint256(a), 1e18, 300e18);
        vm.prank(borrower); g.authorizeApp(address(rt), 1_000e18, 400e18, uint64(block.timestamp + 30 days), address(rt));
        SternpostRouter.Leg[] memory ls = _legs(legs, amt);
        vm.prank(borrower);
        try rt.loop(address(g), ls) { assertGe(g.icr(), g.floorICR()); } catch {}
        assertEq(address(rt).balance, 0); assertEq(musd.balanceOf(address(rt)), 0);
    }
}
