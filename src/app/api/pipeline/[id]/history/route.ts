import { NextRequest, NextResponse } from "next/server";
import { ethers, Contract } from "ethers";

export const dynamic = "force-dynamic";

const HTTP_RPC         = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1").trim();
const EXPLORER         = "https://shannon-explorer.somnia.network";

const ABI = [
  "event StepCompleted(uint256 indexed pipelineId, uint256 step, string result)",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const provider = new ethers.JsonRpcProvider(HTTP_RPC, new ethers.Network("somnia-shannon", 50312), { staticNetwork: new ethers.Network("somnia-shannon", 50312) });
    const contract = new Contract(REGISTRY_ADDRESS, ABI, provider);

    const pipelineId = BigInt(params.id);
    const filter = contract.filters.StepCompleted(pipelineId);

    // Shannon RPC limits getLogs to 1000 blocks — paginate backwards
    const latestBlock = await provider.getBlockNumber();
    const allLogs: ethers.Log[] = [];
    const CHUNK = 999;
    const MAX_LOOKBACK = 50_000;
    let toBlock = latestBlock;
    const floor = Math.max(0, latestBlock - MAX_LOOKBACK);

    while (toBlock > floor && allLogs.length < 100) {
      const fromBlock = Math.max(floor, toBlock - CHUNK);
      const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
      allLogs.push(...chunk);
      toBlock = fromBlock - 1;
    }

    const logs = allLogs;

    // Sort ascending by block
    const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber);

    // Group into runs: a new run starts when step 0 appears after prior steps
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

    // Most recent 3, newest first
    const history = runs.slice(-3).reverse();
    return NextResponse.json({ history });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "query failed";
    return NextResponse.json({ error: message, history: [] }, { status: 500 });
  }
}
