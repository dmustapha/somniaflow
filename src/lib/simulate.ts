// simulate.ts — shared pipeline simulation logic
// Extracted so both simulate/route.ts and stream/route.ts can use it.
// On Vercel serverless: call this in the SAME function that holds the SSE stream
// so pipelineBus.emit() and pipelineBus.on() share the same process.

import { pipelineBus } from "./event-bus";
import type { PipelineSSEEvent } from "@/types";

const DEMO_DATA_RESULT = "1627.63";
const DEMO_SECONDARY   = "11726439579";

function makeLLMResult(branch: "execute" | "skip"): string {
  if (branch === "execute") {
    return `DECISION: EXECUTE
REASONING: Input data value is 1627.63, which is 12.4% below the 30-day average. Signal strength is high and conditions favor proceeding with execution. All risk thresholds are within acceptable bounds.
SWAP_AMOUNT_PCT: 20
CONFIDENCE: MEDIUM`;
  }
  return `DECISION: SKIP
REASONING: Input data shows elevated volatility. Current signal strength does not meet execution threshold. Conditions favor waiting for confirmation before proceeding — risk/reward does not justify immediate action.
SWAP_AMOUNT_PCT: 0
CONFIDENCE: MEDIUM`;
}

const fakeTx = () => "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export async function emitPipelineRun(id: string, branch: "execute" | "skip", stepCount = 3) {
  const emit  = (event: PipelineSSEEvent) => pipelineBus.emit(id, event);
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const startMs = Date.now();

  emit({ type: "pipeline_started", data: { pipelineId: id, stepCount } });
  await delay(300);

  emit({ type: "step_dispatched", data: { step: 0, agentType: "JSON_API", requestId: "sim_step0", timestamp: Date.now() } });
  await delay(4_000);

  emit({ type: "step_complete", data: { step: 0, result: DEMO_DATA_RESULT, durationMs: 4000, sttCost: "0.03" } });
  await delay(500);

  emit({ type: "step_dispatched", data: { step: 1, agentType: "LLM_INFERENCE", requestId: "sim_step1", timestamp: Date.now() } });
  await delay(500);

  const llmResult = makeLLMResult(branch);
  emit({ type: "step_reasoning", data: { step: 1, chunk: llmResult } });
  await delay(6_000);

  emit({ type: "step_complete", data: { step: 1, result: llmResult, durationMs: 6000, sttCost: "0.07" } });
  const decision = {
    decision:   (branch === "execute" ? "EXECUTE" : "SKIP") as "EXECUTE" | "SKIP",
    reasoning:  branch === "execute"
      ? "Signal threshold met — proceeding with execution"
      : "Elevated volatility — waiting for confirmation",
    swapPct:    branch === "execute" ? 20 : 0,
    confidence: "MEDIUM" as const,
  };
  emit({ type: "decision", data: decision });
  await delay(400);

  if (stepCount > 2) {
    if (branch === "execute") {
      emit({ type: "step_dispatched", data: { step: 2, agentType: "JSON_API", requestId: "sim_step2", timestamp: Date.now() } });
      await delay(4_000);
      emit({ type: "step_complete", data: { step: 2, result: DEMO_SECONDARY, durationMs: 4000, sttCost: "0.03" } });
      await delay(300);
    } else {
      emit({ type: "step_skipped", data: { step: 2 } });
      await delay(200);
    }
  }

  const totalMs = Date.now() - startMs;
  emit({ type: "pipeline_complete", data: { pipelineId: id, totalMs, txHashes: [], simulated: true } });
}
