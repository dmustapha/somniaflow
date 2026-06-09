// seed-demo.ts — registers + funds 2 demo pipelines on Shannon testnet
// Pipeline 1 (EXECUTE branch):  registers fresh with correct templates
// Pipeline 2 (SKIP  branch):  same steps; LLM expected to return SKIP
// Run: npx tsx scripts/seed-demo.ts
// [VERIFIED] — ARCHITECTURE.md Section 12

import { ethers, Contract, Wallet } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const HTTP_RPC        = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS!;
const PRIVATE_KEY      = process.env.DEPLOYER_PRIVATE_KEY!;

if (!REGISTRY_ADDRESS || !PRIVATE_KEY) {
  console.error("Missing NEXT_PUBLIC_REGISTRY_ADDRESS or DEPLOYER_PRIVATE_KEY in .env.local");
  process.exit(1);
}

const REGISTRY_ABI = [
  "function registerPipeline(tuple(uint8,string,bool,uint8)[] steps) payable returns (uint256)",
  "function fundPipeline(uint256 pipelineId) payable",
  "function triggerPipeline(uint256 pipelineId)",
  "function getPipelineState(uint256 pipelineId) view returns (tuple(uint256,uint8,uint256,uint8[],uint256,string[]))",
  "event PipelineRegistered(uint256 indexed pipelineId, address indexed owner, uint256 stepCount)",
  "event PipelineFunded(uint256 indexed pipelineId, uint256 amount)",
];

// ARCHITECTURE.md Section 12 — exact step configuration
const DEMO_STEPS = [
  {
    agentType:         0,
    inputTemplate:     "https://api.coinpaprika.com/v1/tickers/eth-ethereum|quotes.USD.price|2",
    conditionalOnPrev: false,
    maxRetries:        1,
  },
  {
    agentType:         1,
    inputTemplate:     "Position data — ETH price: {prevResult}. Analyze current price vs. recent trend. Should we execute a 20% portfolio rebalancing swap?",
    conditionalOnPrev: false,
    maxRetries:        1,
  },
  {
    agentType:         0,
    inputTemplate:     "https://api.coinpaprika.com/v1/tickers/eth-ethereum|quotes.USD.volume_24h|0",
    conditionalOnPrev: true,
    maxRetries:        1,
  },
];

async function deployPipeline(
  contract: Contract,
  label: string,
  fundEth: string
): Promise<string> {
  console.log(`\n[${label}] Registering pipeline...`);
  const tx1 = await contract.registerPipeline(
    DEMO_STEPS.map(s => [s.agentType, s.inputTemplate, s.conditionalOnPrev, s.maxRetries]),
    { value: 0 }
  );
  const receipt1 = await tx1.wait();

  // Parse PipelineRegistered event
  const iface     = new ethers.Interface(REGISTRY_ABI);
  let pipelineId  = "";
  for (const log of receipt1.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "PipelineRegistered") {
        pipelineId = parsed.args[0].toString();
        break;
      }
    } catch {}
  }
  console.log(`[${label}] Registered → pipelineId=${pipelineId} tx=${tx1.hash}`);

  console.log(`[${label}] Funding with ${fundEth} STT...`);
  const tx2 = await contract.fundPipeline(BigInt(pipelineId), {
    value: ethers.parseEther(fundEth),
    gasLimit: 500_000,   // actual ~248k; keep buffer small to preserve wallet balance
  });
  await tx2.wait();
  console.log(`[${label}] Funded tx=${tx2.hash}`);

  return pipelineId;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(HTTP_RPC);
  const signer   = new Wallet(PRIVATE_KEY, provider);
  const contract = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);

  const balance = await provider.getBalance(signer.address);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} STT`);

  // Minimum: 0.03+0.07+0.03 = 0.13 STT per pipeline, plus gas buffer
  if (balance < ethers.parseEther("0.13")) {
    console.error("Need at least 0.13 STT per pipeline (3-step min cost)");
    process.exit(1);
  }

  // Seed one or two pipelines depending on available balance
  const canSeedTwo = balance >= ethers.parseEther("0.28"); // 0.13 each + buffer
  const fundAmount = canSeedTwo ? "0.13" : "0.13";

  // Register and fund demo pipelines
  const id1 = await deployPipeline(contract, "Pipeline-A (demo-1)", fundAmount);
  const id2 = canSeedTwo
    ? await deployPipeline(contract, "Pipeline-B (demo-2)", fundAmount)
    : null;

  const ids = id2 ? `${id1},${id2}` : id1;
  console.log(`\n✓ Demo pipeline(s) registered and funded.`);
  console.log(`  NEXT_PUBLIC_DEMO_PIPELINE_IDS=${ids}`);
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_DEMO_PIPELINE_IDS=${ids}`);
  console.log("\nThen trigger via UI or API:");
  console.log(`  curl -X POST http://localhost:3456/api/pipeline/trigger -H 'Content-Type: application/json' -d '{"pipelineId":"${id1}"}'`);
  if (id2) {
    console.log(`  curl -X POST http://localhost:3456/api/pipeline/trigger -H 'Content-Type: application/json' -d '{"pipelineId":"${id2}"}'`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
