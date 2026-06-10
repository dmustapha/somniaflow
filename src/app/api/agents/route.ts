import { NextResponse } from "next/server";
import { fetchSomniaAgents } from "@/lib/agent-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await fetchSomniaAgents();
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch agents" },
      { status: 500 }
    );
  }
}
