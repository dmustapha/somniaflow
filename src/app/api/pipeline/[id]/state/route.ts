import { NextRequest, NextResponse } from "next/server";
import { getPipelineState, getStepDefinitions } from "@/lib/pipeline-service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Validate pipeline ID is a non-negative integer
    const id = params.id;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "pipelineId must be a non-negative integer" }, { status: 400 });
    }

    const [state, steps] = await Promise.all([
      getPipelineState(id),
      getStepDefinitions(id).catch(() => []),
    ]);
    return NextResponse.json({ ...state, steps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "state fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
