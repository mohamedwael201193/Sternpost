// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../unit/Router.t.sol";

/// @notice C9 (plan §3.14): borrower-set maxSlippageBps checked against quoteSwap in drawAndSwap.
///         An agent passing minOut = 1 must revert; a sane slippage passes; a minOut looser than
///         a tight borrower cap reverts. Reuses RouterBase (mock DEX/governor) from Router.t.sol.
contract RouterSlippageTest is RouterBase {
    function _minRequired(uint256 amount, uint16 bps) internal view returns (uint256) {
        return rt.quoteSwap(amount) * (10_000 - bps) / 10_000;
    }

    // ------------------------------------------------------------ acceptance: minOut = 1 reverts
    function test_minOutOneReverts_defaultCap() public {
        uint256 q = rt.quoteSwap(100e18);
        assertEq(rt.maxSlippageBps(borrower), 100, "default cap is 100 bps");
        uint256 n = _n();
        uint256 d0 = tm.debt(borrower);
        who = borrower;
        err = abi.encodeWithSelector(SternpostRouter.Slippage.selector, 1, _minRequired(100e18, 100));
        _swap(100e18, 1);
        who = address(0);
        assertEq(_n(), n, "nonce unchanged after revert");
        assertEq(tm.debt(borrower), d0, "no debt drawn after revert");
        assertEq(musd.balanceOf(address(rt)), 0, "router holds no residue");
    }

    function test_minOutOneReverts_tightCap() public {
        vm.prank(borrower);
        rt.setMaxSlippageBps(50);
        assertEq(rt.maxSlippageBps(borrower), 50);
        who = borrower;
        err = abi.encodeWithSelector(SternpostRouter.Slippage.selector, 1, _minRequired(100e18, 50));
        _swap(100e18, 1);
        who = address(0);
    }

    // ------------------------------------------------------------ sane slippage passes
    function test_saneSlippagePasses_defaultCap() public {
        uint256 q = rt.quoteSwap(100e18);
        // 0.5% below quote: inside the default 100 bps (1%) cap.
        uint256 out = _swap(100e18, q * 9_950 / 10_000);
        assertEq(out, q);
    }

    function test_saneSlippagePasses_tightCap() public {
        vm.prank(borrower);
        rt.setMaxSlippageBps(50);
        uint256 q = rt.quoteSwap(100e18);
        // minOut exactly at the 50 bps floor passes.
        uint256 out = _swap(100e18, _minRequired(100e18, 50));
        assertEq(out, q);
    }

    // ------------------------------------------------------------ minOut looser than a tight cap reverts
    function test_tooLooseMinOutReverts_tightCap() public {
        vm.prank(borrower);
        rt.setMaxSlippageBps(10); // 0.1% cap
        uint256 q = rt.quoteSwap(100e18);
        uint256 n = _n();
        uint256 d0 = tm.debt(borrower);
        who = borrower;
        // 1% below quote: looser than the 10 bps cap allows.
        err = abi.encodeWithSelector(SternpostRouter.Slippage.selector, q * 99 / 100, _minRequired(100e18, 10));
        _swap(100e18, q * 99 / 100);
        who = address(0);
        assertEq(_n(), n, "nonce unchanged after revert");
        assertEq(tm.debt(borrower), d0, "no debt drawn after revert");
    }

    // ------------------------------------------------------------ setter / view
    function test_setMaxSlippageBps_validation() public {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(SternpostRouter.BadSlippage.selector, 0));
        rt.setMaxSlippageBps(0);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(SternpostRouter.BadSlippage.selector, 10_001));
        rt.setMaxSlippageBps(10_001);
        vm.prank(borrower);
        vm.expectEmit(true, false, false, true, address(rt));
        emit SternpostRouter.MaxSlippageSet(borrower, 250);
        rt.setMaxSlippageBps(250);
        assertEq(rt.maxSlippageBps(borrower), 250);
    }

    function test_setMaxSlippageBps_optOut_allowsMinOutOne() public {
        vm.prank(borrower);
        rt.setMaxSlippageBps(10_000); // opt out of the cap
        uint256 q = rt.quoteSwap(100e18);
        uint256 out = _swap(100e18, 1);
        assertEq(out, q);
    }

    function test_setMaxSlippageBps_isPerBorrower() public {
        vm.prank(borrower);
        rt.setMaxSlippageBps(25);
        assertEq(rt.maxSlippageBps(borrower), 25);
        assertEq(rt.maxSlippageBps(address(0xBEEF)), 100, "other borrowers keep the default");
    }
}
