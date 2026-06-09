// simulate/route.ts — POST to emit a realistic pipeline run through the SSE bus
// Used for demo when Shannon Platform callbacks are delayed.
// Emits all 9 event types in sequence with realistic timing gaps.
// The on-chain contract state is real; this bridges the gap until callbacks arrive.
import { NextRequest, NextResponse } from "next/server";
import { emitPipelineRun } from "@/lib/simulate";

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
