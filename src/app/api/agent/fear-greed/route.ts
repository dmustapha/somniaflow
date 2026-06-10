import { NextRequest, NextResponse } from "next/server";

// somniaflow-agent-v1: Fear & Greed Index Agent
// Fetches the crypto Fear & Greed Index from alternative.me

export const dynamic = "force-dynamic";

const FEAR_GREED_API = "https://api.alternative.me/fng/?limit=1&format=json";

interface FGInput {
  include_history?: boolean;
}

function classifyIndex(value: number): string {
  if (value <= 20) return "Extreme Fear";
  if (value <= 40) return "Fear";
  if (value <= 60) return "Neutral";
  if (value <= 80) return "Greed";
  return "Extreme Greed";
}

export async function POST(req: NextRequest) {
  try {
    const body: FGInput = await req.json().catch(() => ({}));
    const limit = body.include_history ? 7 : 1;

    const res = await fetch(
      `https://api.alternative.me/fng/?limit=${limit}&format=json`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`Fear & Greed API HTTP ${res.status}`);

    const data = await res.json();
    const entries = data.data ?? [];
    const latest = entries[0];

    if (!latest) throw new Error("No data returned from Fear & Greed API");

    const value = parseInt(latest.value, 10);
    const classification = classifyIndex(value);

    return NextResponse.json({
      status: "ok",
      result: {
        value,
        classification,
        timestamp: latest.timestamp,
        history: limit > 1 ? entries.map((e: { value: string; timestamp: string }) => ({
          value: parseInt(e.value, 10),
          classification: classifyIndex(parseInt(e.value, 10)),
          timestamp: e.timestamp,
        })) : undefined,
      },
      resultType: "number",
      summary: `Fear & Greed Index: ${value} (${classification})`,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    version: "somniaflow-agent-v1",
    name: "Fear & Greed Agent",
    description: "Crypto market sentiment via the Fear & Greed Index. Returns current value (0-100) with classification.",
    endpoint: "/api/agent/fear-greed",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        include_history: { type: "boolean", default: false, description: "Include 7-day history" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        result: { type: "object" },
        resultType: { type: "string", enum: ["number"] },
        summary: { type: "string" },
      },
    },
    resultType: "number",
  });
}
