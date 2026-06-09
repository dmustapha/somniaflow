import { NextRequest, NextResponse } from "next/server";
import { getPipelineState } from "@/lib/pipeline-service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const state = await getPipelineState(params.id);
    return NextResponse.json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "state fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
