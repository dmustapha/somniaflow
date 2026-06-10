import { NextRequest, NextResponse } from "next/server";

// somniaflow-agent-v1: Market Data Agent
// Aggregates multi-source market data: top movers, global stats, trending coins

export const dynamic = "force-dynamic";

const COINGECKO_API = "https://api.coingecko.com/api/v3";

interface MarketInput {
  category?: "top_movers" | "global" | "trending";
  limit?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body: MarketInput = await req.json().catch(() => ({}));
    const category = body.category ?? "top_movers";
    const rawLimit = typeof body.limit === "number" ? body.limit : 5;
    const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 20);

    if (category === "global") {
      const res = await fetch(`${COINGECKO_API}/global`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      const g = data.data;
      return NextResponse.json({
        status: "ok",
        result: {
          total_market_cap_usd: g.total_market_cap?.usd ?? 0,
          total_volume_24h_usd: g.total_volume?.usd ?? 0,
          btc_dominance: g.market_cap_percentage?.btc ?? 0,
          eth_dominance: g.market_cap_percentage?.eth ?? 0,
          active_cryptocurrencies: g.active_cryptocurrencies ?? 0,
          market_cap_change_24h: g.market_cap_change_percentage_24h_usd ?? 0,
        },
        resultType: "json",
        summary: `Global: $${((g.total_market_cap?.usd ?? 0) / 1e12).toFixed(2)}T market cap, BTC ${(g.market_cap_percentage?.btc ?? 0).toFixed(1)}% dominance`,
      });
    }

    if (category === "trending") {
      const res = await fetch(`${COINGECKO_API}/search/trending`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      const coins = (data.coins ?? []).slice(0, limit).map((c: { item: { name: string; symbol: string; market_cap_rank: number } }) => ({
        name: c.item.name,
        symbol: c.item.symbol,
        rank: c.item.market_cap_rank,
      }));
      return NextResponse.json({
        status: "ok",
        result: { trending: coins },
        resultType: "json",
        summary: `Trending: ${coins.map((c: { symbol: string }) => c.symbol).join(", ")}`,
      });
    }

    // Default: top_movers
    const res = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const coins = await res.json();

    const result = (coins as Array<{
      id: string; symbol: string; current_price: number;
      price_change_percentage_24h: number; market_cap: number;
    }>).map(c => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      price: c.current_price,
      change_24h: c.price_change_percentage_24h ?? 0,
      market_cap: c.market_cap,
    }));

    return NextResponse.json({
      status: "ok",
      result: { coins: result },
      resultType: "json",
      summary: result.map(c => `${c.symbol}: $${c.price.toLocaleString()} (${c.change_24h > 0 ? "+" : ""}${c.change_24h.toFixed(1)}%)`).join(", "),
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
    name: "Market Data Agent",
    description: "Aggregated crypto market data: top movers by market cap, global market stats, or trending coins.",
    endpoint: "/api/agent/market-data",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["top_movers", "global", "trending"], default: "top_movers" },
        limit: { type: "number", default: 5, description: "Number of results (max 20)" },
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
