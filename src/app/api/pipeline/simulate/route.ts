// simulate/route.ts — POST to emit a realistic pipeline run through the SSE bus
// Used for demo when Shannon Platform callbacks are delayed.
// Emits all 9 event types in sequence with realistic timing gaps.
// The on-chain contract state is real; this bridges the gap until callbacks arrive.
import { NextRequest, NextResponse } from "next/server";
import { pipelineBus } from "@/lib/event-bus";
import type { PipelineSSEEvent } from "@/types";

const DEMO_ETH_PRICE   = "162763"; // CoinPaprika fetchUint result (price * 10^2 = 1627.63)
const DEMO_VOLUME      = "11726439579"; // volume_24h * 10^0

// LLM decision based on price — varies by branch param
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

// Generate a realistic-looking fake transaction hash for demo runs
const fakeTx = () => "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// Emit events with realistic delays to mimic Shannon agent round-trips
async function emitPipelineRun(id: string, branch: "execute" | "skip") {
  const emit = (event: PipelineSSEEvent) => pipelineBus.emit(id, event);
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const startMs = Date.now();

  // Pipeline starts
  emit({ type: "pipeline_started", data: { pipelineId: id, stepCount: 3 } });
  await delay(300);

  // Step 0 — JSON API dispatch
  emit({ type: "step_dispatched", data: { step: 0, agentType: "JSON_API", requestId: "sim_step0", timestamp: Date.now() } });
  await delay(4_000); // Simulate Shannon agent round-trip

  // Step 0 complete — ETH price
  const tx0 = fakeTx();
  emit({ type: "step_complete", data: { step: 0, result: DEMO_ETH_PRICE, durationMs: 4000, sttCost: "0.03", txHash: tx0 } });
  await delay(500);

  // Step 1 — LLM dispatch
  emit({ type: "step_dispatched", data: { step: 1, agentType: "LLM_INFERENCE", requestId: "sim_step1", timestamp: Date.now() } });
  await delay(500);

  // Step 1 streaming LLM output
  const llmResult = makeLLMResult(branch);
  emit({ type: "step_reasoning", data: { step: 1, chunk: llmResult } });
  await delay(6_000); // LLM takes longer

  // Step 1 complete — LLM decision (6s delay above gives WordReveal plenty of time to animate)
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
    // Step 2 — conditional JSON API dispatch (EXECUTE branch)
    emit({ type: "step_dispatched", data: { step: 2, agentType: "JSON_API", requestId: "sim_step2", timestamp: Date.now() } });
    await delay(4_000);

    // Step 2 complete — volume data
    const tx2 = fakeTx();
    txHashes.push(tx2);
    emit({ type: "step_complete", data: { step: 2, result: DEMO_VOLUME, durationMs: 4000, sttCost: "0.03", txHash: tx2 } });
    await delay(300);
  } else {
    // Step 2 — skipped (SKIP branch)
    emit({ type: "step_skipped", data: { step: 2 } });
    await delay(200);
  }

  // Pipeline complete
  const totalMs = Date.now() - startMs;
  emit({ type: "pipeline_complete", data: { pipelineId: id, totalMs, txHashes } });
}

export async function POST(req: NextRequest) {
  let pipelineId: string;
  let branch: "execute" | "skip";

  try {
    const body = await req.json();
    pipelineId = String(body.pipelineId ?? "");
    branch     = body.branch === "skip" ? "skip" : "execute";
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!pipelineId) {
    return NextResponse.json({ error: "pipelineId required" }, { status: 400 });
  }

  // Run in background — don't await (SSE consumers listen asynchronously)
  emitPipelineRun(pipelineId, branch).catch(e =>
    console.error("[Simulate] emitPipelineRun error:", e)
  );

  return NextResponse.json({ ok: true, pipelineId, branch, message: "Simulation started — watch SSE stream" });
}
