const AGENT_TYPE_NAMES: Record<number, string> = {
  0: "JSON API", 1: "AI Inference", 2: "Web Parse", 3: "External"
};

export function agentDisplayName(def: { agentType: number; inputTemplate: string }): string {
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
