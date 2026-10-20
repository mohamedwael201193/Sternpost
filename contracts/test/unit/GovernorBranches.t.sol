// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

/// @notice Branch coverage for refusal paths: each test pins one guard to its exact error or reason code.
contract GovernorBranchTest is MockBase {
    uint256 constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _reason(address a, uint256 amt, address p) internal view returns (string memory r) {
        (, r,) = g.previewDraw(a, amt, p);
    }

    function test_onlyBorrower_rejectsStranger() public {
        vm.prank(attacker);
        vm.expectRevert(SternpostGovernor.OnlyBorrower.selector);
        g.setPolicy(3e18, 1.5e18);
    }

    function test_projectedICR_noDebt_isMax() public {
        tm.setTrove(borrower, 0.1e18, 0);
        assertEq(g.projectedICR(0), type(uint256).max);
    }

    function test_preview_frozen() public {
        vm.prank(borrower); g.revoke(0, "");
        assertEq(_reason(app, 10e18, payee), "FROZEN");
    }

    function test_preview_appExpired() public {
        vm.warp(block.timestamp + 31 days);
        assertEq(_reason(app, 10e18, payee), "APP_EXPIRED");
    }

    function test_preview_overBudget() public {
        _draw(400e18); _draw(400e18);
        assertEq(_reason(app, 300e18, payee), "OVER_BUDGET");
    }

    function test_preview_payeeNotAllowed() public {
        vm.prank(borrower); g.authorizeApp(app, 1_000e18, 400e18, uint64(block.timestamp + 1 days), payee);
        assertEq(_reason(app, 10e18, attacker), "PAYEE_NOT_ALLOWED");
        assertEq(_reason(app, 10e18, payee), "");
    }

    function test_draw_zeroAmount() public {
        vm.prank(app);
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector);
        g.draw(0, payee, block.timestamp, "", block.timestamp, "");
    }

    function test_fund_transferFromFalse_reverts() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.transferFrom.selector), abi.encode(false));
        vm.prank(borrower);
        vm.expectRevert(SternpostGovernor.TransferFailed.selector);
        g.fund(1e18);
    }

    function test_withdrawBuffer_transferFalse_reverts() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.transfer.selector), abi.encode(false));
        vm.prank(borrower);
        vm.expectRevert(SternpostGovernor.TransferFailed.selector);
        g.withdrawBuffer(1e18);
    }

    function test_draw_payeeTransferFalse_revertsAtomically() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.transfer.selector, payee), abi.encode(false));
        uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        vm.prank(app);
        vm.expectRevert(SternpostGovernor.TransferFailed.selector);
        g.draw(10e18, payee, dl, _w(10e18, address(g), 0, dl), hdl, _r(10e18, 1, hdl));
        assertEq(sigs.getNonce(borrower), 0);
    }

    function test_parkReserve_approveFalse_reverts() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.approve.selector), abi.encode(false));
        vm.prank(borrower);
        vm.expectRevert(SternpostGovernor.TransferFailed.selector);
        g.parkReserve(1e18);
    }

    function test_parkReserve_withoutSavings_reverts() public {
        SternpostFactory f2 = new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(0)));
        vm.prank(borrower); SternpostGovernor g2 = f2.createGovernor(3e18, 1.5e18);
        vm.prank(borrower);
        vm.expectRevert(SternpostGovernor.NoSavings.selector);
        g2.parkReserve(1e18);
    }

    function test_unpark_zeroOrTooMuch_reverts() public {
        vm.startPrank(borrower);
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector);
        g.unparkReserve(0);
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector);
        g.unparkReserve(1e18);
        vm.stopPrank();
    }

    function test_rearm_zeroOrOverBuffer_reverts() public {
        uint256 dl = block.timestamp + 1 days;
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector);
        g.rearm(0, dl, _r(0, 0, dl));
        vm.expectRevert(SternpostGovernor.ZeroAmount.selector);
        g.rearm(101e18, dl, _r(101e18, 0, dl));
    }

    function test_rearm_highS_malleatedSig_rejected() public {
        uint256 dl = block.timestamp + 1 days;
        bytes memory sig = _r(5e18, 0, dl);
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := mload(add(sig, 32)) s := mload(add(sig, 64)) v := byte(0, mload(add(sig, 96))) }
        bytes memory mal = abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(SternpostGovernor.BadHeal.selector);
        g.rearm(5e18, dl, mal);
        g.rearm(5e18, dl, sig); // the canonical form still works
    }
}
