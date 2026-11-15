// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TroveAccount} from "../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../src/account/TroveAccountFactory.sol";
import {Radar} from "../src/account/Radar.sol";
import {Batcher} from "../src/account/Batcher.sol";

/// @notice Task 1.9 deploy script: TroveAccount implementation + Factory +
///         Radar + Batcher on Mezo testnet (31611) ONLY. Usage:
///         forge script script/DeployAccounts.s.sol --rpc-url mezo_testnet
///         --broadcast --private-key $PRIVATE_KEY
///         The deployer pays only gas (testnet gas price is ~146 wei).
///         Record the printed addresses + tx hashes in
///         shared/deployments/testnet.json (accounts section) and verify
///         each contract on Blockscout (see the task notes for the exact
///         verify commands).
contract DeployAccounts is Script {
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant SMUSD = 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16;
    address constant SORTED = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;

    uint16 constant FEE_BPS = 10;

    function run()
        external
        returns (TroveAccount implementation, TroveAccountFactory factory, Radar radar, Batcher batcher)
    {
        require(block.chainid == 31611, "testnet only");
        address feeRecipient = msg.sender;
        require(feeRecipient != address(0), "no fee recipient");
        vm.startBroadcast();
        implementation = new TroveAccount(BO, TM, PF, MUSD, SMUSD, SORTED, feeRecipient, FEE_BPS);
        factory = new TroveAccountFactory(address(implementation), feeRecipient, FEE_BPS);
        radar = new Radar(SORTED, TM, PF);
        batcher = new Batcher();
        vm.stopBroadcast();
        console2.log("TroveAccount implementation", address(implementation));
        console2.log("TroveAccountFactory", address(factory));
        console2.log("Radar", address(radar));
        console2.log("Batcher", address(batcher));
        console2.log("feeRecipient", feeRecipient);
        console2.log("feeBps", uint256(FEE_BPS));
    }
}
