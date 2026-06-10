// simulate.ts — shared pipeline simulation logic
// Extracted so both simulate/route.ts and stream/route.ts can use it.
// On Vercel serverless: call this in the SAME function that holds the SSE stream
// so pipelineBus.emit() and pipelineBus.on() share the same process.

import { pipelineBus } from "./event-bus";
import type { PipelineSSEEvent } from "@/types";

function makeLLMResult(branch: "execute" | "skip"): string {
  if (branch === "execute") {
    return `DECISION: EXECUTE
REASONING: ETH is trading at $2,547, down 3.2% today but still above key support levels. Market sentiment is in the greed zone and trending upward. The risk assessment gave a passing score of 68/100. All three signals agree: this looks like a good time to enter a position.
SWAP_AMOUNT_PCT: 20
CONFIDENCE: MEDIUM`;
  }
  return `DECISION: SKIP
REASONING: ETH is down 3.2% and showing high volatility. Market sentiment is in the fear zone at 28/100 and falling. The risk score came back at 31/100, well below the safety threshold. Two out of three signals say wait. Better to sit this one out.
SWAP_AMOUNT_PCT: 0
CONFIDENCE: MEDIUM`;
}

function makeRiskEvalResult(branch: "execute" | "skip"): string {
  if (branch === "execute") {
    return `DECISION: EXECUTE
REASONING: Market momentum is strong at 72/100. Sentiment is in the greed zone. Trading volume is up 18% compared to last week. Overall risk score: 68/100, which clears the safety threshold of 55. All three indicators line up in favor of trading.
SWAP_AMOUNT_PCT: 15
CONFIDENCE: HIGH`;
  }
  return `DECISION: SKIP
REASONING: Market momentum is weak at 38/100 with bearish signals. Sentiment is in the fear zone. Trading volume is down 12% compared to last week. Overall risk score: 31/100, below the safety threshold of 55. Two out of three indicators say hold off.
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
      ? "Risk score 68/100 clears the safety threshold. All three indicators agree: good conditions for trading."
      : "Risk score 31/100 is below the safety threshold. Two out of three indicators say wait.",
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
