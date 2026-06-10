const AGENT_TYPE_NAMES: Record<number, string> = {
  0: "Data Lookup", 1: "AI Decision", 2: "Web Reader", 3: "External Agent"
};

// Known endpoint → friendly name mapping for homepage/proof display
const ENDPOINT_NAMES: Array<{ match: RegExp; name: string }> = [
  { match: /\/api\/agent\/crypto-price/, name: "Live ETH Price" },
  { match: /\/api\/agent\/fear-greed/,   name: "Market Sentiment" },
  { match: /\/api\/agent\/risk-eval/,    name: "Risk Assessment" },
];

export function agentDisplayName(def: { agentType: number; inputTemplate: string }): string {
  // Check known endpoints first
  for (const ep of ENDPOINT_NAMES) {
    if (ep.match.test(def.inputTemplate)) return ep.name;
  }
  // LLM agents in market context
  if (def.agentType === 1 && /market|price|risk|rebalanc|bullish|bearish|sentiment/i.test(def.inputTemplate)) {
    return "Final AI Decision";
  }
  // External agents — extract a readable name from the endpoint path
  if (def.agentType === 3) {
    const match = def.inputTemplate.match(/\/api\/agent\/([^|"}\s]+)/);
    if (match) {
      return match[1]
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return AGENT_TYPE_NAMES[def.agentType] ?? "Agent";
}

export { AGENT_TYPE_NAMES };
