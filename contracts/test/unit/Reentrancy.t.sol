// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

/// @dev A malicious payee/ActivePool that tries to re-enter draw()/heal() during the callback.
contract EvilActivePool {
    SternpostGovernor public g; bytes public payload; bool public reentered; bool public reentryReverted;
    function arm(SternpostGovernor g_, bytes calldata p) external { g = g_; payload = p; }
    function sendCollateral(address to, uint256) external {
        (bool ok,) = to.call(""); require(ok, "cb");
        (bool ok2,) = address(g).call(payload); reentered = true; reentryReverted = !ok2;
        require(!ok2, "reentry succeeded");
    }
    receive() external payable {}
}

contract ReentrancyTest is Signer {
    function test_reentrantDraw_blocked() public {
        vm.warp(1_800_000_000);
        borrower = vm.addr(PK);
        MockMUSD musd = new MockMUSD(); MockPriceFeed pf = new MockPriceFeed(); MockTroveManager tm = new MockTroveManager(pf);
        EvilActivePool evil = new EvilActivePool(); MockBorrowerOperations bo = new MockBorrowerOperations();
        MockSignatures sigs = new MockSignatures(musd, tm, MockActivePool(payable(address(evil))), bo); sigAddr = address(sigs);
        SternpostGovernor g = new SternpostGovernor(borrower, IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(evil), ISavingsMUSD(address(0)), 3e18, 1.5e18);
        tm.setTrove(borrower, 0.1e18, 2_000e18);
        address app = address(0xA11CE);
        vm.prank(borrower); g.authorizeApp(app, 1_000e18, 500e18, uint64(block.timestamp + 1 days), address(0));
        evil.arm(g, abi.encodeCall(SternpostGovernor.heal, (1, block.timestamp, "")));
        uint256 dl = block.timestamp + 60;
        vm.prank(app); g.draw(10e18, app, dl, _w(10e18, address(g), 0, dl), dl, _r(10e18, 1, dl));
        assertTrue(evil.reentered() && evil.reentryReverted());
        assertEq(musd.balanceOf(app), 10e18);
    }
}
