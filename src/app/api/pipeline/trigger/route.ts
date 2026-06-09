import { NextRequest, NextResponse } from "next/server";
import { triggerPipeline, getPipelineState } from "@/lib/pipeline-service";

export async function POST(req: NextRequest) {
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

  try {
    const result = await triggerPipeline(pipelineId);
    return NextResponse.json({ ...result, pipelineId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "trigger failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
