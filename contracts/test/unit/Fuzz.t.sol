// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

contract GovernorFuzzTest is MockBase {
    /// Any accepted draw leaves ICR >= floor; any refused draw leaves debt and nonce untouched.
    function testFuzz_drawRespectsFloor(uint96 amt, uint64 price) public {
        uint256 a = bound(uint256(amt), 1, 400e18);
        pf.set(bound(uint256(price), 25_000e18, 200_000e18));
        uint256 d0 = tm.debt(borrower); uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        (bool ok,,uint256 projected) = g.previewDraw(app, a, payee);
        vm.prank(app);
        try g.draw(a, payee, dl, _w(a, address(g), 0, dl), hdl, _r(a, 1, hdl)) {
            assertTrue(ok, "preview agreed"); assertGe(g.icr(), g.floorICR()); assertEq(projected, g.icr());
        } catch {
            assertFalse(ok); assertEq(tm.debt(borrower), d0); assertEq(sigs.getNonce(borrower), 0);
        }
    }

    function testFuzz_directBypassAlwaysReverts(uint96 amt, uint64 price) public {
        uint256 a = bound(uint256(amt), 1, 3_000e18);
        pf.set(bound(uint256(price), 25_000e18, 200_000e18));
        uint256 dl = block.timestamp + 60;
        vm.prank(attacker);
        try sigs.withdrawMUSDWithSignature(a, address(0), address(0), borrower, address(g), _w(a, address(g), 0, dl), dl) { fail(); } catch {}
        assertEq(tm.debt(borrower), 2_000e18); assertEq(g.excess(), 0);
    }

    function testFuzz_callbackRemoved_bypassHealRestores(uint96 amt) public {
        ap.setCallback(false);
        uint256 a = bound(uint256(amt), 1e18, 1_000e18); uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 1 days;
        vm.prank(attacker); sigs.withdrawMUSDWithSignature(a, address(0), address(0), borrower, address(g), _w(a, address(g), 0, dl), dl);
        vm.prank(attacker); g.heal(a, hdl, _r(a, 1, hdl));
        assertEq(tm.debt(borrower), 2_000e18 + bo.getBorrowingFee(a)); assertEq(g.excess(), 0); assertEq(g.buffer(), 100e18);
    }
}
