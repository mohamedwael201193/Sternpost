// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SternpostFactory} from "../src/SternpostFactory.sol";
import {
    IERC20Min, IBorrowerOperationsSignatures, ITroveManager, IPriceFeed, IBorrowerOperations, ISavingsMUSD
} from "../src/interfaces/IMezo.sol";

/// @notice Deploys the factory against Mezo testnet (31611) contracts. Usage:
///         forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --private-key $MEZO_TESTNET_PK
contract Deploy is Script {
    address constant SIG = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant ACTIVE_POOL = 0x143A063F62340DA3A8bEA1C5642d18C6D0F7FF51;
    address constant SMUSD = 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16;

    function run() external returns (SternpostFactory f) {
        require(block.chainid == 31611, "testnet only");
        vm.startBroadcast();
        f = new SternpostFactory(IBorrowerOperationsSignatures(SIG), IBorrowerOperations(BO), ITroveManager(TM),
            IPriceFeed(PF), IERC20Min(MUSD), ACTIVE_POOL, ISavingsMUSD(SMUSD));
        vm.stopBroadcast();
        console2.log("factory", address(f));
    }
}
