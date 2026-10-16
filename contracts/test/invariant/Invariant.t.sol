// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

contract Handler is Signer {
    SternpostGovernor g; MockSignatures sigs; MockPriceFeed pf; address app; uint256 public drawn; uint256 public bypassSucceeded;
    constructor(SternpostGovernor g_, MockSignatures s, MockPriceFeed p, address app_, address borrower_) {
        g = g_; sigs = s; pf = p; app = app_; borrower = borrower_; sigAddr = address(s);
    }
    function draw(uint96 amt) external {
        uint256 a = bound(uint256(amt), 1, 400e18); uint256 n = sigs.getNonce(borrower); uint256 dl = block.timestamp + 60;
        vm.prank(app);
        try g.draw(a, address(0xBEEF), dl, _w(a, address(g), n, dl), dl, _r(a, n + 1, dl)) { drawn += a; } catch {}
    }
    function bypass(uint96 amt) external {
        uint256 a = bound(uint256(amt), 1, 400e18); uint256 n = sigs.getNonce(borrower); uint256 dl = block.timestamp + 60;
        try sigs.withdrawMUSDWithSignature(a, address(0), address(0), borrower, address(g), _w(a, address(g), n, dl), dl) { bypassSucceeded++; } catch {}
    }
    function movePrice(uint64 p) external { pf.set(bound(uint256(p), 40_000e18, 200_000e18)); }
    function poke() external { try g.defend() {} catch {} }
}

contract GovernorInvariantTest is MockBase {
    Handler h;
    function setUp() public override {
        super.setUp();
        h = new Handler(g, sigs, pf, app, borrower);
        targetContract(address(h));
    }
    function invariant_bypassNeverLands() public view { assertEq(h.bypassSucceeded(), 0); assertEq(g.excess(), 0); }
    function invariant_budgetNeverExceeded() public view { assertLe(h.drawn(), 1_000e18); assertEq(1_000e18 - g.remainingBudget(app), h.drawn()); }
    function invariant_governorHoldsOnlyBuffer() public view { assertEq(musd.balanceOf(address(g)) + sav.balanceOf(address(g)), g.buffer()); }
}
