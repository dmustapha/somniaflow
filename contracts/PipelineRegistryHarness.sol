// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Test harness — exposes PipelineRegistry private functions as external for forge testing
// NOT deployed to any live network — test use only

import "./PipelineRegistry.sol";

contract PipelineRegistryHarness is PipelineRegistry {
    constructor(address relayAddress) PipelineRegistry(relayAddress) {}

    function exposed_containsExecute(string memory result) external pure returns (bool) {
        return _containsExecute(result);
    }

    function exposed_interpolate(string memory template, string memory value)
        external pure returns (string memory)
    {
        return _interpolate(template, value);
    }

    function exposed_parseJsonApiInput(string memory input)
        external pure returns (string memory url, string memory jsonPath, uint8 decimals)
    {
        return _parseJsonApiInput(input);
    }

    function exposed_uint256ToString(uint256 value) external pure returns (string memory) {
        return _uint256ToString(value);
    }

    function exposed_parseUint(string memory s) external pure returns (uint256) {
        return _parseUint(s);
    }

    function exposed_decodeResponse(Response[] memory responses, uint8 agentType)
        external pure returns (string memory)
    {
        return _decodeResponse(responses, agentType);
    }
}
