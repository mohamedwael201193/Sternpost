// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SpendWallet} from "../../src/SpendWallet.sol";
import {MockMUSD} from "../mocks/MockMezo.sol";

contract SpendWalletTest is Test {
    SpendWallet w; uint256 agentPk = 0xA6E; address agent; address owner = address(0x0A); MockMUSD musd;

    function setUp() public {
        vm.warp(1_800_000_000);
        agent = vm.addr(agentPk); musd = new MockMUSD();
        w = new SpendWallet(owner, agent, uint64(block.timestamp + 1 hours));
        musd.mint(address(w), 10e18);
    }
    function _sig(uint256 pk, bytes32 h) internal pure returns (bytes memory) { (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h); return abi.encodePacked(r, s, v); }

    function test_validAgentSignature() public view { assertEq(w.isValidSignature(keccak256("x"), _sig(agentPk, keccak256("x"))), bytes4(0x1626ba7e)); }
    function test_wrongSigner() public view { assertEq(w.isValidSignature(keccak256("x"), _sig(0xDEAD, keccak256("x"))), bytes4(0xffffffff)); }
    function test_expiredAgent() public { vm.warp(block.timestamp + 2 hours); assertEq(w.isValidSignature(keccak256("x"), _sig(agentPk, keccak256("x"))), bytes4(0xffffffff)); }
    function test_revokedAgent() public { vm.prank(owner); w.revokeAgent(); assertEq(w.isValidSignature(keccak256("x"), _sig(agentPk, keccak256("x"))), bytes4(0xffffffff)); }
    function test_badLength() public view { assertEq(w.isValidSignature(keccak256("x"), hex"01"), bytes4(0xffffffff)); }
    function test_budgetAndSweep() public {
        vm.startPrank(owner);
        w.setBudget(address(musd), 5e18); assertEq(musd.allowance(address(w), w.PERMIT2()), 5e18);
        w.sweep(address(musd), 10e18); assertEq(musd.balanceOf(owner), 10e18);
        w.setAgent(address(0x1), uint64(block.timestamp + 1)); assertEq(w.agent(), address(0x1));
        vm.stopPrank();
    }
    function test_onlyOwner() public {
        vm.expectRevert(SpendWallet.OnlyOwner.selector); w.sweep(address(musd), 1);
        vm.expectRevert(SpendWallet.OnlyOwner.selector); w.setBudget(address(musd), 1);
        vm.expectRevert(SpendWallet.OnlyOwner.selector); w.revokeAgent();
        vm.expectRevert(SpendWallet.OnlyOwner.selector); w.setAgent(address(1), 1);
    }

    function test_setBudget_approveFalse_reverts() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.approve.selector), abi.encode(false));
        vm.prank(owner);
        vm.expectRevert(SpendWallet.TransferFailed.selector);
        w.setBudget(address(musd), 1e18);
    }
    function test_sweep_transferFalse_reverts() public {
        vm.mockCall(address(musd), abi.encodeWithSelector(MockMUSD.transfer.selector), abi.encode(false));
        vm.prank(owner);
        vm.expectRevert(SpendWallet.TransferFailed.selector);
        w.sweep(address(musd), 1e18);
    }
    function test_highS_malleatedSignature_rejected() public view {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, keccak256("x"));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory mal = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        assertEq(w.isValidSignature(keccak256("x"), mal), bytes4(0xffffffff));
    }
}
