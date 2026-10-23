// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import "./mocks/MockMezo.sol";
import {SternpostGovernor} from "../src/SternpostGovernor.sol";
import {SternpostFactory} from "../src/SternpostFactory.sol";
import {
    IERC20Min, IBorrowerOperationsSignatures, ITroveManager, IPriceFeed, IBorrowerOperations, ISavingsMUSD
} from "../src/interfaces/IMezo.sol";

abstract contract Signer is Test {
    uint256 internal constant PK = 0xB0B5EED;
    address internal borrower;
    address internal sigAddr;

    function _dom() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("BorrowerOperationsSignatures"), keccak256("1"), block.chainid, sigAddr));
    }
    function _sign(bytes32 sh) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, keccak256(abi.encodePacked("\x19\x01", _dom(), sh)));
        return abi.encodePacked(r, s, v);
    }
    function _w(uint256 a, address rc, uint256 n, uint256 dl) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)"), a, borrower, rc, n, dl)));
    }
    function _r(uint256 a, uint256 n, uint256 dl) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)"), a, borrower, n, dl)));
    }
    function _ac(uint256 a, uint256 n, uint256 dl) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)"), a, borrower, n, dl)));
    }
}

abstract contract MockBase is Signer {
    MockMUSD musd; MockPriceFeed pf; MockTroveManager tm; MockActivePool ap; MockBorrowerOperations bo;
    MockSignatures sigs; MockSavings sav; SternpostFactory factory; SternpostGovernor g;
    address app = address(0xA11CE); address payee = address(0xBEEF); address attacker = address(0xBAD);

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        borrower = vm.addr(PK);
        musd = new MockMUSD(); pf = new MockPriceFeed(); tm = new MockTroveManager(pf); ap = new MockActivePool();
        bo = new MockBorrowerOperations(); sigs = new MockSignatures(musd, tm, ap, bo); sav = new MockSavings(musd);
        sigAddr = address(sigs);
        factory = new SternpostFactory(IBorrowerOperationsSignatures(address(sigs)), IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)), IPriceFeed(address(pf)), IERC20Min(address(musd)), address(ap), ISavingsMUSD(address(sav)));
        tm.setTrove(borrower, 0.1e18, 2_000e18); // ICR = 0.1 * 100k / 2000 = 5.0
        vm.prank(borrower); g = factory.createGovernor(3e18, 1.5e18);
        vm.prank(borrower); g.authorizeApp(app, 1_000e18, 400e18, uint64(block.timestamp + 30 days), address(0));
        musd.mint(borrower, 200e18);
        vm.startPrank(borrower); musd.approve(address(g), type(uint256).max); g.fund(100e18); vm.stopPrank();
        vm.deal(borrower, 1 ether);
    }

    function _draw(uint256 amt) internal {
        uint256 n = sigs.getNonce(borrower); uint256 dl = block.timestamp + 60; uint256 hdl = block.timestamp + 7 days;
        vm.prank(app); g.draw(amt, payee, dl, _w(amt, address(g), n, dl), hdl, _r(amt, n + 1, hdl));
    }
}
