import { NextRequest, NextResponse } from "next/server";
import { getPipelineState, getStepDefinitions } from "@/lib/pipeline-service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [state, steps] = await Promise.all([
      getPipelineState(params.id),
      getStepDefinitions(params.id).catch(() => []),
    ]);
    return NextResponse.json({ ...state, steps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "state fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
