// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/PipelineRegistry.sol";
// ChainTest already deployed at 0x566f178Aa88BfC251C3e8be0A5cAB003D7692dfd — not re-deployed here

// SDK-relay variant: constructor takes only relayAddress (LLM_AGENT_ID is a constant now)
// Set via environment: RELAY_ADDRESS=<addr> forge script ...
contract Deploy is Script {
    function run() external {
        address relayAddress = vm.envAddress("RELAY_ADDRESS");
        require(relayAddress != address(0), "Deploy: RELAY_ADDRESS env var required");

        vm.startBroadcast();

        PipelineRegistry registry = new PipelineRegistry(relayAddress);
        console.log("PipelineRegistry deployed:", address(registry));

        vm.stopBroadcast();
    }

    // ChainTest deployed manually at T1.4 — see CONTRACT_ADDRESSES in BUILD-REPORT.md
}
