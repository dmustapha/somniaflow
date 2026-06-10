// relay-coordinator.ts
// Watches StepDispatched events on PipelineRegistry and executes real agent steps.
// Calls ownerHandleResponse() to inject results back into the contract.
// This replaces the broken Shannon Platform callback path.
//
// Flow per step:
//   triggerPipeline → _dispatchStep → PLATFORM.createRequest → StepDispatched
//   Relay hears StepDispatched → executes agent (JSON API / Claude) → ownerHandleResponse
//   ownerHandleResponse → StepCompleted + _advancePipeline → next StepDispatched
//   Repeat until PipelineComplete

import { ethers, Contract, Wallet } from "ethers";
import {
  AGENT_TYPE_JSON_API,
  AGENT_TYPE_LLM,
  AGENT_TYPE_PARSE_WEB,
  executeJsonApi,
  executeLlmInference,
  executeLlmParseWebsite,
} from "./relay-executor";

const RELAY_ABI = [
  "event StepDispatched(uint256 indexed pipelineId, uint256 step, uint8 agentType, uint256 requestId)",
  "event PipelineComplete(uint256 indexed pipelineId)",
  "event PipelineFailed(uint256 indexed pipelineId, uint256 step, string reason)",
  "function ownerHandleResponse(uint256 requestId, string calldata result) external",
  "function getPipelineState(uint256 pipelineId) external view returns (tuple(uint256 pipelineId, uint8 status, uint256 activeStep, uint8[] stepStatuses, uint256 sttBalance, string[] stepResults))",
  "function getPipelineSteps(uint256 pipelineId) external view returns (tuple(uint8 agentType, string inputTemplate, bool conditionalOnPrev, uint8 maxRetries)[])",
];

const HTTP_RPC         = process.env.NEXT_PUBLIC_RPC_URL ?? "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0xF1d42cC99604b1AE50322156AF1AE28db965Cbd6").trim();
const SHANNON_NETWORK  = new ethers.Network("somnia-shannon", 50312);

let _relayStarted = false;

export function isRelayStarted(): boolean {
  return _relayStarted;
}

export async function startRelayCoordinator(): Promise<void> {
  if (_relayStarted) return;

  const privateKey  = process.env.DEPLOYER_PRIVATE_KEY;
  const claudeApiKey  = process.env.ANTHROPIC_API_KEY ?? "";

  if (!privateKey) {
    console.warn("[Relay] DEPLOYER_PRIVATE_KEY not set — relay disabled");
    return;
  }
  if (!claudeApiKey) {
    console.warn("[Relay] ANTHROPIC_API_KEY not set — LLM steps will fail");
  }
  if (!REGISTRY_ADDRESS) {
    console.warn("[Relay] NEXT_PUBLIC_REGISTRY_ADDRESS not set — relay disabled");
    return;
  }

  _relayStarted = true;

  const provider = new ethers.JsonRpcProvider(HTTP_RPC, SHANNON_NETWORK, {
    staticNetwork: SHANNON_NETWORK,
  });
  const signer   = new Wallet(privateKey, provider);
  const contract = new Contract(REGISTRY_ADDRESS, RELAY_ABI, signer);

  console.log(`[Relay] started — registry=${REGISTRY_ADDRESS} wallet=${signer.address}`);

  contract.on(
    "StepDispatched",
    async (pipelineId: bigint, step: bigint, agentType: number, requestId: bigint) => {
      const pid    = pipelineId.toString();
      const stepN  = Number(step);
      const typeN  = Number(agentType);
      const reqId  = requestId.toString();

      console.log(`[Relay] StepDispatched pid=${pid} step=${stepN} type=${typeN} reqId=${reqId}`);

      try {
        // Read pipeline state to get the step's inputTemplate and prevResult
        const state      = await contract.getPipelineState(pipelineId);
        const results: string[]  = state.stepResults ?? state[5] ?? [];
        const prevResult = stepN > 0 ? (results[stepN - 1] ?? "") : "";

        // Re-read step definitions from the full pipeline state
        // Note: getPipelineState only returns PipelineStateView — no step definitions.
        // We need inputTemplate from on-chain. Use a separate query or embed in StepDispatched.
        // For now, read from our in-memory registry if available, else use a fallback query.
        // The relay-executor handles the execution once we have inputTemplate.
        const inputTemplate = await getStepInputTemplate(contract, pipelineId, step);

        // Execute the agent step
        let result: string;

        switch (typeN) {
          case AGENT_TYPE_JSON_API:
            result = await executeJsonApi(inputTemplate, prevResult);
            break;
          case AGENT_TYPE_LLM:
            result = await executeLlmInference(inputTemplate, prevResult, claudeApiKey);
            break;
          case AGENT_TYPE_PARSE_WEB:
            result = await executeLlmParseWebsite(inputTemplate, prevResult, claudeApiKey);
            break;
          default:
            throw new Error(`Unknown agentType: ${typeN}`);
        }

        console.log(`[Relay] injecting result for reqId=${reqId} result="${result.substring(0, 80)}"`);

        const tx      = await contract.ownerHandleResponse(requestId, result);
        const receipt = await tx.wait();
        console.log(`[Relay] ownerHandleResponse confirmed — tx=${receipt.hash} pid=${pid} step=${stepN}`);

      } catch (err) {
        console.error(`[Relay] error executing step pid=${pid} step=${stepN}:`, err);
        // Do not crash the relay — log and continue watching future events
      }
    }
  );

  contract.on("PipelineComplete", (pipelineId: bigint) => {
    console.log(`[Relay] PipelineComplete pid=${pipelineId}`);
  });

  contract.on("PipelineFailed", (pipelineId: bigint, step: bigint, reason: string) => {
    console.error(`[Relay] PipelineFailed pid=${pipelineId} step=${step} reason=${reason}`);
  });

  provider.on("error", (err: Error) => {
    console.error("[Relay] provider error:", err?.message ?? err);
    _relayStarted = false;
    setTimeout(() => startRelayCoordinator(), 5_000);
  });
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

// Cache: pipelineId → steps array (populated on first StepDispatched per pipeline)
const _stepCache: Map<string, Array<{ agentType: number; inputTemplate: string }>> = new Map();

async function getStepInputTemplate(
  contract:   Contract,
  pipelineId: bigint,
  step:       bigint
): Promise<string> {
  const pid   = pipelineId.toString();
  const stepN = Number(step);

  // Serve from cache if available
  const cached = _stepCache.get(pid);
  if (cached?.[stepN]) return cached[stepN].inputTemplate;

  // Fetch all step definitions via getPipelineSteps()
  const steps = await contract.getPipelineSteps(pipelineId);
  const mapped = steps.map((s: { agentType: bigint | number; inputTemplate: string }) => ({
    agentType:     Number(s.agentType),
    inputTemplate: s.inputTemplate,
  }));
  _stepCache.set(pid, mapped);
  return mapped[stepN]?.inputTemplate ?? "";
}
