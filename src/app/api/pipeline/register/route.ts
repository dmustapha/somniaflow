// [VERIFIED] — Next.js 14 App Router route handler pattern
import { NextRequest, NextResponse } from "next/server";
import { registerPipeline } from "@/lib/pipeline-service";
import { checkApiKey } from "@/lib/auth";
import type { PipelineStepInput } from "@/types";

export async function POST(req: NextRequest) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let steps: PipelineStepInput[];
  try {
    const body = await req.json();
    steps      = body.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: "steps must be a non-empty array" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const result = await registerPipeline(steps);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "registration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
