import { NextRequest, NextResponse } from "next/server";

// somniaflow-agent-v1: Crypto Price Agent
// Fetches real-time crypto prices from CoinGecko (free, no API key needed)

export const dynamic = "force-dynamic";

const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Map common symbols to CoinGecko IDs
const SYMBOL_MAP: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", stt: "somnia",
  avax: "avalanche-2", bnb: "binancecoin", matic: "matic-network",
  dot: "polkadot", ada: "cardano", xrp: "ripple", link: "chainlink",
  uni: "uniswap", atom: "cosmos", near: "near", arb: "arbitrum",
};

interface PriceInput {
  symbol?: string;
  symbols?: string[];
  vs_currency?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: PriceInput = await req.json();
    const symbols = body.symbols ?? (body.symbol ? [body.symbol] : ["btc"]);
    const vsCurrency = body.vs_currency ?? "usd";

    const ids = symbols.map(s => SYMBOL_MAP[s.toLowerCase()] ?? s.toLowerCase());

    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=${ids.join(",")}&vs_currencies=${vsCurrency}&include_24hr_change=true&include_market_cap=true`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = await res.json();

    // Build structured output
    const prices: Record<string, { price: number; change_24h: number; market_cap: number }> = {};
    for (const id of ids) {
      const entry = data[id];
      if (entry) {
        prices[id] = {
          price: entry[vsCurrency] ?? 0,
          change_24h: entry[`${vsCurrency}_24h_change`] ?? 0,
          market_cap: entry[`${vsCurrency}_market_cap`] ?? 0,
        };
      }
    }

    return NextResponse.json({
      status: "ok",
      result: prices,
      resultType: "json",
      summary: ids.map(id => prices[id] ? `${id}: $${prices[id].price.toLocaleString()}` : `${id}: not found`).join(", "),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Manifest endpoint
export async function GET() {
  return NextResponse.json({
    version: "somniaflow-agent-v1",
    name: "Crypto Price Agent",
    description: "Real-time cryptocurrency prices from CoinGecko. Supports 15+ tokens with 24h change and market cap.",
    endpoint: "/api/agent/crypto-price",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Single token symbol (e.g. 'btc', 'eth')" },
        symbols: { type: "array", items: { type: "string" }, description: "Multiple token symbols" },
        vs_currency: { type: "string", default: "usd" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        result: { type: "object" },
        resultType: { type: "string", enum: ["json"] },
        summary: { type: "string" },
      },
    },
    resultType: "json",
  });
}
