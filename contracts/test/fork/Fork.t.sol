// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";

interface IBO2 { function openTrove(uint256, address, address) external payable; function activePool() external view returns (address); }

/// @notice Runs against the real deployed Mezo contracts. Set FORK=testnet or FORK=mainnet (see script/fork.sh).
contract ForkTest is Signer {
    SternpostGovernor g; address BO; address TM; address PF; address M; address AP; uint256 p0;
    address app = address(0xA11CE); address payee = address(0xBEEF); address attacker = address(0xBAD);

    function setUp() public {
        if (!vm.envOr("FORK_ON", false)) { vm.skip(true); return; }
        vm.createSelectFork(vm.envString("RPC"));
        sigAddr = vm.envAddress("SIG"); BO = vm.envAddress("BO"); PF = vm.envAddress("PF"); M = vm.envAddress("MUSD"); TM = vm.envAddress("TM");
        AP = IBO2(BO).activePool();
        p0 = vm.envUint("P0"); // Mezo price precompile is not available in forks; pin the live price
        vm.mockCall(PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(p0));
        borrower = vm.addr(PK); vm.deal(borrower, 2 ether);
        vm.prank(borrower); IBO2(BO).openTrove{value: 0.1 ether}(2000e18, address(0), address(0));
        uint256 i0 = ITroveManager(TM).getCurrentICR(borrower, p0);
        g = new SternpostGovernor(borrower, IBorrowerOperationsSignatures(sigAddr), IBorrowerOperations(BO), ITroveManager(TM),
            IPriceFeed(PF), IERC20Min(M), AP, ISavingsMUSD(address(0)), i0 - 0.2e18, 1.2e18);
        vm.prank(borrower); g.authorizeApp(app, 10_000e18, 10_000e18, uint64(block.timestamp + 1 days), address(0));
    }
    function _n() internal view returns (uint256) { return IBorrowerOperationsSignatures(sigAddr).getNonce(borrower); }
    function _debt() internal view returns (uint256 d) { (, uint256 p, uint256 i,, uint256 pp, uint256 pi) = ITroveManager(TM).getEntireDebtAndColl(borrower); d = p + i + pp + pi; }

    /// 1. Direct native draw to Sternpost reverts; debt and nonce unchanged.
    function test_fork_directBypassReverts() public {
        uint256 n = _n(); uint256 dl = block.timestamp + 60; uint256 d0 = _debt();
        vm.prank(attacker); vm.expectRevert();
        IBorrowerOperationsSignatures(sigAddr).withdrawMUSDWithSignature(600e18, address(0), address(0), borrower, address(g), _w(600e18, address(g), n, dl), dl);
        assertEq(_debt(), d0); assertEq(_n(), n);
    }
    /// 2. Safe draw succeeds; preview agrees with the protocol (fee + interest included).
    function test_fork_safeDraw_previewMatches() public {
        uint256 n = _n(); uint256 dl = block.timestamp + 60;
        uint256 proj = g.projectedICR(10e18);
        vm.prank(app); g.draw(10e18, payee, dl, _w(10e18, address(g), n, dl), dl + 1 days, _r(10e18, n + 1, dl + 1 days));
        assertEq(IERC20Min(M).balanceOf(payee), 10e18);
        assertApproxEqRel(g.icr(), proj, 1e12, "projected vs realised");
    }
    /// 3. Draw that would cross the floor is refused; state unchanged.
    function test_fork_unsafeDrawRefused() public {
        uint256 n = _n(); uint256 dl = block.timestamp + 60; uint256 d0 = _debt();
        vm.prank(app); vm.expectPartialRevert(SternpostGovernor.Unsafe.selector);
        g.draw(600e18, payee, dl, _w(600e18, address(g), n, dl), dl + 1 days, _r(600e18, n + 1, dl + 1 days));
        assertEq(_debt(), d0); assertEq(_n(), n);
    }
    /// 4. Upstream callback removed (ActivePool.sendCollateral(gov,0) patched to a no-op): honest draws fail closed,
    ///    a leaked signature creates debt that lands as excess, heal() repays it.
    function test_fork_callbackRemoved_failsClosed_healRecovers() public {
        vm.mockCall(AP, abi.encodeWithSignature("sendCollateral(address,uint256)", address(g), uint256(0)), "");
        uint256 n = _n(); uint256 dl = block.timestamp + 60; uint256 hdl = dl + 1 days; uint256 d0 = _debt();
        vm.prank(app); vm.expectRevert(abi.encodeWithSelector(SternpostGovernor.CallbackMismatch.selector, uint8(0)));
        g.draw(50e18, payee, dl, _w(50e18, address(g), n, dl), hdl, _r(50e18, n + 1, hdl));
        vm.prank(attacker);
        IBorrowerOperationsSignatures(sigAddr).withdrawMUSDWithSignature(50e18, address(0), address(0), borrower, address(g), _w(50e18, address(g), n, dl), dl);
        assertEq(g.excess(), 50e18, "dependency exposed: leaked sig lands as excess");
        vm.prank(attacker); g.heal(50e18, hdl, _r(50e18, n + 1, hdl));
        assertEq(g.excess(), 0); assertLe(_debt() - d0, 50e18 / 1000 + 1e15, "residual <= fee");
        assertEq(IERC20Min(M).balanceOf(attacker), 0);
    }
    /// 5. Nonce burn through revoke() kills an outstanding withdraw signature (real AddColl signature).
    function test_fork_revokeBurnsNonce() public {
        uint256 n = _n(); uint256 dl = block.timestamp + 60; bytes memory w = _w(50e18, address(g), n, dl);
        vm.prank(borrower); g.revoke{value: 1}(dl, _ac(1, n, dl));
        assertEq(_n(), n + 1);
        vm.prank(attacker); vm.expectRevert();
        IBorrowerOperationsSignatures(sigAddr).withdrawMUSDWithSignature(50e18, address(0), address(0), borrower, address(g), w, dl);
    }
    /// 6. Two apps racing on the same nonce: only the first lands.
    function test_fork_nonceRace() public {
        address app2 = address(0xA22);
        vm.prank(borrower); g.authorizeApp(app2, 100e18, 100e18, uint64(block.timestamp + 1 days), address(0));
        uint256 n = _n(); uint256 dl = block.timestamp + 60; uint256 hdl = dl + 1 days;
        vm.prank(app); g.draw(10e18, payee, dl, _w(10e18, address(g), n, dl), hdl, _r(10e18, n + 1, hdl));
        vm.prank(app2); vm.expectRevert();
        g.draw(20e18, payee, dl, _w(20e18, address(g), n, dl), hdl, _r(20e18, n + 2, hdl));
        assertEq(_n(), n + 1);
    }
    /// 7. Draw then stress: defend() repays the armed standby from the buffer.
    function test_fork_defend() public {
        deal(M, borrower, 100e18);
        vm.startPrank(borrower); IERC20Min(M).approve(address(g), 100e18); g.fund(100e18); vm.stopPrank();
        uint256 n = _n(); uint256 dl = block.timestamp + 60; uint256 hdl = dl + 1 days;
        vm.prank(app); g.draw(50e18, payee, dl, _w(50e18, address(g), n, dl), hdl, _r(50e18, n + 1, hdl));
        vm.mockCall(PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(p0 * 32 / 100));
        uint256 before = g.icr(); g.defend(); assertGt(g.icr(), before); assertTrue(g.frozen());
    }
}
