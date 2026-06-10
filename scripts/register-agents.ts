// register-agents.ts — registers 4 SomniaFlow demo agents on the Somnia Agent Kit
// Registry: 0xC9f3452090EEB519467DEa4a390976D38C008347 (Shannon testnet)
// Run: npx tsx scripts/register-agents.ts

import { ethers, Contract, Wallet } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const HTTP_RPC = "https://dream-rpc.somnia.network";
const AGENT_REGISTRY = "0xC9f3452090EEB519467DEa4a390976D38C008347";
const PRIVATE_KEY = (process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();

if (!PRIVATE_KEY) {
  console.error("Missing DEPLOYER_PRIVATE_KEY in .env.local");
  process.exit(1);
}

// Somnia Agent Kit ABI (registerAgent method)
const REGISTRY_ABI = [
  "function registerAgent(string name, string description, string ipfsMetadata, uint256 agentType) external returns (uint256)",
  "function getTotalAgents() view returns (uint256)",
];

// Base URL for agent endpoints — uses NEXT_PUBLIC_SITE_URL or Vercel URL
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://somniaflow.vercel.app");

// 4 demo agents with somniaflow-agent-v1 manifests stored as inline JSON metadata
const AGENTS = [
  {
    name: "Crypto Price Agent",
    description: "Real-time crypto prices from CoinGecko, Binance, and CoinPaprika. Averages multiple sources for reliability.",
    agentType: 0, // JSON_API maps to type 0 on-chain
    manifest: {
      version: "somniaflow-agent-v1",
      name: "Crypto Price Agent",
      description: "Real-time crypto prices from CoinGecko, Binance, and CoinPaprika.",
      endpoint: `${BASE_URL}/api/agent/crypto-price`,
      method: "POST",
      inputSchema: { type: "object", properties: { symbol: { type: "string" }, symbols: { type: "array" } } },
      outputSchema: { type: "object", properties: { status: { type: "string" }, result: { type: "object" }, summary: { type: "string" } } },
      resultType: "json",
    },
  },
  {
    name: "Fear & Greed Agent",
    description: "Crypto market sentiment via the Fear & Greed Index (0-100). Combines multiple sentiment sources.",
    agentType: 0,
    manifest: {
      version: "somniaflow-agent-v1",
      name: "Fear & Greed Agent",
      description: "Crypto market sentiment via the Fear & Greed Index.",
      endpoint: `${BASE_URL}/api/agent/fear-greed`,
      method: "POST",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { status: { type: "string" }, result: { type: "object" }, summary: { type: "string" } } },
      resultType: "number",
    },
  },
  {
    name: "Risk Evaluation Agent",
    description: "Algorithmic risk scorer. Analyzes price, sentiment, and volume to produce EXECUTE/SKIP decisions without LLM.",
    agentType: 0,
    manifest: {
      version: "somniaflow-agent-v1",
      name: "Risk Evaluation Agent",
      description: "Algorithmic risk scoring with EXECUTE/SKIP output.",
      endpoint: `${BASE_URL}/api/agent/risk-eval`,
      method: "POST",
      inputSchema: { type: "object", properties: { price: { type: "number" }, change_24h: { type: "number" }, fear_greed: { type: "number" } } },
      outputSchema: { type: "object", properties: { status: { type: "string" }, result: { type: "object" }, summary: { type: "string" } } },
      resultType: "decision",
    },
  },
  {
    name: "Market Data Agent",
    description: "Aggregated crypto market data: top movers, global stats, trending coins from CoinGecko.",
    agentType: 0,
    manifest: {
      version: "somniaflow-agent-v1",
      name: "Market Data Agent",
      description: "Aggregated crypto market overview.",
      endpoint: `${BASE_URL}/api/agent/market-data`,
      method: "POST",
      inputSchema: { type: "object", properties: { category: { type: "string" } } },
      outputSchema: { type: "object", properties: { status: { type: "string" }, result: { type: "object" }, summary: { type: "string" } } },
      resultType: "json",
    },
  },
];

async function main() {
  const provider = new ethers.JsonRpcProvider(HTTP_RPC);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const registry = new Contract(AGENT_REGISTRY, REGISTRY_ABI, signer);

  const balance = await provider.getBalance(signer.address);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} STT`);

  const totalBefore = await registry.getTotalAgents();
  console.log(`Agents on registry before: ${totalBefore}\n`);

  for (const agent of AGENTS) {
    const metadata = JSON.stringify(agent.manifest);
    console.log(`Registering "${agent.name}"...`);

    try {
      const tx = await registry.registerAgent(
        agent.name,
        agent.description,
        metadata,
        agent.agentType,
      );
      const receipt = await tx.wait();
      console.log(`  Registered — tx=${tx.hash} (block ${receipt.blockNumber})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If already registered or reverted, log and continue
      console.error(`  Failed: ${msg.substring(0, 120)}`);
    }
  }

  const totalAfter = await registry.getTotalAgents();
  console.log(`\nAgents on registry after: ${totalAfter}`);
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
