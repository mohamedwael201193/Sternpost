// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SternpostRouter} from "../src/routes/SternpostRouter.sol";
import {IFactoryView, IMUSDSavingsRate, IMezoRouter} from "../src/interfaces/IRoutes.sol";
import {IBorrowerOperationsSignatures, IERC20Min} from "../src/interfaces/IMezo.sol";

/// @notice Deploys SternpostRouter against live Mezo testnet targets (chain 31611 only).
contract DeployRouter is Script {
    function run() external returns (SternpostRouter r) {
        require(block.chainid == 31611, "testnet only");
        vm.startBroadcast(vm.envUint("MEZO_TESTNET_PK"));
        r = new SternpostRouter(
            IFactoryView(0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980),
            IBorrowerOperationsSignatures(0xD757e3646AF370b15f32EB557F0F8380Df7D639e),
            IERC20Min(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503),
            IMUSDSavingsRate(0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16),
            IMezoRouter(0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9),
            0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A,
            IERC20Min(0x7b7C000000000000000000000000000000000000),
            false
        );
        vm.stopBroadcast();
        console2.log("SternpostRouter", address(r));
    }
}
