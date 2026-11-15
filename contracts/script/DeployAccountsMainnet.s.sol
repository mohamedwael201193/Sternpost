// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TroveAccountMainnet} from "../src/account/TroveAccountMainnet.sol";
import {TroveAccountFactory} from "../src/account/TroveAccountFactory.sol";
import {Radar} from "../src/account/Radar.sol";
import {Batcher} from "../src/account/Batcher.sol";

/// @notice Task 1.10 mainnet deploy script: SCRIPT ONLY, NEVER broadcast.
///         Dry run on a mainnet fork:
///         forge script script/DeployAccountsMainnet.s.sol --fork-url
///         https://rpc-http.mezo.boar.network
///         (no --broadcast flag: the script executes locally against the
///         fork and prints the deployment plan + the addresses the deploys
///         WOULD land at. Nothing is sent to mainnet.)
///         Mainnet Mezo addresses are the proxies from the lab mainnet
///         rehearsal (lab/mainnet/rehearse.sh) and the resources doc.
///         The mainnet implementation caps every session budget at
///         MAX_SESSION_BUDGET = 20 MUSD (immutable).
contract DeployAccountsMainnet is Script {
    address constant BO = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
    address constant TM = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address constant PF = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;
    address constant MUSD = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
    address constant SMUSD = 0xb4D498029af77680cD1eF828b967f010d06C51CC;
    address constant SORTED = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;

    uint16 constant FEE_BPS = 10;
    uint256 constant MAX_SESSION_BUDGET = 20e18; // 20 MUSD per session, immutable

    function run()
        external
        returns (TroveAccountMainnet implementation, TroveAccountFactory factory, Radar radar, Batcher batcher)
    {
        require(block.chainid == 31612, "mainnet fork only");
        address feeRecipient = msg.sender;
        require(feeRecipient != address(0), "no fee recipient");
        console2.log("DRY RUN ONLY - nothing is broadcast to mainnet");
        console2.log("feeRecipient", feeRecipient);
        vm.startBroadcast();
        implementation = new TroveAccountMainnet(
            BO, TM, PF, MUSD, SMUSD, SORTED, feeRecipient, FEE_BPS, MAX_SESSION_BUDGET
        );
        factory = new TroveAccountFactory(address(implementation), feeRecipient, FEE_BPS);
        radar = new Radar(SORTED, TM, PF);
        batcher = new Batcher();
        vm.stopBroadcast();
        console2.log("TroveAccountMainnet implementation", address(implementation));
        console2.log("TroveAccountFactory", address(factory));
        console2.log("Radar", address(radar));
        console2.log("Batcher", address(batcher));
        console2.log("MAX_SESSION_BUDGET", MAX_SESSION_BUDGET);
    }
}
