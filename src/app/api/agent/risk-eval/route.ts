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
  sentiment?: string;
  prevResult?: string;
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

  // 4-component risk scoring (0-100 total)
  // 1. Sentiment Risk (0-40): extreme fear or greed = higher risk
  let sentimentRisk = 15; // neutral baseline
  if (fg < 20) sentimentRisk = 40;
  else if (fg < 35) sentimentRisk = 30;
  else if (fg < 50) sentimentRisk = 15;
  else if (fg < 65) sentimentRisk = 5;
  else if (fg < 80) sentimentRisk = 15;
  else sentimentRisk = 35;

  // 2. Price Stability Risk (0-30)
  let priceRisk = 10; // base
  if (price > 0) {
    const nearest1k = Math.round(price / 1000) * 1000;
    if (Math.abs(price - nearest1k) / nearest1k < 0.005) priceRisk += 10;
    if (price > 100000) priceRisk += 5;
    if (price < 1000 && price > 0) priceRisk += 5;
  }

  // 3. Timing Risk (0-15)
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  let timingRisk = 0;
  if (day === 0 || day === 6) timingRisk += 10;
  if (hour >= 20 || hour < 8) timingRisk += 5;

  // 4. Volatility Proxy (0-15): uses 24h change and volume change as proxy
  let volatilityRisk = 0;
  const absChange = Math.abs(change);
  if (absChange > 10) volatilityRisk = 15;
  else if (absChange > 5) volatilityRisk = 8;
  if (Math.abs(volChange) > 20) volatilityRisk = Math.min(15, volatilityRisk + 5);

  const rawScore = sentimentRisk + priceRisk + timingRisk + volatilityRisk;
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));

  // Higher score = higher risk = SKIP. Lower score = safer = EXECUTE
  const decision = score < threshold ? "EXECUTE" : "SKIP";

  const confidence = Math.abs(score - threshold) > 20 ? "HIGH"
    : Math.abs(score - threshold) > 10 ? "MEDIUM" : "LOW";

  const parts: string[] = [];
  parts.push(`sentiment risk ${sentimentRisk}/40 (F&G: ${fg})`);
  parts.push(`price stability ${priceRisk}/30`);
  parts.push(`timing ${timingRisk}/15`);
  parts.push(`volatility ${volatilityRisk}/15`);
  parts.push(`total risk ${score}/${threshold} threshold`);

  const reasoning = `${parts.join(". ")}. ${decision === "EXECUTE" ? "Risk within acceptable range." : "Risk exceeds threshold, suggest waiting."}`;

  return {
    score,
    components: { sentiment_risk: sentimentRisk, price_stability: priceRisk, timing: timingRisk, volatility: volatilityRisk },
    decision,
    reasoning,
    confidence,
  };
}

function extractFromPrev(body: RiskInput): RiskInput {
  // Try to extract typed fields from prevResult or sentiment strings
  const raw = body.prevResult ?? body.sentiment ?? "";
  if (!raw) return body;

  // Attempt JSON parse (relay passes structured result as JSON)
  try {
    const parsed = JSON.parse(raw);
    return {
      ...body,
      fear_greed: body.fear_greed ?? parsed.value ?? parsed.fear_greed,
      price: body.price ?? parsed.price,
      change_24h: body.change_24h ?? parsed.change_24h,
      volume_change: body.volume_change ?? parsed.volume_change,
    };
  } catch { /* not JSON, try regex */ }

  // Regex fallback: extract number from text like "Fear & Greed Index: 9 (Extreme Fear)"
  if (body.fear_greed == null) {
    const fgMatch = raw.match(/(?:index|f&g|fear.*greed)[:\s]+(\d+)/i)
      ?? raw.match(/^(\d{1,3})$/);
    if (fgMatch) return { ...body, fear_greed: parseInt(fgMatch[1], 10) };
  }

  return body;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody: RiskInput = await req.json().catch(() => ({}));
    const body = extractFromPrev(rawBody);
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
