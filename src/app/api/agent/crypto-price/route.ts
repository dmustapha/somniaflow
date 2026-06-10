import { NextRequest, NextResponse } from "next/server";

// somniaflow-agent-v1: Crypto Price Agent
// Fetches real-time crypto prices from CoinGecko, Binance, and CoinPaprika
// Averages multiple sources for reliability, discards outliers

export const dynamic = "force-dynamic";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const BINANCE_API = "https://api.binance.com/api/v3";
const COINPAPRIKA_API = "https://api.coinpaprika.com/v1";

// Map common symbols to API IDs
const CG_MAP: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", stt: "somnia",
  avax: "avalanche-2", bnb: "binancecoin", matic: "matic-network",
  dot: "polkadot", ada: "cardano", xrp: "ripple", link: "chainlink",
  uni: "uniswap", atom: "cosmos", near: "near", arb: "arbitrum",
};
const CP_MAP: Record<string, string> = {
  btc: "btc-bitcoin", eth: "eth-ethereum", sol: "sol-solana",
  avax: "avax-avalanche", bnb: "bnb-binance-coin", matic: "matic-polygon",
  dot: "dot-polkadot", ada: "ada-cardano", xrp: "xrp-xrp", link: "link-chainlink",
  uni: "uni-uniswap", atom: "atom-cosmos", near: "near-near-protocol", arb: "arb-arbitrum",
};

// 30-second cache per symbol
const _cache = new Map<string, { data: SourceResult; expires: number }>();

interface SourceResult {
  price: number;
  change_24h: number;
  market_cap: number;
  source: string;
}

async function fetchCoinGecko(sym: string, vs: string): Promise<SourceResult | null> {
  const id = CG_MAP[sym] ?? sym;
  try {
    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=${id}&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data[id];
    if (!entry) return null;
    return {
      price: entry[vs] ?? 0,
      change_24h: entry[`${vs}_24h_change`] ?? 0,
      market_cap: entry[`${vs}_market_cap`] ?? 0,
      source: "coingecko",
    };
  } catch { return null; }
}

async function fetchBinance(sym: string): Promise<SourceResult | null> {
  const pair = `${sym.toUpperCase()}USDT`;
  try {
    const [priceRes, statsRes] = await Promise.all([
      fetch(`${BINANCE_API}/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(5_000) }),
      fetch(`${BINANCE_API}/ticker/24hr?symbol=${pair}`, { signal: AbortSignal.timeout(5_000) }),
    ]);
    if (!priceRes.ok) return null;
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    if (isNaN(price)) return null;

    let change = 0;
    if (statsRes.ok) {
      const stats = await statsRes.json();
      change = parseFloat(stats.priceChangePercent) || 0;
    }
    return { price, change_24h: change, market_cap: 0, source: "binance" };
  } catch { return null; }
}

async function fetchCoinPaprika(sym: string): Promise<SourceResult | null> {
  const id = CP_MAP[sym];
  if (!id) return null;
  try {
    const res = await fetch(`${COINPAPRIKA_API}/tickers/${id}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const quotes = data.quotes?.USD;
    if (!quotes) return null;
    return {
      price: quotes.price ?? 0,
      change_24h: quotes.percent_change_24h ?? 0,
      market_cap: quotes.market_cap ?? 0,
      source: "coinpaprika",
    };
  } catch { return null; }
}

interface PriceInput {
  symbol?: string;
  symbols?: string[];
  vs_currency?: string;
  prevResult?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: PriceInput = await req.json().catch(() => ({}));

    // Normalize symbol inputs to string arrays
    const rawSymbol = typeof body.symbol === "string" ? body.symbol : undefined;
    const rawSymbols = Array.isArray(body.symbols)
      ? body.symbols.filter((s): s is string => typeof s === "string")
      : undefined;
    let symbols = rawSymbols ?? (rawSymbol ? [rawSymbol] : ["btc"]);
    if (!rawSymbol && !rawSymbols && body.prevResult) {
      const prev = body.prevResult.trim().toLowerCase();
      if (CG_MAP[prev]) symbols = [prev];
    }

    const vsCurrency = body.vs_currency ?? "usd";

    const results: Record<string, {
      price: number; change_24h: number; market_cap: number;
      sources: string[]; sourceCount: number;
    }> = {};

    for (const rawSym of symbols) {
      const sym = rawSym.toLowerCase();

      // Check cache
      const cached = _cache.get(sym);
      if (cached && cached.expires > Date.now()) {
        results[sym] = {
          price: cached.data.price, change_24h: cached.data.change_24h,
          market_cap: cached.data.market_cap, sources: [cached.data.source], sourceCount: 1,
        };
        continue;
      }

      // Fetch all 3 sources in parallel
      const [cg, bn, cp] = await Promise.allSettled([
        fetchCoinGecko(sym, vsCurrency),
        fetchBinance(sym),
        fetchCoinPaprika(sym),
      ]);

      const valid: SourceResult[] = [cg, bn, cp]
        .filter((r): r is PromiseFulfilledResult<SourceResult | null> => r.status === "fulfilled")
        .map(r => r.value)
        .filter((v): v is SourceResult => v !== null && v.price > 0);

      if (valid.length === 0) {
        results[sym] = { price: 0, change_24h: 0, market_cap: 0, sources: [], sourceCount: 0 };
        continue;
      }

      // Average prices, discard outliers > 5% from median
      let prices = valid.map(v => v.price).sort((a, b) => a - b);
      if (prices.length >= 3) {
        const median = prices[Math.floor(prices.length / 2)];
        prices = prices.filter(p => Math.abs(p - median) / median < 0.05);
      }
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const bestChange = valid[0].change_24h;
      const bestCap = valid.find(v => v.market_cap > 0)?.market_cap ?? 0;

      const entry = {
        price: Math.round(avgPrice * 100) / 100,
        change_24h: Math.round(bestChange * 100) / 100,
        market_cap: bestCap,
        sources: valid.map(v => v.source),
        sourceCount: valid.length,
      };

      results[sym] = entry;

      // Cache for 30s
      _cache.set(sym, {
        data: { price: entry.price, change_24h: entry.change_24h, market_cap: entry.market_cap, source: entry.sources.join(",") },
        expires: Date.now() + 30_000,
      });
    }

    // Build summary
    const summary = Object.entries(results)
      .map(([sym, r]) => r.price > 0 ? `${sym}: $${r.price.toLocaleString()} (${r.sourceCount} sources)` : `${sym}: unavailable`)
      .join(", ");

    return NextResponse.json({
      status: "ok",
      result: results,
      resultType: "json",
      summary,
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
    description: "Real-time cryptocurrency prices from CoinGecko, Binance, and CoinPaprika. Averages multiple sources for reliability.",
    endpoint: "/api/agent/crypto-price",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Single token symbol (e.g. 'btc', 'eth')" },
        symbols: { type: "array", items: { type: "string" }, description: "Multiple token symbols" },
        vs_currency: { type: "string", default: "usd" },
        prevResult: { type: "string", description: "Output from previous pipeline step" },
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
    tags: ["price", "crypto", "defi", "market-data"],
    author: "SomniaFlow",
  });
}
