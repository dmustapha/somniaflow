// simulate.ts — shared pipeline simulation logic
// Extracted so both simulate/route.ts and stream/route.ts can use it.
// On Vercel serverless: call this in the SAME function that holds the SSE stream
// so pipelineBus.emit() and pipelineBus.on() share the same process.

import { pipelineBus } from "./event-bus";
import type { PipelineSSEEvent } from "@/types";

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

function makeRiskEvalResult(branch: "execute" | "skip"): string {
  if (branch === "execute") {
    return `DECISION: EXECUTE
REASONING: Algorithmic risk assessment: momentum score 72/100 (bullish), sentiment index 65 (greed zone), volume trend +18% above 7d avg. Composite risk score 68/100 passes execution threshold of 55. All three signal components align — favorable for position entry.
SWAP_AMOUNT_PCT: 15
CONFIDENCE: HIGH`;
  }
  return `DECISION: SKIP
REASONING: Algorithmic risk assessment: momentum score 38/100 (bearish divergence), sentiment index 28 (fear zone), volume trend -12% below 7d avg. Composite risk score 31/100 below execution threshold of 55. Two of three signals negative — hold position.
SWAP_AMOUNT_PCT: 0
CONFIDENCE: HIGH`;
}

const fakeTx = () => "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

/**
 * Emit a 4-step Market Intelligence pipeline simulation.
 * Steps: Crypto Price (External) → Fear & Greed (External) → Risk Eval (External) → AI Analysis (LLM)
 */
export async function emitPipelineRun(id: string, branch: "execute" | "skip", stepCount = 4) {
  const emit  = (event: PipelineSSEEvent) => pipelineBus.emit(id, event);
  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const startMs = Date.now();

  emit({ type: "pipeline_started", data: { pipelineId: id, stepCount } });
  await delay(300);

  // Step 0: Crypto Price Agent (External)
  emit({ type: "step_dispatched", data: { step: 0, agentType: "EXTERNAL", requestId: "sim_step0", timestamp: Date.now() } });
  await delay(3_000);
  const priceResult = JSON.stringify({ symbol: "ETH", price: 2547.83, change_24h: -3.2, market_cap: 306000000000 });
  emit({ type: "step_complete", data: { step: 0, result: priceResult, durationMs: 3000, sttCost: "0", txHash: fakeTx() } });
  await delay(400);

  // Step 1: Fear & Greed Agent (External)
  emit({ type: "step_dispatched", data: { step: 1, agentType: "EXTERNAL", requestId: "sim_step1", timestamp: Date.now() } });
  await delay(2_500);
  const fgResult = branch === "execute"
    ? JSON.stringify({ value: 65, classification: "Greed", trend: "rising" })
    : JSON.stringify({ value: 28, classification: "Fear", trend: "falling" });
  emit({ type: "step_complete", data: { step: 1, result: fgResult, durationMs: 2500, sttCost: "0", txHash: fakeTx() } });
  await delay(400);

  // Step 2: Risk Evaluation Agent (External — produces DECISION)
  emit({ type: "step_dispatched", data: { step: 2, agentType: "EXTERNAL", requestId: "sim_step2", timestamp: Date.now() } });
  await delay(2_000);
  const riskResult = makeRiskEvalResult(branch);
  emit({ type: "step_reasoning", data: { step: 2, chunk: riskResult } });
  await delay(4_000);
  emit({ type: "step_complete", data: { step: 2, result: riskResult, durationMs: 6000, sttCost: "0", txHash: fakeTx() } });
  const riskDecision = {
    decision:   (branch === "execute" ? "EXECUTE" : "SKIP") as "EXECUTE" | "SKIP",
    reasoning:  branch === "execute"
      ? "Composite risk score 68/100 passes threshold — all signals align"
      : "Composite risk score 31/100 below threshold — two signals negative",
    swapPct:    branch === "execute" ? 15 : 0,
    confidence: "HIGH" as const,
  };
  emit({ type: "decision", data: riskDecision });
  await delay(400);

  // Step 3: AI Analysis (LLM — conditional on risk eval decision)
  if (stepCount > 3) {
    if (branch === "execute") {
      emit({ type: "step_dispatched", data: { step: 3, agentType: "LLM_INFERENCE", requestId: "sim_step3", timestamp: Date.now() } });
      await delay(500);
      const llmResult = makeLLMResult(branch);
      emit({ type: "step_reasoning", data: { step: 3, chunk: llmResult } });
      await delay(5_000);
      emit({ type: "step_complete", data: { step: 3, result: llmResult, durationMs: 5500, sttCost: "0.07", txHash: fakeTx() } });
      await delay(300);
    } else {
      emit({ type: "step_skipped", data: { step: 3 } });
      await delay(200);
    }
  }

  const totalMs = Date.now() - startMs;
  emit({ type: "pipeline_complete", data: { pipelineId: id, totalMs, txHashes: [], simulated: true } });
}
