import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Emergency reset requires an emergencyReset() function on the contract.
  // This will be added in the next contract deploy (Phase 1 addendum).
  // Until then, this endpoint documents the intent and returns 501.
  return NextResponse.json(
    {
      message: "Manual reset not yet implemented — emergencyReset() will be added in next contract deploy.",
      pipelineId: params.id,
    },
    { status: 501 }
  );
}
