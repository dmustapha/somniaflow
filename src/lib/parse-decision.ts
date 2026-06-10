// Shared utility — used by pipeline-service.ts (server), pipeline page (client), and proof page (server)
import type { PipelineDecision } from "@/types";

export function parsePipelineDecision(llmResult: string): PipelineDecision {
  const isExecute = /DECISION:\s*EXECUTE/i.test(llmResult);

  // Capture everything after REASONING: up to the next structured field or end of string
  const reasoningMatch =
    llmResult.match(/REASONING:\s*([\s\S]+?)(?=\nCONFIDENCE:|\nDECISION:|\nSWAP_|$)/i)?.[1] ??
    llmResult.match(/REASONING:\s*([\s\S]+)/i)?.[1];
  const reasoning = reasoningMatch?.trim() ?? "No reasoning provided";

  const confMatch = llmResult.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i)?.[1]?.toUpperCase() as
    "HIGH" | "MEDIUM" | "LOW" | undefined;

  const swapMatch = llmResult.match(/SWAP_AMOUNT_PCT:\s*(\d+)/i)?.[1];
  const swapPct = swapMatch ? Number(swapMatch) : (isExecute ? 20 : 0);

  return {
    decision:   isExecute ? "EXECUTE" : "SKIP",
    reasoning,
    swapPct,
    confidence: confMatch ?? "MEDIUM",
  };
}
