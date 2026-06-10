// relay-manual.ts — manually executes all steps of a pipeline by calling agents and injecting results
// Replaces the WebSocket-based relay coordinator for environments without persistent connections
// Run: npx tsx scripts/relay-manual.ts [pipelineId]

import { ethers, Contract, Wallet } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const HTTP_RPC         = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1").replace(/\\n/g, "").trim();
const PRIVATE_KEY      = (process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();

const ABI = [
  "function ownerHandleResponse(uint256 requestId, string calldata result) external",
  "function getPipelineState(uint256 pipelineId) view returns (tuple(uint256,uint8,uint256,uint8[],uint256,string[]))",
  "function getPipelineSteps(uint256 pipelineId) view returns (tuple(uint8 agentType, string inputTemplate, bool conditionalOnPrev, uint8 maxRetries)[])",
  "event StepDispatched(uint256 indexed pipelineId, uint256 step, uint8 agentType, uint256 requestId)",
  "event StepCompleted(uint256 indexed pipelineId, uint256 step, string result)",
  "event PipelineComplete(uint256 indexed pipelineId)",
  "event PipelineFailed(uint256 indexed pipelineId, uint256 step, string reason)",
];

function interpolateTemplate(template: string, prevResult: string): string {
  let result = template.replace(/\{prevResult\.([^}]+)\}/g, (_match, p: string) => {
    try {
      const parsed = JSON.parse(prevResult);
      let value: unknown = parsed;
      for (const key of p.split(".")) {
        if (value == null) return "";
        value = (value as Record<string, unknown>)[key];
      }
      return value != null ? String(value) : "";
    } catch { return ""; }
  });
  result = result.replace("{prevResult}", prevResult);
  return result;
}

async function executeExternalAgent(inputTemplate: string, prevResult: string): Promise<string> {
  const interpolated = interpolateTemplate(inputTemplate, prevResult);
  const parts = interpolated.split("|");
  const url = parts[1]?.trim();
  const jsonBody = parts.slice(2).join("|").trim();

  if (!url) throw new Error(`Invalid template: ${inputTemplate.substring(0, 80)}`);

  let body: Record<string, unknown> = {};
  if (jsonBody) {
    try { body = JSON.parse(jsonBody); } catch { body = {}; }
  }

  console.log(`  POST ${url}`);
  console.log(`  Body: ${JSON.stringify(body).substring(0, 120)}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  if (data.summary) return data.summary;
  if (data.result) return typeof data.result === "string" ? data.result : JSON.stringify(data.result);
  return JSON.stringify(data);
}

async function getLatestRequestId(
  provider: ethers.JsonRpcProvider,
  pipelineId: number,
  step: number,
): Promise<string | null> {
  const iface = new ethers.Interface(ABI);
  const topic0 = iface.getEvent("StepDispatched")!.topicHash;
  const topicPid = ethers.zeroPadValue(ethers.toBeHex(pipelineId), 32);

  // Search in 500-block chunks (Somnia RPC has strict range limits)
  const latest = await provider.getBlockNumber();
  let logs: ethers.Log[] = [];
  for (let to = latest; to > latest - 3000 && to > 0; to -= 500) {
    const from = Math.max(0, to - 499);
    try {
      const chunk = await provider.getLogs({
        address: REGISTRY_ADDRESS,
        topics: [topic0, topicPid],
        fromBlock: from,
        toBlock: to,
      });
      logs = logs.concat(chunk);
    } catch { /* skip chunks that fail */ }
  }

  // Find the StepDispatched for the target step
  for (const log of logs.reverse()) {
    const parsed = iface.parseLog(log);
    if (parsed && Number(parsed.args[1]) === step) {
      return parsed.args[3].toString(); // requestId
    }
  }
  return null;
}

async function main() {
  const pipelineId = parseInt(process.argv[2] ?? "1", 10);

  const network  = new ethers.Network("somnia-shannon", 50312);
  const provider = new ethers.JsonRpcProvider(HTTP_RPC, network, { staticNetwork: network });
  const signer   = new Wallet(PRIVATE_KEY, provider);
  const contract = new Contract(REGISTRY_ADDRESS, ABI, signer);

  console.log(`Relay for pipeline ${pipelineId}`);
  console.log(`Registry: ${REGISTRY_ADDRESS}`);
  console.log(`Wallet: ${signer.address}\n`);

  // Read pipeline steps
  const steps = await contract.getPipelineSteps(pipelineId);
  const stepCount = steps.length;
  console.log(`Pipeline has ${stepCount} steps\n`);

  // Read current state
  const state = await contract.getPipelineState(pipelineId);
  const status = Number(state[1]); // 0=Registered, 1=Running, 2=Complete, 3=Failed
  const activeStep = Number(state[2]);
  const stepStatuses: number[] = state[3].map(Number);
  const stepResults: string[] = state[5];

  console.log(`Status: ${["Registered","Running","Complete","Failed"][status]}, Active step: ${activeStep}`);
  console.log(`Step statuses: ${stepStatuses.join(", ")}`);

  if (status !== 1) {
    console.log("Pipeline not running. Nothing to do.");
    return;
  }

  // Process each step from activeStep forward
  let prevResult = activeStep > 0 ? (stepResults[activeStep - 1] ?? "") : "";

  for (let i = activeStep; i < stepCount; i++) {
    const step = steps[i];
    const agentType = Number(step.agentType);
    const inputTemplate = step.inputTemplate;
    const conditionalOnPrev = step.conditionalOnPrev;

    console.log(`\n--- Step ${i} (type=${agentType}) ---`);
    console.log(`  Template: ${inputTemplate.substring(0, 100)}...`);
    console.log(`  Conditional: ${conditionalOnPrev}`);
    console.log(`  PrevResult: "${prevResult.substring(0, 80)}"`);

    // Get requestId for this step
    const requestId = await getLatestRequestId(provider, pipelineId, i);
    if (!requestId) {
      console.log("  No StepDispatched event found for this step. Stopping.");
      break;
    }
    console.log(`  RequestID: ${requestId}`);

    // Execute the agent
    let result: string;
    try {
      if (inputTemplate.startsWith("EXTERNAL|")) {
        result = await executeExternalAgent(inputTemplate, prevResult);
      } else {
        result = `Unsupported agentType ${agentType} for manual relay`;
      }
    } catch (err) {
      result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    console.log(`  Result: "${result.substring(0, 120)}"`);

    // Wrap for conditionalOnPrev if needed
    if (i + 1 < stepCount && steps[i + 1].conditionalOnPrev && !result.includes("DECISION:")) {
      if (result.trim() && !result.startsWith("ERROR:")) {
        result = `DECISION: EXECUTE\nREASONING: Previous step returned valid data.\nCONFIDENCE: HIGH\nORIGINAL_RESULT: ${result}`;
      } else {
        result = `DECISION: SKIP\nREASONING: Previous step returned empty or error result.\nCONFIDENCE: HIGH`;
      }
      console.log(`  Wrapped for conditional: ${result.substring(0, 80)}...`);
    }

    // Inject result on-chain
    console.log(`  Injecting result...`);
    const tx = await contract.ownerHandleResponse(BigInt(requestId), result);
    const receipt = await tx.wait();
    console.log(`  TX: ${tx.hash} (block ${receipt.blockNumber})`);

    // Check for completion events
    const iface = new ethers.Interface(ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "PipelineComplete") {
          console.log(`\n  Pipeline COMPLETE!`);
          return;
        }
        if (parsed?.name === "PipelineFailed") {
          console.log(`\n  Pipeline FAILED at step ${parsed.args[1]}: ${parsed.args[2]}`);
          return;
        }
      } catch { /* skip non-matching logs */ }
    }

    // Unwrap for next step
    const originalMarker = "ORIGINAL_RESULT: ";
    const markerIdx = result.indexOf(originalMarker);
    prevResult = markerIdx >= 0 ? result.substring(markerIdx + originalMarker.length) : result;

    // Small delay to let the chain settle
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
