// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SternpostFactory} from "../src/SternpostFactory.sol";
import {SternpostGovernor} from "../src/SternpostGovernor.sol";
import {SpendWallet} from "../src/SpendWallet.sol";

/// @notice Creates the Classic governor + spend wallet against an already-deployed
///         SternpostFactory on Mezo testnet (31611). Usage:
///         STERNPOST_FACTORY=0x... forge script script/DeployClassicSetup.s.sol \
///           --rpc-url mezo_testnet --broadcast --private-key $MEZO_TESTNET_PK
///         Governor policy is the Wave 2 default: floor 250%, defend 160%.
///         Spend wallet agent is the Wave 1 app agent address; expiry is +30 days.
contract DeployClassicSetup is Script {
    address constant AGENT = 0x62a4773191747994c0368664cA68BC476897c1d9;

    function run() external returns (SternpostGovernor g, SpendWallet w) {
        require(block.chainid == 31611, "testnet only");
        address factoryAddr = vm.envAddress("STERNPOST_FACTORY");
        require(factoryAddr != address(0), "STERNPOST_FACTORY unset");
        vm.startBroadcast();
        SternpostFactory f = SternpostFactory(factoryAddr);
        g = f.createGovernor(2.5e18, 1.6e18);
        w = f.createSpendWallet(AGENT, uint64(block.timestamp + 30 days));
        vm.stopBroadcast();
        console2.log("governor", address(g));
        console2.log("spendWallet", address(w));
    }
}
