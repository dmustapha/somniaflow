import { NextRequest, NextResponse } from "next/server";
import { triggerPipeline, getPipelineState } from "@/lib/pipeline-service";
import { checkApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let pipelineId: string;
  try {
    const body = await req.json();
    if (!body.pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });
    pipelineId = String(body.pipelineId);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const state = await getPipelineState(pipelineId).catch(() => null);
  if (state?.status === "Running") {
    return NextResponse.json({ error: "Pipeline already running" }, { status: 400 });
  }

  // Pre-check STT balance to surface funding errors before the tx reverts
  if (state) {
    const sttBalance = parseFloat(state.sttBalance ?? "0");
    if (sttBalance < 0.05) {
      return NextResponse.json(
        { error: `Insufficient STT balance: ${sttBalance.toFixed(3)} STT. Fund the pipeline before triggering.` },
        { status: 402 }
      );
    }
  }

  try {
    const result = await triggerPipeline(pipelineId);
    return NextResponse.json({ ...result, pipelineId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "trigger failed";
    const status  = message.includes("Insufficient STT") ? 402 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
