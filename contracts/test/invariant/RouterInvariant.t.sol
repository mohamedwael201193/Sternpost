// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../unit/Router.t.sol";

/// @dev Random sequences of Save / Swap / Loop / price moves / skims. The router must never hold funds or approvals.
contract RouterHandler is RouterBase {
    uint256 public ok;
    constructor() { setUp(); }
    function R() external view returns (address) { return address(rt); }
    function M() external view returns (MockMUSD) { return musd; }
    function S() external view returns (address) { return address(smusd); }
    function D() external view returns (address) { return address(dex); }
    function save(uint96 a) external { uint256 x = bound(uint256(a), 1, 200e18); try this.s(x) { ok++; } catch {} }
    function swap(uint96 a, uint16 k) external {
        uint256 x = bound(uint256(a), 1e15, 200e18); dex.setSkim(bound(uint256(k), 0, 300));
        uint256 q = rt.quoteSwap(x); try this.w(x, q) { ok++; } catch {} dex.setSkim(0);
    }
    function loopN(uint96 a, uint8 k) external {
        uint256 x = bound(uint256(a), 1e18, 150e18); SternpostRouter.Leg[] memory ls = _legs(bound(uint256(k), 1, 3), x);
        vm.prank(borrower); try rt.loop(address(g), ls) { ok++; } catch {}
    }
    function price(uint64 p) external { pf.set(bound(uint256(p), 40_000e18, 150_000e18)); }
    function s(uint256 x) external { _save(x); }
    function w(uint256 x, uint256 q) external { _swap(x, q); }
}

contract RouterInvariantTest is Test {
    RouterHandler h;
    function setUp() public {
        h = new RouterHandler(); targetContract(address(h));
        bytes4[] memory sel = new bytes4[](4);
        sel[0] = RouterHandler.save.selector; sel[1] = RouterHandler.swap.selector;
        sel[2] = RouterHandler.loopN.selector; sel[3] = RouterHandler.price.selector;
        targetSelector(FuzzSelector(address(h), sel));
    }
    function invariant_routerHoldsNothing() public view {
        address rt = h.R(); MockMUSD m = h.M();
        assertEq(m.balanceOf(rt), 0);
        assertEq(rt.balance, 0);
        assertEq(MockSavingsRate(h.S()).balanceOf(rt), 0);
        assertEq(m.allowance(rt, h.D()), 0);
        assertEq(m.allowance(rt, h.S()), 0);
    }
}
