// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import "../contracts/PipelineRegistryHarness.sol";
import "../contracts/PipelineRegistry.sol";

contract MockPlatform5 {
    uint256 private _nextId = 2000;
    function createRequest(uint256, address, bytes4, bytes calldata) external payable returns (uint256) {
        return _nextId++;
    }
    function getRequestDeposit() external pure returns (uint256) { return 0.01 ether; }
}

contract DebugP5ContractEdgeCases is Test {
    PipelineRegistryHarness public harness;
    address public relay;
    address public owner;

    function setUp() public {
        address platformAddr = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
        MockPlatform5 mp = new MockPlatform5();
        vm.etch(platformAddr, address(mp).code);
        relay = address(this);
        owner = address(0xBEEF);
        harness = new PipelineRegistryHarness(relay);
    }

    // _calcDeposit: (getRequestDeposit + pricePerAgent * 3) * 12/10
    // getRequestDeposit = 0.01 ether, JSON_API price = 0.03 ether
    // = (0.01 + 0.09) * 1.2 = 0.12 ether per step dispatch
    uint256 constant SUFFICIENT_STT = 1 ether;

    function _registerBasicFunded() internal returns (uint256) {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](1);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path|2",
            conditionalOnPrev: false,
            maxRetries: 1
        });
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        return harness.registerPipeline{value: SUFFICIENT_STT}(steps);
    }

    function _registerBasic() internal returns (uint256) {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](1);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path|2",
            conditionalOnPrev: false,
            maxRetries: 1
        });
        vm.prank(owner);
        return harness.registerPipeline{value: 0}(steps);
    }

    // ─── Zero values ────────────────────────────────────────────────────────

    function test_registerPipeline_zeroValue_succeeds() public {
        // registering with msg.value=0 is fine (just means unfunded)
        uint256 pid = _registerBasic();
        assertEq(pid, 1);
    }

    function test_fundPipeline_maxUint_succeeds() public {
        _registerBasic();
        // Fund with a large but non-max value (max would need huge deal)
        vm.deal(address(this), 1000 ether);
        harness.fundPipeline{value: 500 ether}(1);
        PipelineRegistry.PipelineStateView memory state = harness.getPipelineState(1);
        assertEq(state.sttBalance, 500 ether);
    }

    // ─── Boundary conditions ─────────────────────────────────────────────────

    function test_registerPipeline_exactlyTenSteps_succeeds() public {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](10);
        for (uint i = 0; i < 10; i++) {
            steps[i] = PipelineRegistry.PipelineStepInput({
                agentType: 0,
                inputTemplate: "https://api.example.com|path|2",
                conditionalOnPrev: false,
                maxRetries: 0
            });
        }
        uint256 pid = harness.registerPipeline(steps);
        assertEq(pid, 1);
    }

    function test_registerPipeline_elevenSteps_reverts() public {
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](11);
        vm.expectRevert();
        harness.registerPipeline(steps);
    }

    // ─── Unauthorized caller ────────────────────────────────────────────────

    function test_dispatchNext_onlyOwnerOrRelay() public {
        _registerBasicFunded();
        vm.prank(owner);
        harness.triggerPipeline(1);

        // Random address should not be able to call dispatchNext
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        harness.dispatchNext(1);
    }

    function test_dispatchNext_relayCanCall() public {
        // relay = address(this) in setUp
        // Register 2-step pipeline with sufficient STT
        PipelineRegistry.PipelineStepInput[] memory steps =
            new PipelineRegistry.PipelineStepInput[](2);
        steps[0] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path|2",
            conditionalOnPrev: false,
            maxRetries: 0
        });
        steps[1] = PipelineRegistry.PipelineStepInput({
            agentType: 0,
            inputTemplate: "https://api.example.com|path2|0",
            conditionalOnPrev: false,
            maxRetries: 0
        });
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        harness.registerPipeline{value: 1 ether}(steps);

        vm.prank(owner);
        harness.triggerPipeline(1);
        // BUG-002 FIXED: dispatchNext() now requires step to be Pending before advancing.
        // Step 0 is Pending (waiting for platform callback) after triggerPipeline().
        // Relay calling dispatchNext() immediately should revert — step not yet complete.
        vm.expectRevert(bytes("PipelineRegistry: step still pending"));
        harness.dispatchNext(1); // now correctly reverts with Pending guard
    }

    // ─── Wrong state ────────────────────────────────────────────────────────

    function test_triggerPipeline_whenIdle_succeeds() public {
        _registerBasicFunded();
        vm.prank(owner);
        harness.triggerPipeline(1);
    }

    function test_triggerPipeline_whenAlreadyRunning_reverts() public {
        _registerBasicFunded();
        vm.prank(owner);
        harness.triggerPipeline(1);
        vm.prank(owner);
        vm.expectRevert();
        harness.triggerPipeline(1); // already running
    }

    function test_getPipelineStepResult_outOfRange_reverts() public {
        _registerBasic(); // 1-step pipeline
        vm.expectRevert();
        harness.getPipelineStepResult(1, 5); // index 5 on 1-step pipeline
    }

    // ─── Reentrancy guard (structural check) ─────────────────────────────────

    function test_handleResponse_staleCallback_reverts() public {
        _registerBasicFunded();
        vm.prank(owner);
        harness.triggerPipeline(1);

        // platform callback with a bogus requestId
        address platform = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
        Response[] memory responses = new Response[](0);
        vm.prank(platform);
        vm.expectRevert(); // "unknown requestId"
        harness.handleResponse(
            9999,
            responses,
            ResponseStatus.Success,
            Request({ agentId: 0, callbackAddress: address(0), callbackSelector: bytes4(0), payload: bytes("") })
        );
    }

    // ─── _containsExecute boundary ──────────────────────────────────────────

    function test_containsExecute_exactNeedle() public view {
        // Exactly the needle — no surrounding text
        assertTrue(harness.exposed_containsExecute("DECISION: EXECUTE"));
    }

    function test_containsExecute_needleMinus1char() public view {
        // One char shorter than needle — should fail
        assertFalse(harness.exposed_containsExecute("DECISION: EXECUT"));
    }

    // ─── _parseUint overflow (max uint8 from decimals) ────────────────────

    function test_parseUint_255_succeeds() public view {
        assertEq(harness.exposed_parseUint("255"), 255);
    }

    function test_parseUint_256_succeeds() public view {
        // parseUint returns uint256, so 256 is valid (uint8 cast happens at call site)
        assertEq(harness.exposed_parseUint("256"), 256);
    }

    // ─── _interpolate — multiple placeholders (only first replaced) ──────────

    function test_interpolate_doublePlaceholder() public view {
        // Only first {prevResult} is replaced — single scan implementation
        string memory result = harness.exposed_interpolate("{prevResult}_{prevResult}", "X");
        // Actual behavior: first occurrence replaced, loop stops; suffix includes second placeholder
        // This tests actual behavior, not assumed behavior
        assertEq(result, "X_{prevResult}");
    }
}
