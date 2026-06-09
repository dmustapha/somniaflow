// relay-coordinator.ts
// SDK-relay pattern (Branch B): listens to StepCompleted events on PipelineRegistry
// and calls dispatchNext(pipelineId) to advance the FSM off-chain.
// Activated at Day 1 Gate Fail — handleResponse() does not re-dispatch internally.
// Started alongside startEventListener() from the SSE stream route.

import { ethers, Contract, Wallet } from "ethers";

const RELAY_ABI = [
  "event StepCompleted(uint256 indexed pipelineId, uint256 step, string result)",
  "event PipelineComplete(uint256 indexed pipelineId)",
  "event PipelineFailed(uint256 indexed pipelineId, uint256 step, string reason)",
  "function dispatchNext(uint256 pipelineId) external",
  "function getPipelineState(uint256 pipelineId) view returns (tuple(uint256,uint8,uint256,uint8[],uint256,string[]))",
];

const HTTP_RPC        = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS!;

// Pipeline status enum matching PipelineRegistry.sol
const STATUS_RUNNING = 1;

let _relayStarted = false;

function getSigner(): Wallet {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("[Relay] DEPLOYER_PRIVATE_KEY not set");
  const provider = new ethers.JsonRpcProvider(HTTP_RPC);
  return new Wallet(key, provider);
}

export async function startRelayCoordinator(): Promise<void> {
  if (_relayStarted) return;
  _relayStarted = true;

  if (!REGISTRY_ADDRESS) {
    console.error("[Relay] NEXT_PUBLIC_REGISTRY_ADDRESS not set — relay coordinator disabled");
    return;
  }

  // HTTP polling provider — WebSocketProvider fails network detection on Shannon
  const provider       = new ethers.JsonRpcProvider(HTTP_RPC);
  const pollContract   = new Contract(REGISTRY_ADDRESS, RELAY_ABI, provider);
  const signer         = getSigner();
  const signerContract = new Contract(REGISTRY_ADDRESS, RELAY_ABI, signer);

  console.log("[Relay] coordinator started (HTTP polling) — watching PipelineRegistry at", REGISTRY_ADDRESS);

  pollContract.on("StepCompleted", async (pipelineId: bigint, step: bigint, result: string) => {
    const id = pipelineId.toString();
    console.log(`[Relay] StepCompleted — pipeline=${id} step=${step} result_len=${result.length}`);

    try {
      // Read state to confirm pipeline is still Running and on the expected step
      const state = await signerContract.getPipelineState(pipelineId);
      // state tuple: (pipelineId, status, activePipelineStep, stepTypes, balance, results)
      const status     = Number(state[1]);
      const activeStep = Number(state[2]);

      if (status !== STATUS_RUNNING) {
        console.log(`[Relay] pipeline=${id} status=${status} (not Running) — skipping dispatchNext`);
        return;
      }

      if (activeStep !== Number(step)) {
        console.log(`[Relay] pipeline=${id} activeStep=${activeStep} != emitted step=${step} — skipping dispatchNext`);
        return;
      }

      console.log(`[Relay] dispatching step ${Number(step) + 1} for pipeline=${id}`);
      const tx = await signerContract.dispatchNext(pipelineId);
      console.log(`[Relay] dispatchNext tx sent — hash=${tx.hash}`);
      await tx.wait();
      console.log(`[Relay] dispatchNext confirmed — pipeline=${id} step=${Number(step) + 1} started`);
    } catch (err) {
      console.error(`[Relay] dispatchNext failed for pipeline=${id}:`, err);
    }
  });

  pollContract.on("PipelineComplete", (pipelineId: bigint) => {
    console.log(`[Relay] PipelineComplete — pipeline=${pipelineId.toString()}`);
  });

  pollContract.on("PipelineFailed", (pipelineId: bigint, step: bigint, reason: string) => {
    console.error(`[Relay] PipelineFailed — pipeline=${pipelineId.toString()} step=${step} reason=${reason}`);
  });

  provider.on("error", (err) => {
    console.error("[Relay] Provider error:", err.message ?? err);
    _relayStarted = false;
    setTimeout(() => startRelayCoordinator(), 5_000);
  });
}
