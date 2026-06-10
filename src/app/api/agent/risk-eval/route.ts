import { NextRequest, NextResponse } from "next/server";

// somniaflow-agent-v1: Risk Evaluation Agent
// Algorithmic risk scoring — produces DECISION format without LLM
// Analyzes price + sentiment data and outputs EXECUTE/SKIP

export const dynamic = "force-dynamic";

interface RiskInput {
  price?: number;
  change_24h?: number;
  fear_greed?: number;
  volume_change?: number;
  threshold?: number;
}

function computeRiskScore(input: RiskInput): {
  score: number;
  components: Record<string, number>;
  decision: "EXECUTE" | "SKIP";
  reasoning: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
} {
  const price = input.price ?? 0;
  const change = input.change_24h ?? 0;
  const fg = input.fear_greed ?? 50;
  const volChange = input.volume_change ?? 0;
  const threshold = input.threshold ?? 60;

  // Component scores (0-100 each)
  // Price momentum: positive change = higher score
  const momentumScore = Math.min(100, Math.max(0, 50 + change * 5));
  // Sentiment: fear = low score, greed = high
  const sentimentScore = fg;
  // Volume: higher volume change = more conviction
  const volumeScore = Math.min(100, Math.max(0, 50 + volChange * 2));
  // Volatility penalty: extreme changes reduce confidence
  const volatilityPenalty = Math.min(30, Math.abs(change) > 10 ? Math.abs(change) - 10 : 0);

  const rawScore = (momentumScore * 0.35 + sentimentScore * 0.35 + volumeScore * 0.3) - volatilityPenalty;
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));

  const decision = score >= threshold ? "EXECUTE" : "SKIP";

  const confidence = Math.abs(score - threshold) > 20 ? "HIGH"
    : Math.abs(score - threshold) > 10 ? "MEDIUM" : "LOW";

  const parts: string[] = [];
  if (change > 0) parts.push(`positive 24h momentum (+${change.toFixed(1)}%)`);
  else parts.push(`negative 24h momentum (${change.toFixed(1)}%)`);
  if (fg > 60) parts.push(`greed sentiment (${fg})`);
  else if (fg < 40) parts.push(`fear sentiment (${fg})`);
  else parts.push(`neutral sentiment (${fg})`);
  parts.push(`risk score ${score}/${threshold} threshold`);

  const reasoning = `${parts.join(". ")}. ${decision === "EXECUTE" ? "Conditions favor execution." : "Conditions suggest waiting."}`;

  return {
    score,
    components: { momentum: momentumScore, sentiment: sentimentScore, volume: volumeScore, volatility_penalty: volatilityPenalty },
    decision,
    reasoning,
    confidence,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: RiskInput = await req.json().catch(() => ({}));
    const result = computeRiskScore(body);

    return NextResponse.json({
      status: "ok",
      result: {
        score: result.score,
        components: result.components,
        decision: result.decision,
        reasoning: result.reasoning,
        confidence: result.confidence,
      },
      resultType: "decision",
      summary: `DECISION: ${result.decision}\nREASONING: ${result.reasoning}\nCONFIDENCE: ${result.confidence}`,
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
    name: "Risk Evaluation Agent",
    description: "Algorithmic risk scorer. Analyzes price, sentiment, and volume to produce EXECUTE/SKIP decisions without LLM.",
    endpoint: "/api/agent/risk-eval",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        price: { type: "number", description: "Current asset price" },
        change_24h: { type: "number", description: "24h price change percentage" },
        fear_greed: { type: "number", description: "Fear & Greed Index (0-100)" },
        volume_change: { type: "number", description: "24h volume change percentage" },
        threshold: { type: "number", default: 60, description: "Risk score threshold for EXECUTE" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        result: { type: "object" },
        resultType: { type: "string", enum: ["decision"] },
        summary: { type: "string" },
      },
    },
    resultType: "decision",
  });
}
