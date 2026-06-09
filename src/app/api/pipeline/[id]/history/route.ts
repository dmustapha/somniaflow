import { NextRequest, NextResponse } from "next/server";
import { ethers, Contract } from "ethers";

const HTTP_RPC          = "https://dream-rpc.somnia.network";
const REGISTRY_ADDRESS  = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS!;
const EXPLORER          = "https://shannon-explorer.somnia.network";

const ABI = [
  "event StepCompleted(uint256 indexed pipelineId, uint256 step, string result)",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const provider = new ethers.JsonRpcProvider(HTTP_RPC);
    const contract = new Contract(REGISTRY_ADDRESS, ABI, provider);

    const filter = contract.filters.StepCompleted(BigInt(params.id));
    const logs   = await contract.queryFilter(filter, -100_000); // last ~100k blocks

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
