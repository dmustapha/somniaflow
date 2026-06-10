// agent-registry.ts
// Queries the Somnia Agent Registry on Shannon testnet.
// Registry address: 0xC9f3452090EEB519467DEa4a390976D38C008347 (Somnia Agent Kit)
// Methods: getTotalAgents() → uint256, getAgent(id) → AgentInfo struct
//
// Real on-chain struct (verified via raw ABI decode, 56 agents as of 2026-06-10):
//   name, description, ipfsMetadata, owner, isActive, registeredAt (uint256), agentType (uint256)
// agentType field: 0 = JSON_API / default, 2 = LLM_PARSE_WEBSITE (maps directly to Platform types)
// NO capabilities[] array in the actual contract — prior ABI was incorrect

import { ethers } from "ethers";

const HTTP_RPC        = process.env.NEXT_PUBLIC_RPC_URL ?? "https://dream-rpc.somnia.network";
const SHANNON_NETWORK = new ethers.Network("somnia-shannon", 50312);

// Somnia Agent Kit registry — enumerable community registry
const AGENT_REGISTRY_ADDRESS = "0xC9f3452090EEB519467DEa4a390976D38C008347";

const AGENT_REGISTRY_ABI = [
  "function getTotalAgents() view returns (uint256)",
  "function getAgent(uint256 agentId) view returns (string name, string description, string ipfsMetadata, address owner, bool isActive, uint256 registeredAt, uint256 agentType)",
];

export interface SomniaAgent {
  id:            number;
  name:          string;
  description:   string;
  owner:         string;
  isActive:      boolean;
  ipfsMetadata:  string;
  registeredAt:  number;
  // Platform execution type: 0=JSON_API, 1=LLM_INFERENCE, 2=LLM_PARSE_WEBSITE
  executionType: 0 | 1 | 2;
  // Short label for UI
  typeLabel:     string;
}

// Map on-chain agentType → Platform execution type
// agentType 0 → JSON_API, agentType 1 → LLM_INFERENCE, agentType 2 → LLM_PARSE_WEBSITE
// Any unknown type defaults to JSON_API (safest fallback)
function toExecutionType(agentType: bigint): 0 | 1 | 2 {
  const n = Number(agentType);
  if (n === 1) return 1;
  if (n === 2) return 2;
  return 0;
}

const TYPE_LABELS: Record<0 | 1 | 2, string> = {
  0: "JSON API",
  1: "AI Inference",
  2: "Web Parse",
};

let _cache: SomniaAgent[] | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchSomniaAgents(): Promise<SomniaAgent[]> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  const provider = new ethers.JsonRpcProvider(HTTP_RPC, SHANNON_NETWORK, {
    staticNetwork: SHANNON_NETWORK,
  });
  const registry = new ethers.Contract(AGENT_REGISTRY_ADDRESS, AGENT_REGISTRY_ABI, provider);

  let total: bigint;
  try {
    total = await registry.getTotalAgents();
  } catch {
    // Registry unreachable — return the 3 canonical Platform agents as fallback
    return getPlatformAgents();
  }

  const agents: SomniaAgent[] = [];
  const count = Number(total);

  // Fetch in parallel batches of 5
  for (let i = 0; i < count; i += 5) {
    const batch = Array.from({ length: Math.min(5, count - i) }, (_, j) =>
      registry.getAgent(BigInt(i + j + 1)).then(raw => {
        const execType = toExecutionType(raw.agentType as bigint);
        return {
          id:           i + j + 1,
          name:         String(raw.name ?? ""),
          description:  String(raw.description ?? ""),
          owner:        String(raw.owner ?? ""),
          isActive:     Boolean(raw.isActive),
          ipfsMetadata: String(raw.ipfsMetadata ?? ""),
          registeredAt: Number(raw.registeredAt ?? 0),
          executionType: execType,
          typeLabel:    "",
        } as SomniaAgent;
      }).catch(() => null)
    );
    const results = await Promise.all(batch);
    for (const a of results) {
      if (a && a.isActive && a.name) {
        a.typeLabel = TYPE_LABELS[a.executionType];
        agents.push(a);
      }
    }
  }

  // Always include the 3 canonical Platform agents if registry is empty or small
  const platform = getPlatformAgents();
  const merged = agents.length > 0 ? agents : platform;

  _cache = merged;
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return merged;
}

// The 3 canonical Shannon Platform execution types — always available as fallback
function getPlatformAgents(): SomniaAgent[] {
  return [
    {
      id: 0, name: "JSON API Agent",
      description: "Fetches data from any public JSON endpoint and extracts a value. Powered by Somnia's consensus-validated JSON_API execution layer.",
      owner: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
      isActive: true, ipfsMetadata: "", registeredAt: 0,
      executionType: 0, typeLabel: "JSON API",
    },
    {
      id: 1, name: "AI Inference Agent",
      description: "Runs deterministic LLM inference (Qwen3-30B) on Somnia's validator network. Produces structured EXECUTE/SKIP decisions with reasoning.",
      owner: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
      isActive: true, ipfsMetadata: "", registeredAt: 0,
      executionType: 1, typeLabel: "AI Inference",
    },
    {
      id: 2, name: "Web Parse Agent",
      description: "Scrapes any URL and extracts structured information using AI. Handles JavaScript-rendered content via Somnia's LLM_PARSE_WEBSITE execution layer.",
      owner: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
      isActive: true, ipfsMetadata: "", registeredAt: 0,
      executionType: 2, typeLabel: "Web Parse",
    },
  ];
}
