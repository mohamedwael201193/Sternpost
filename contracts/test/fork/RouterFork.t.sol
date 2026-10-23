// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";
import {SternpostRouter} from "../../src/routes/SternpostRouter.sol";
import {IFactoryView, IMUSDSavingsRate, IMezoRouter} from "../../src/interfaces/IRoutes.sol";

interface IBO3 { function openTrove(uint256, address, address) external payable; function activePool() external view returns (address); }

interface IAllow { function allowance(address, address) external view returns (uint256); }

contract ForkFactory { mapping(address => address) public governorOf; function set(address b, address g) external { governorOf[b] = g; } }

/// @notice Save route against the live Mezo sMUSD savings contract (testnet). Run via script/fork.sh testnet.
contract RouterForkTest is Signer {
    address constant SMUSD = 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16;
    SternpostGovernor g; SternpostRouter r; address M; uint256 p0;

    function setUp() public {
        if (!vm.envOr("FORK_ON", false)) { vm.skip(true); return; }
        vm.createSelectFork(vm.envString("RPC"));
        if (block.chainid != 31611 || SMUSD.code.length == 0) { vm.skip(true); return; }
        sigAddr = vm.envAddress("SIG"); address BO = vm.envAddress("BO"); address PF = vm.envAddress("PF"); M = vm.envAddress("MUSD");
        address TM = vm.envAddress("TM"); p0 = vm.envUint("P0");
        vm.mockCall(PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(p0));
        borrower = vm.addr(PK); vm.deal(borrower, 2 ether);
        vm.prank(borrower); IBO3(BO).openTrove{value: 0.1 ether}(2000e18, address(0), address(0));
        uint256 i0 = ITroveManager(TM).getCurrentICR(borrower, p0);
        g = new SternpostGovernor(borrower, IBorrowerOperationsSignatures(sigAddr), IBorrowerOperations(BO), ITroveManager(TM),
            IPriceFeed(PF), IERC20Min(M), IBO3(BO).activePool(), ISavingsMUSD(address(0)), i0 - 0.2e18, 1.2e18);
        ForkFactory f = new ForkFactory(); f.set(borrower, address(g));
        r = new SternpostRouter(IFactoryView(address(f)), IBorrowerOperationsSignatures(sigAddr), IERC20Min(M), IMUSDSavingsRate(SMUSD),
            IMezoRouter(0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9), 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A,
            IERC20Min(0x7b7C000000000000000000000000000000000000), false);
        vm.startPrank(borrower);
        g.authorizeApp(address(r), 100e18, 50e18, uint64(block.timestamp + 1 days), address(r));
        r.setRoutes(1);
        vm.stopPrank();
    }

    function _save(uint256 a) internal returns (uint256) {
        uint256 n = IBorrowerOperationsSignatures(sigAddr).getNonce(borrower); uint256 dl = block.timestamp + 60;
        vm.prank(borrower);
        return r.drawAndSave(address(g), a, dl, _w(a, address(g), n, dl), dl + 1 days, _r(a, n + 1, dl + 1 days));
    }

    function test_fork_save_depositsIntoLiveSmusd() public {
        uint256 s0 = IERC20Min(SMUSD).balanceOf(borrower);
        uint256 shares = _save(10e18);
        assertEq(shares, 10e18, "1:1 shares");
        assertEq(IERC20Min(SMUSD).balanceOf(borrower) - s0, shares);
        assertEq(IERC20Min(SMUSD).balanceOf(address(r)), 0);
        assertEq(IERC20Min(M).balanceOf(address(r)), 0);
        assertEq(IAllow(M).allowance(address(r), SMUSD), 0);
    }

    function test_fork_save_overPerDrawRefused() public {
        uint256 n = IBorrowerOperationsSignatures(sigAddr).getNonce(borrower); uint256 dl = block.timestamp + 60;
        vm.prank(borrower); vm.expectRevert();
        r.drawAndSave(address(g), 60e18, dl, _w(60e18, address(g), n, dl), dl + 1 days, _r(60e18, n + 1, dl + 1 days));
    }

    function test_fork_save_disabledRouteRefused() public {
        vm.prank(borrower); r.setRoutes(0);
        uint256 n = IBorrowerOperationsSignatures(sigAddr).getNonce(borrower); uint256 dl = block.timestamp + 60;
        vm.prank(borrower); vm.expectRevert(abi.encodeWithSelector(SternpostRouter.RouteDisabled.selector, uint8(1)));
        r.drawAndSave(address(g), 5e18, dl, _w(5e18, address(g), n, dl), dl + 1 days, _r(5e18, n + 1, dl + 1 days));
    }
}
