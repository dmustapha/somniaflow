// [VERIFIED] — ethers.js v6 patterns throughout
// [ASSUMED] — somnia-agent-kit wraps the ABI; direct ABI used here pending SDK confirmation
import { ethers, Contract, Wallet, parseEther, formatEther } from "ethers";
import { pipelineBus } from "./event-bus";
import { parsePipelineDecision } from "./parse-decision";
import { startRelayCoordinator } from "./relay-coordinator";
import type { PipelineStepInput, PipelineStepDef, PipelineStateView, PipelineSSEEvent } from "@/types";

// [VERIFIED] — Shannon testnet HTTP RPC (WebSocket unstable; polling via JsonRpcProvider)
const HTTP_RPC = "https://dream-rpc.somnia.network";

const _REGISTRY_RAW = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || "0x1DEc4313A4d24Acb2DC9Bf3E03101176e88fCeBc";
const REGISTRY_ADDRESS = ethers.isAddress(_REGISTRY_RAW) ? ethers.getAddress(_REGISTRY_RAW) : "0x1DEc4313A4d24Acb2DC9Bf3E03101176e88fCeBc";
const EXPLORER         = "https://shannon-explorer.somnia.network";

// ABI — minimal set of functions and events needed by the integration layer
// [VERIFIED] — signatures from PipelineRegistry.sol
const REGISTRY_ABI = [
  "function registerPipeline(tuple(uint8,string,bool,uint8)[] steps) payable returns (uint256)",
  "function fundPipeline(uint256 pipelineId) payable",
  "function triggerPipeline(uint256 pipelineId)",
  "function getPipelineState(uint256 pipelineId) view returns (tuple(uint256,uint8,uint256,uint8[],uint256,string[]))",
  "function getPipelineSteps(uint256 pipelineId) view returns (tuple(uint8 agentType, string inputTemplate, bool conditionalOnPrev, uint8 maxRetries)[])",
  "function getPipelineStepResult(uint256 pipelineId, uint256 stepIndex) view returns (string,uint8)",
  "function withdrawBalance(uint256 pipelineId)",
  "event PipelineRegistered(uint256 indexed pipelineId, address indexed owner, uint256 stepCount)",
  "event PipelineFunded(uint256 indexed pipelineId, uint256 amount)",
  "event PipelineStarted(uint256 indexed pipelineId)",
  "event StepDispatched(uint256 indexed pipelineId, uint256 step, uint8 agentType, uint256 requestId)",
  "event StepCostEstimated(uint256 indexed pipelineId, uint256 step, uint256 depositWei)",
  "event StepCompleted(uint256 indexed pipelineId, uint256 step, string result)",
  "event StepSkipped(uint256 indexed pipelineId, uint256 step)",
  "event StepRetrying(uint256 indexed pipelineId, uint256 step, uint8 attempt)",
  "event PipelineComplete(uint256 indexed pipelineId)",
  "event PipelineFailed(uint256 indexed pipelineId, uint256 step, string reason)",
];

// ─────────────────────────────────────────────────────────────────────────────
// Provider + signer (server-side only — private key never leaves server)
// ─────────────────────────────────────────────────────────────────────────────

let _httpProvider:   ethers.JsonRpcProvider | null = null;
let _pollContract:   Contract               | null = null;
let _signer:         Wallet                 | null = null;
let _isListening = false;

const _runStartTimes    = new Map<string, number>(); // pipelineId => start timestamp
const _stepDispatchTimes = new Map<string, Map<number, number>>(); // pipelineId => step => dispatch timestamp
const _stepCosts        = new Map<string, Map<number, string>>();  // pipelineId => step => cost in STT
const _stepTxHashes     = new Map<string, Map<number, string>>();  // pipelineId => step => txHash

function getHttpProvider(): ethers.JsonRpcProvider {
  if (!_httpProvider) _httpProvider = new ethers.JsonRpcProvider(HTTP_RPC, new ethers.Network("somnia-shannon", 50312), { staticNetwork: new ethers.Network("somnia-shannon", 50312) });
  return _httpProvider;
}

function getSigner(): Wallet {
  if (!_signer) {
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error("DEPLOYER_PRIVATE_KEY not set");
    _signer = new Wallet(key, getHttpProvider());
  }
  return _signer;
}

function getSignerContract(): Contract {
  return new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, getSigner());
}

function calcDuration(pipelineId: string, step: number): number {
  const dispatch = _stepDispatchTimes.get(pipelineId)?.get(step);
  return dispatch ? Date.now() - dispatch : 0;
}

function getStepCost(pipelineId: string, step: number): string {
  return _stepCosts.get(pipelineId)?.get(step) ?? "0";
}

function cleanupMaps(id: string) {
  _runStartTimes.delete(id);
  _stepDispatchTimes.delete(id);
  _stepCosts.delete(id);
  _stepTxHashes.delete(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP polling-based event listener — starts once on server boot
// Maps all PipelineRegistry events → PipelineSSEEvent, emitted to pipelineBus
// ─────────────────────────────────────────────────────────────────────────────

export async function startEventListener(): Promise<void> {
  if (_isListening) return;
  _isListening = true;

  const provider   = getHttpProvider();
  _pollContract    = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

  _pollContract.on("PipelineStarted", async (pipelineId: bigint) => {
    const id = pipelineId.toString();
    _runStartTimes.set(id, Date.now());
    let stepCount = 3; // fallback
    try {
      const steps = await _pollContract!.getPipelineSteps(pipelineId);
      stepCount = steps.length;
    } catch { /* use fallback */ }
    pipelineBus.emit(id, {
      type: "pipeline_started",
      data: { pipelineId: id, stepCount },
    });
  });

  _pollContract.on("StepDispatched", (pipelineId: bigint, step: bigint, agentType: number, requestId: bigint) => {
    const id      = pipelineId.toString();
    const stepNum = Number(step);

    // Track dispatch time for durationMs calculation
    if (!_stepDispatchTimes.has(id)) _stepDispatchTimes.set(id, new Map());
    _stepDispatchTimes.get(id)!.set(stepNum, Date.now());

    const agentName = agentType === 1 ? "LLM_INFERENCE" : agentType === 2 ? "LLM_PARSE_WEBSITE" : "JSON_API";
    pipelineBus.emit(id, {
      type: "step_dispatched",
      data: { step: stepNum, agentType: agentName, requestId: requestId.toString(), timestamp: Date.now() },
    });
  });

  _pollContract.on("StepCostEstimated", (pipelineId: bigint, step: bigint, depositWei: bigint) => {
    const id = pipelineId.toString();
    if (!_stepCosts.has(id)) _stepCosts.set(id, new Map());
    _stepCosts.get(id)!.set(Number(step), formatEther(depositWei));
  });

  _pollContract.on("StepCompleted", (...args) => {
    // In ethers.js v6, the last arg is ContractEventPayload — use it to get txHash
    const payload = args[args.length - 1];
    const txHash  = (payload?.log?.transactionHash as string | undefined) ?? "";
    const [pipelineId, step, result] = args as [bigint, bigint, string, unknown];
    const id      = pipelineId.toString();
    const stepNum = Number(step);

    // Store TX hash for this step
    if (!_stepTxHashes.has(id)) _stepTxHashes.set(id, new Map());
    _stepTxHashes.get(id)!.set(stepNum, txHash);

    if (stepNum === 1) {
      // Emit step_reasoning first so WordReveal animation starts
      pipelineBus.emit(id, {
        type: "step_reasoning",
        data: { step: 1, chunk: result },
      });
      // Give React one render cycle before transitioning to complete (FIX-P3: WordReveal race fix)
      setTimeout(() => {
        pipelineBus.emit(id, {
          type: "step_complete",
          data: { step: 1, result, durationMs: calcDuration(id, 1), sttCost: getStepCost(id, 1), txHash },
        });
        pipelineBus.emit(id, { type: "decision", data: parsePipelineDecision(result) });
      }, 120);
      return;
    }

    pipelineBus.emit(id, {
      type: "step_complete",
      data: { step: stepNum, result, durationMs: calcDuration(id, stepNum), sttCost: getStepCost(id, stepNum), txHash },
    });
  });

  _pollContract.on("StepSkipped", (pipelineId: bigint, step: bigint) => {
    pipelineBus.emit(pipelineId.toString(), {
      type: "step_skipped",
      data: { step: Number(step) },
    });
  });

  _pollContract.on("StepRetrying", (pipelineId: bigint, step: bigint, attempt: number) => {
    pipelineBus.emit(pipelineId.toString(), {
      type: "step_retrying",
      data: { step: Number(step), attempt },
    });
  });

  _pollContract.on("PipelineComplete", (pipelineId: bigint) => {
    const id      = pipelineId.toString();
    const startMs = _runStartTimes.get(id) ?? Date.now();
    const totalMs = Date.now() - startMs;
    const txHashes = Array.from(_stepTxHashes.get(id)?.values() ?? []).filter(Boolean);
    cleanupMaps(id);
    pipelineBus.emit(id, {
      type: "pipeline_complete",
      data: { pipelineId: id, totalMs, txHashes },
    });
  });

  _pollContract.on("PipelineFailed", (pipelineId: bigint, step: bigint, reason: string) => {
    const id = pipelineId.toString();
    cleanupMaps(id);
    pipelineBus.emit(id, {
      type: "pipeline_failed",
      data: { step: Number(step), reason },
    });
  });

  provider.on("error", (err) => {
    console.error("[PipelineService] Provider error:", err.message ?? err);
    _isListening = false;
    setTimeout(() => startEventListener(), 5_000);
  });

  // SDK-relay: start relay coordinator alongside event listener (Branch B fallback)
  // Wrapped in try/catch — relay failure must not crash the SSE stream route
  try {
    await startRelayCoordinator();
  } catch (err) {
    console.error("[PipelineService] relay coordinator failed to start:", err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public service methods
// ─────────────────────────────────────────────────────────────────────────────

export async function registerPipeline(steps: PipelineStepInput[])
  : Promise<{ pipelineId: string; txHash: string }>
{
  const contract = getSignerContract();
  const tx       = await contract.registerPipeline(
    steps.map(s => [s.agentType, s.inputTemplate, s.conditionalOnPrev, s.maxRetries]),
    { value: 0 }
  );
  const receipt  = await tx.wait();

  const iface = new ethers.Interface(REGISTRY_ABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "PipelineRegistered") {
        return { pipelineId: parsed.args.pipelineId.toString(), txHash: receipt.hash };
      }
    } catch { /* not our event */ }
  }
  throw new Error("PipelineRegistered event not found in receipt");
}

export async function fundPipeline(pipelineId: string, amountEther: string)
  : Promise<{ txHash: string }>
{
  const contract = getSignerContract();
  const tx       = await contract.fundPipeline(BigInt(pipelineId), { value: parseEther(amountEther) });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash };
}

export async function triggerPipeline(pipelineId: string)
  : Promise<{ txHash: string }>
{
  const contract = getSignerContract();
  const tx       = await contract.triggerPipeline(BigInt(pipelineId));
  const receipt  = await tx.wait();
  return { txHash: receipt.hash };
}

export async function getPipelineState(pipelineId: string): Promise<PipelineStateView> {
  const contract  = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, getHttpProvider());
  const raw       = await contract.getPipelineState(BigInt(pipelineId));
  const statusMap = ["Idle", "Running", "Complete", "Failed"] as const;
  const stepMap   = ["idle", "pending", "complete", "failed", "retrying", "skipped"] as const;
  return {
    pipelineId,
    status:       statusMap[raw[1]] ?? "Idle",
    activeStep:   Number(raw[2]),
    stepStatuses: Array.from(raw[3] as ArrayLike<number>).map(s => stepMap[Number(s)] ?? "idle"),
    sttBalance:   formatEther(raw[4]),
    stepResults: Array.from(raw[5] as ArrayLike<unknown>).map(s => String(s)),
  };
}

export async function getStepDefinitions(pipelineId: string): Promise<PipelineStepDef[]> {
  const contract = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, getHttpProvider());
  const steps    = await contract.getPipelineSteps(BigInt(pipelineId));
  return Array.from(steps as ArrayLike<{ agentType: bigint | number; inputTemplate: string; conditionalOnPrev: boolean; maxRetries: bigint | number }>).map((s, i) => ({
    index:            i,
    agentType:        Number(s.agentType) as 0 | 1 | 2,
    inputTemplate:    s.inputTemplate,
    conditionalOnPrev: s.conditionalOnPrev,
    maxRetries:       Number(s.maxRetries),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// TX hash history — query StepCompleted events for a given pipeline
// ─────────────────────────────────────────────────────────────────────────────

export async function getTransactionHistory(pipelineId: string): Promise<Array<{
  steps: Array<{ step: number; txHash: string; blockNumber: number; result: string; explorerUrl: string }>;
}>> {
  try {
    const provider = getHttpProvider();
    const contract = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    const filter   = contract.filters.StepCompleted(BigInt(pipelineId));
    const logs     = await contract.queryFilter(filter, -100_000);

    const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber);

    type LogEntry = { step: number; txHash: string; blockNumber: number; result: string; explorerUrl: string };
    const runs: LogEntry[][] = [];
    let current: LogEntry[]  = [];

    for (const log of sorted) {
      const ev      = log as ethers.EventLog;
      const stepNum = Number(ev.args[1]);
      if (stepNum === 0 && current.length > 0) {
        runs.push(current);
        current = [];
      }
      current.push({
        step:        stepNum,
        txHash:      log.transactionHash,
        blockNumber: log.blockNumber,
        result:      ev.args[2] as string,
        explorerUrl: `${EXPLORER}/tx/${log.transactionHash}`,
      });
    }
    if (current.length > 0) runs.push(current);

    return runs.slice(-3).reverse().map(steps => ({ steps }));
  } catch {
    return [];
  }
}

// Re-export parsePipelineDecision for backwards compatibility
export { parsePipelineDecision } from "./parse-decision";
