// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../Base.t.sol";
import {SpendWallet} from "../../src/SpendWallet.sol";

contract FactoryUnitTest is MockBase {
    event SpendWalletCreated(address indexed owner, address wallet, address agent, uint64 expiry);

    function test_createSpendWallet_registersAndEmits() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.expectEmit(true, false, false, false, address(factory));
        emit SpendWalletCreated(borrower, address(0), address(0xA6), exp);
        vm.prank(borrower);
        SpendWallet w = factory.createSpendWallet(address(0xA6), exp);
        assertEq(w.owner(), borrower);
        assertEq(w.agent(), address(0xA6));
        assertEq(w.agentExpiry(), exp);
        address[] memory ws = factory.walletsOf(borrower);
        assertEq(ws.length, 1);
        assertEq(ws[0], address(w));
    }

    function test_walletsOf_tracksManyPerOwner_andIsolatesOwners() public {
        vm.startPrank(borrower);
        SpendWallet a = factory.createSpendWallet(address(1), uint64(block.timestamp + 1));
        SpendWallet b = factory.createSpendWallet(address(2), uint64(block.timestamp + 2));
        vm.stopPrank();
        address[] memory ws = factory.walletsOf(borrower);
        assertEq(ws.length, 2);
        assertEq(ws[0], address(a));
        assertEq(ws[1], address(b));
        assertEq(factory.walletsOf(attacker).length, 0);
    }

    function test_createGovernor_secondCallReverts() public {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(SternpostFactory.AlreadyCreated.selector, address(g)));
        factory.createGovernor(3e18, 1.5e18);
    }

    function test_predictGovernor_matchesDeployedAddress_forNewBorrower() public {
        address who = address(0xC0FFEE);
        address predicted = factory.predictGovernor(who, 2.5e18, 1.6e18);
        vm.prank(who);
        SternpostGovernor ng = factory.createGovernor(2.5e18, 1.6e18);
        assertEq(address(ng), predicted);
        assertEq(factory.governorOf(who), predicted);
        assertEq(ng.borrower(), who);
    }

    function test_constructor_storesWiring() public view {
        assertEq(address(factory.signatures()), address(sigs));
        assertEq(address(factory.musd()), address(musd));
        assertEq(factory.activePool(), address(ap));
        assertEq(address(factory.savings()), address(sav));
    }
}
