// seed-demo.ts — registers + funds a 4-step Market Intelligence pipeline on Shannon testnet
// Uses all 4 EXTERNAL demo agents: Crypto Price → Fear & Greed → Risk Eval → Market Data
// Run: npx tsx scripts/seed-demo.ts

import { ethers, Contract, Wallet } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const HTTP_RPC         = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1").replace(/\\n/g, "").trim();
const PRIVATE_KEY      = (process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();

if (!PRIVATE_KEY) {
  console.error("Missing DEPLOYER_PRIVATE_KEY in .env.local");
  process.exit(1);
}

const REGISTRY_ABI = [
  "function registerPipeline(tuple(uint8,string,bool,uint8)[] steps) payable returns (uint256)",
  "function fundPipeline(uint256 pipelineId) payable",
  "function triggerPipeline(uint256 pipelineId)",
  "function getPipelineState(uint256 pipelineId) view returns (tuple(uint256,uint8,uint256,uint8[],uint256,string[]))",
  "function pipelineCount() view returns (uint256)",
  "event PipelineRegistered(uint256 indexed pipelineId, address indexed owner, uint256 stepCount)",
  "event PipelineFunded(uint256 indexed pipelineId, uint256 amount)",
];

// Base URL for agents — use production Vercel URL
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://somniaflow.vercel.app";

// 4-step Market Intelligence Pipeline (all EXTERNAL type = 3)
// Step 1: Get BTC price
// Step 2: Get Fear & Greed sentiment
// Step 3: Risk evaluation (conditional = false, receives sentiment from step 2)
// Step 4: Market data (conditional on step 3's EXECUTE/SKIP decision)
const PIPELINE_STEPS = [
  {
    agentType:         3, // EXTERNAL
    inputTemplate:     `EXTERNAL|${BASE_URL}/api/agent/crypto-price|{"symbol":"btc"}`,
    conditionalOnPrev: false,
    maxRetries:        1,
  },
  {
    agentType:         3,
    inputTemplate:     `EXTERNAL|${BASE_URL}/api/agent/fear-greed|{"prevResult":"{prevResult}"}`,
    conditionalOnPrev: false,
    maxRetries:        1,
  },
  {
    agentType:         3,
    inputTemplate:     `EXTERNAL|${BASE_URL}/api/agent/risk-eval|{"sentiment":"{prevResult}","prevResult":"{prevResult}"}`,
    conditionalOnPrev: false,
    maxRetries:        1,
  },
  {
    agentType:         3,
    inputTemplate:     `EXTERNAL|${BASE_URL}/api/agent/market-data|{"symbol":"btc","prevResult":"{prevResult}"}`,
    conditionalOnPrev: true,
    maxRetries:        1,
  },
];

async function main() {
  const network  = new ethers.Network("somnia-shannon", 50312);
  const provider = new ethers.JsonRpcProvider(HTTP_RPC, network, { staticNetwork: network });
  const signer   = new Wallet(PRIVATE_KEY, provider);
  const contract = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);

  const balance = await provider.getBalance(signer.address);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Registry: ${REGISTRY_ADDRESS}`);
  console.log(`Balance: ${ethers.formatEther(balance)} STT`);

  const currentCount = await contract.pipelineCount();
  console.log(`Current pipeline count: ${currentCount}\n`);

  // 4-step pipeline: 0.03 STT per step minimum = 0.12 STT + gas
  const fundAmount = "0.15";
  if (balance < ethers.parseEther("0.20")) {
    console.error(`Need at least 0.20 STT (fund=${fundAmount} + gas). Current: ${ethers.formatEther(balance)}`);
    process.exit(1);
  }

  // Register pipeline
  console.log("Registering 4-step Market Intelligence pipeline...");
  const steps = PIPELINE_STEPS.map(s => [s.agentType, s.inputTemplate, s.conditionalOnPrev, s.maxRetries]);
  const tx1 = await contract.registerPipeline(steps, { value: 0 });
  const receipt1 = await tx1.wait();

  // Parse PipelineRegistered event
  const iface = new ethers.Interface(REGISTRY_ABI);
  let pipelineId = "";
  for (const log of receipt1.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "PipelineRegistered") {
        pipelineId = parsed.args[0].toString();
        break;
      }
    } catch { /* skip non-matching logs */ }
  }
  console.log(`Registered → pipelineId=${pipelineId} tx=${tx1.hash}`);

  // Fund pipeline
  console.log(`Funding pipeline ${pipelineId} with ${fundAmount} STT...`);
  const tx2 = await contract.fundPipeline(BigInt(pipelineId), {
    value: ethers.parseEther(fundAmount),
    gasLimit: 500_000,
  });
  await tx2.wait();
  console.log(`Funded → tx=${tx2.hash}`);

  console.log(`\nPipeline ready. Add to .env.local:`);
  console.log(`NEXT_PUBLIC_DEMO_PIPELINE_IDS=${pipelineId}`);
  console.log(`\nTo trigger via API:`);
  console.log(`  curl -X POST ${BASE_URL}/api/pipeline/trigger -H 'Content-Type: application/json' -d '{"pipelineId":"${pipelineId}"}'`);
  console.log(`\nOr trigger via UI: ${BASE_URL}/pipeline/${pipelineId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
