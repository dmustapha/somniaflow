// Shared utility — used by pipeline-service.ts (server), pipeline page (client), and proof page (server)
import type { PipelineDecision } from "@/types";

export function parsePipelineDecision(llmResult: string): PipelineDecision {
  const isExecute  = llmResult.includes("DECISION: EXECUTE");
  const reasoning  = llmResult.match(/REASONING:\s*(.+)/)?.[1]?.trim() ?? "No reasoning provided";
  const swapPctStr = llmResult.match(/SWAP_AMOUNT_PCT:\s*(\d+)/)?.[1];
  const swapPct    = swapPctStr ? Math.min(100, Math.max(0, parseInt(swapPctStr, 10))) : 0;
  const confMatch  = llmResult.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/)?.[1] as
    "HIGH" | "MEDIUM" | "LOW" | undefined;
  return {
    decision:   isExecute ? "EXECUTE" : "SKIP",
    reasoning,
    swapPct:    isExecute ? swapPct : 0,
    confidence: confMatch ?? "LOW",
  };
}
