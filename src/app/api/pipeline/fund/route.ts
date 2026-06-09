import { NextRequest, NextResponse } from "next/server";
import { fundPipeline } from "@/lib/pipeline-service";

export async function POST(req: NextRequest) {
  let pipelineId: string;
  let amountEther: string;
  try {
    const body = await req.json();
    if (body.pipelineId == null || body.pipelineId === "") {
      return NextResponse.json({ error: "pipelineId and amountEther required" }, { status: 400 });
    }
    pipelineId  = String(body.pipelineId);
    amountEther = String(body.amountEther);
    if (!amountEther || amountEther === "undefined") {
      return NextResponse.json({ error: "pipelineId and amountEther required" }, { status: 400 });
    }
    if (isNaN(Number(amountEther)) || Number(amountEther) <= 0) {
      return NextResponse.json({ error: "amountEther must be a positive number" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const result = await fundPipeline(pipelineId, amountEther);
    return NextResponse.json({ ...result, pipelineId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "fund failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
