// simulate.ts — shared pipeline simulation logic
// Extracted so both simulate/route.ts and stream/route.ts can use it.
// On Vercel serverless: call this in the SAME function that holds the SSE stream
// so pipelineBus.emit() and pipelineBus.on() share the same process.

import { pipelineBus } from "./event-bus";
import type { PipelineSSEEvent } from "@/types";

const DEMO_ETH_PRICE = "162763"; // price * 10^2 = 1627.63
const DEMO_VOLUME    = "11726439579";

function makeLLMResult(branch: "execute" | "skip"): string {
  if (branch === "execute") {
    return `DECISION: EXECUTE
REASONING: ETH is trading at $1627.63, which is 12.4% below its 30-day moving average of $1,858.40. The RSI is at 34, approaching oversold territory. Current market conditions suggest accumulating at this level with a 20% portfolio rebalancing is appropriate.
SWAP_AMOUNT_PCT: 20
CONFIDENCE: MEDIUM`;
  }
  return `DECISION: SKIP
REASONING: ETH is trading at $1627.63. Market shows elevated volatility with $11.7B daily volume. Current momentum is bearish — wait for stabilization before executing a rebalancing swap. Risk/reward does not favor immediate action.
SWAP_AMOUNT_PCT: 0
CONFIDENCE: MEDIUM`;
}

const fakeTx = () => "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export async function emitPipelineRun(id: string, branch: "execute" | "skip") {
  const emit  = (event: PipelineSSEEvent) => pipelineBus.emit(id, event);
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const startMs = Date.now();

  emit({ type: "pipeline_started", data: { pipelineId: id, stepCount: 3 } });
  await delay(300);

  emit({ type: "step_dispatched", data: { step: 0, agentType: "JSON_API", requestId: "sim_step0", timestamp: Date.now() } });
  await delay(4_000);

  const tx0 = fakeTx();
  emit({ type: "step_complete", data: { step: 0, result: DEMO_ETH_PRICE, durationMs: 4000, sttCost: "0.03", txHash: tx0 } });
  await delay(500);

  emit({ type: "step_dispatched", data: { step: 1, agentType: "LLM_INFERENCE", requestId: "sim_step1", timestamp: Date.now() } });
  await delay(500);

  const llmResult = makeLLMResult(branch);
  emit({ type: "step_reasoning", data: { step: 1, chunk: llmResult } });
  await delay(6_000);

  const tx1 = fakeTx();
  emit({ type: "step_complete", data: { step: 1, result: llmResult, durationMs: 6000, sttCost: "0.07", txHash: tx1 } });
  const decision = {
    decision:   (branch === "execute" ? "EXECUTE" : "SKIP") as "EXECUTE" | "SKIP",
    reasoning:  branch === "execute"
      ? "ETH below 30d MA by 12.4%, RSI oversold at 34"
      : "Elevated volatility, bearish momentum — wait for stabilization",
    swapPct:    branch === "execute" ? 20 : 0,
    confidence: "MEDIUM" as const,
  };
  emit({ type: "decision", data: decision });
  await delay(400);

  const txHashes = [tx0, tx1];

  if (branch === "execute") {
    emit({ type: "step_dispatched", data: { step: 2, agentType: "JSON_API", requestId: "sim_step2", timestamp: Date.now() } });
    await delay(4_000);
    const tx2 = fakeTx();
    txHashes.push(tx2);
    emit({ type: "step_complete", data: { step: 2, result: DEMO_VOLUME, durationMs: 4000, sttCost: "0.03", txHash: tx2 } });
    await delay(300);
  } else {
    emit({ type: "step_skipped", data: { step: 2 } });
    await delay(200);
  }

  const totalMs = Date.now() - startMs;
  emit({ type: "pipeline_complete", data: { pipelineId: id, totalMs, txHashes } });
}
