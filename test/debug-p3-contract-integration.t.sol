// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import "../contracts/PipelineRegistryHarness.sol";
import "../contracts/PipelineRegistry.sol";

// =============================================================================
// MOCK PLATFORM - returns a fixed requestId; does not actually call any agent
// =============================================================================
contract MockPlatform {
    uint256 private _nextId = 1000;

    function createRequest(
        uint256 /*agentId*/,
        address /*callbackAddress*/,
        bytes4  /*callbackSelector*/,
        bytes calldata /*payload*/
    ) external payable returns (uint256 requestId) {
        return _nextId++;
    }

    function getRequestDeposit() external pure returns (uint256) {
        return 0.01 ether;
    }
}

// =============================================================================
// DEBUG-P3: Contract Integration Tests
// Tests pure/internal logic + contract lifecycle (mocked platform)
// =============================================================================
contract DebugP3ContractIntegration is Test {
    PipelineRegistryHarness public harness;

    // Somnia Platform address - harness is deployed using the REAL platform constant.
    // For local tests the platform bytecode doesn't exist, so we override with MockPlatform.
    MockPlatform public mockPlatform;

    function setUp() public {
        // Deploy mock platform at the address PipelineRegistry.PLATFORM expects
        address platformAddr = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
        mockPlatform = new MockPlatform();
        vm.etch(platformAddr, address(mockPlatform).code);

        // SDK-relay variant constructor takes relayAddress; use this test contract as relay
        harness = new PipelineRegistryHarness(address(this));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _containsExecute
    // ─────────────────────────────────────────────────────────────────────────

    function test_containsExecute_match() public view {
        bool result = harness.exposed_containsExecute("DECISION: EXECUTE\nREASONING: bullish");
        assertTrue(result, "Should detect EXECUTE");
    }

    function test_containsExecute_skip() public view {
        bool result = harness.exposed_containsExecute("DECISION: SKIP\nREASONING: bearish");
        assertFalse(result, "SKIP should not contain EXECUTE");
    }

    function test_containsExecute_empty() public view {
        bool result = harness.exposed_containsExecute("");
        assertFalse(result, "Empty string should return false");
    }

    function test_containsExecute_partialMatch() public view {
        // "EXECUTE" without "DECISION: " prefix - should still match
        bool result = harness.exposed_containsExecute("prefix DECISION: EXECUTE suffix");
        assertTrue(result, "Should match anywhere in string");
    }

    function test_containsExecute_caseSensitive() public view {
        // lowercase - should NOT match
        bool result = harness.exposed_containsExecute("decision: execute");
        assertFalse(result, "Case sensitive - lowercase should not match");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _interpolate
    // ─────────────────────────────────────────────────────────────────────────

    function test_interpolate_basic() public view {
        string memory result = harness.exposed_interpolate("price={prevResult}&path=close", "162763");
        assertEq(result, "price=162763&path=close", "Should replace {prevResult}");
    }

    function test_interpolate_noPrevResult() public view {
        string memory result = harness.exposed_interpolate("https://api.example.com/data", "unused");
        assertEq(result, "https://api.example.com/data", "No placeholder - template unchanged");
    }

    function test_interpolate_emptyValue() public view {
        string memory result = harness.exposed_interpolate("prefix_{prevResult}_suffix", "");
        assertEq(result, "prefix__suffix", "Should interpolate empty string");
    }

    function test_interpolate_onlyPlaceholder() public view {
        string memory result = harness.exposed_interpolate("{prevResult}", "hello");
        assertEq(result, "hello", "Only placeholder - full replacement");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _parseJsonApiInput
    // ─────────────────────────────────────────────────────────────────────────

    function test_parseJsonApiInput_valid() public view {
        (string memory url, string memory path, uint8 decimals) =
            harness.exposed_parseJsonApiInput(
                "https://api.coinpaprika.com/v1/tickers/eth-ethereum|quotes.USD.price|2"
            );
        assertEq(url, "https://api.coinpaprika.com/v1/tickers/eth-ethereum");
        assertEq(path, "quotes.USD.price");
        assertEq(decimals, 2);
    }

    function test_parseJsonApiInput_decimalZero() public view {
        (,, uint8 decimals) = harness.exposed_parseJsonApiInput("https://example.com|$.value|0");
        assertEq(decimals, 0, "Decimal 0 should parse correctly");
    }

    function test_parseJsonApiInput_onePipe_reverts() public {
        vm.expectRevert();
        harness.exposed_parseJsonApiInput("https://example.com|path");
    }

    function test_parseJsonApiInput_noPipe_reverts() public {
        vm.expectRevert();
        harness.exposed_parseJsonApiInput("https://example.com");
    }

    function test_parseJsonApiInput_nonNumericDecimals_reverts() public {
        vm.expectRevert();
        harness.exposed_parseJsonApiInput("https://example.com|path|abc");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _uint256ToString
    // ─────────────────────────────────────────────────────────────────────────

    function test_uint256ToString_zero() public view {
        assertEq(harness.exposed_uint256ToString(0), "0");
    }

    function test_uint256ToString_small() public view {
        assertEq(harness.exposed_uint256ToString(162763), "162763");
    }

    function test_uint256ToString_large() public view {
        assertEq(harness.exposed_uint256ToString(type(uint256).max),
            "115792089237316195423570985008687907853269984665640564039457584007913129639935");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _parseUint
    // ─────────────────────────────────────────────────────────────────────────

    function test_parseUint_valid() public view {
        assertEq(harness.exposed_parseUint("42"), 42);
    }

    function test_parseUint_zero() public view {
        assertEq(harness.exposed_parseUint("0"), 0);
    }

    function test_parseUint_nonNumeric_reverts() public {
        vm.expectRevert();
        harness.exposed_parseUint("abc");
    }

    function test_parseUint_empty_returns_zero() public view {
        // Empty string: loop body never executes → result stays 0
        assertEq(harness.exposed_parseUint(""), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _decodeResponse
    // ─────────────────────────────────────────────────────────────────────────

    function test_decodeResponse_llm_rawUtf8() public view {
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            agentId: 1,
            data: bytes("DECISION: EXECUTE\nREASONING: bullish")
        });
        string memory result = harness.exposed_decodeResponse(responses, 1); // AGENT_TYPE_LLM
        assertEq(result, "DECISION: EXECUTE\nREASONING: bullish");
    }

    function test_decodeResponse_jsonApi_uint256() public view {
        Response[] memory responses = new Response[](1);
        // 32-byte ABI-encoded uint256 for value 162763
        responses[0] = Response({ agentId: 0, data: abi.encode(uint256(162763)) });
        string memory result = harness.exposed_decodeResponse(responses, 0); // JSON_API
        assertEq(result, "162763");
    }

    function test_decodeResponse_empty_responses() public view {
        Response[] memory responses = new Response[](0);
        string memory result = harness.exposed_decodeResponse(responses, 1);
        assertEq(result, "");
    }

    function test_decodeResponse_emptyData() public view {
        Response[] memory responses = new Response[](1);
        responses[0] = Response({ agentId: 0, data: bytes("") });
        string memory result = harness.exposed_decodeResponse(responses, 0);
        assertEq(result, "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Contract lifecycle - register + state read
    // ─────────────────────────────────────────────────────────────────────────

    function test_registerPipeline_basic() public {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](3);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.coinpaprika.com/v1/tickers/eth-ethereum|quotes.USD.price|2",
            conditionalOnPrev: false,
            maxRetries: 1
        });
        steps[1] = PipelineRegistry.PipelineStepInput({
            agentType: 1,
            inputTemplate: "ETH price: {prevResult}",
            conditionalOnPrev: false,
            maxRetries: 1
        });
        steps[2] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.coinpaprika.com/v1/tickers/eth-ethereum|quotes.USD.volume_24h|0",
            conditionalOnPrev: true,
            maxRetries: 1
        });

        uint256 pipelineId = harness.registerPipeline{value: 0}(steps);
        assertEq(pipelineId, 1, "First pipeline should have ID 1");
        assertEq(harness.pipelineCount(), 1);
    }

    function test_registerPipeline_emptySteps_reverts() public {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](0);
        vm.expectRevert();
        harness.registerPipeline(steps);
    }

    function test_registerPipeline_tooManySteps_reverts() public {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](11); // max is 10
        vm.expectRevert();
        harness.registerPipeline(steps);
    }

    function test_fundPipeline_zeroValue_reverts() public {
        // Register first
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](1);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path|2",
            conditionalOnPrev: false,
            maxRetries: 0
        });
        harness.registerPipeline(steps);
        vm.expectRevert();
        harness.fundPipeline{value: 0}(1);
    }

    function test_triggerPipeline_unknownId_reverts() public {
        vm.expectRevert();
        harness.triggerPipeline(999);
    }

    function test_triggerPipeline_alreadyRunning_reverts() public {
        // Register and fund
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](1);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path|2",
            conditionalOnPrev: false,
            maxRetries: 0
        });
        harness.registerPipeline{value: 0.5 ether}(steps);
        vm.deal(address(harness), 10 ether);

        harness.triggerPipeline(1);
        vm.expectRevert();
        harness.triggerPipeline(1); // already running
    }

    function test_handleResponse_onlyPlatform() public {
        Response[] memory responses = new Response[](0);
        vm.prank(address(0xdead)); // not platform
        vm.expectRevert();
        harness.handleResponse(1, responses, ResponseStatus.Success, Request({
            agentId: 0,
            callbackAddress: address(0),
            callbackSelector: bytes4(0),
            payload: bytes("")
        }));
    }
}
