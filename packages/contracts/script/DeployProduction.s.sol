// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProphitVault} from "../src/ProphitVault.sol";

contract DeployProduction is Script {
    function run() external {
        // All values MUST come from env — no fallbacks
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address usdt = vm.envAddress("USDT_ADDRESS");

        // Adapter addresses to approve
        address adapterA = vm.envAddress("ADAPTER_A_ADDRESS");
        address adapterB = vm.envAddress("ADAPTER_B_ADDRESS");

        // Circuit breaker config (6-decimal USDT)
        uint256 dailyTradeLimit = vm.envOr("DAILY_TRADE_LIMIT", uint256(20));
        uint256 dailyLossLimit = vm.envOr("DAILY_LOSS_LIMIT", uint256(500e6)); // $500
        uint256 positionSizeCap = vm.envOr("POSITION_SIZE_CAP", uint256(200e6)); // $200
        uint256 cooldownSeconds = vm.envOr("COOLDOWN_SECONDS", uint256(30));

        address deployer = vm.addr(deployerKey);
        console2.log("Deployer:", deployer);
        console2.log("USDT:", usdt);
        console2.log("Agent:", agent);

        vm.startBroadcast(deployerKey);

        ProphitVault vault = new ProphitVault(usdt, agent);
        console2.log("ProphitVault:", address(vault));

        // Approve adapters
        vault.approveAdapter(adapterA);
        vault.approveAdapter(adapterB);
        console2.log("Approved adapter A:", adapterA);
        console2.log("Approved adapter B:", adapterB);

        // Set circuit breakers
        vault.setCircuitBreakers(dailyTradeLimit, dailyLossLimit, positionSizeCap, cooldownSeconds);
        console2.log("Circuit breakers set");

        vm.stopBroadcast();

        console2.log("--- Production Deployment Complete ---");
        console2.log("IMPORTANT: Deposit USDT manually after verifying contract");
    }
}
