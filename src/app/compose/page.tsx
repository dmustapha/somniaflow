// Pipeline Composer — build and deploy custom multi-agent flows on Somnia
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import type { PipelineStepInput } from "@/types";
import type { SomniaAgent } from "@/lib/agent-registry";

// Placeholder/hint config per execution type
const TYPE_CONFIG: Record<number, { placeholder: string; hint: string }> = {
  0: {
    placeholder: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT|price|0",
    hint: "Paste a public API URL. Format: url|field_to_extract|decimal_places",
  },
  1: {
    placeholder: "Analyze this price data and decide whether to rebalance: {prevResult}",
    hint: "Write instructions for the AI. Use {prevResult} to include the previous step's output.",
  },
  2: {
    placeholder: "https://example.com|Extract the main headline and key metrics|0",
    hint: "Enter a webpage URL and describe what to extract from it.",
  },
  3: {
    placeholder: 'Auto-filled when you select an agent above',
    hint: 'Pick an agent from the list, or type EXTERNAL|endpoint_url|{"param":"value"}',
  },
};

const EXAMPLES = [
  {
    name: "Market Intelligence",
    description: "Checks ETH price, reads market sentiment, evaluates risk, then AI makes a final trade decision.",
    steps: [
      { agentType: 3 as const, inputTemplate: 'EXTERNAL|/api/agent/crypto-price|{"symbol":"eth"}', conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 3 as const, inputTemplate: 'EXTERNAL|/api/agent/fear-greed|{}', conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 3 as const, inputTemplate: 'EXTERNAL|/api/agent/risk-eval|{"change_24h":{prevResult.result.change_24h},"fear_greed":{prevResult.result.value}}', conditionalOnPrev: false, maxRetries: 1 },
      { agentType: 1 as const, inputTemplate: "Market data: {prevResult}. Provide final analysis and EXECUTE/SKIP decision based on the risk evaluation above.", conditionalOnPrev: true, maxRetries: 2 },
    ],
  },
  {
    name: "ETH Price Rebalancing",
    description: "Fetches ETH price, AI decides whether to rebalance, then checks trading volume if conditions are right.",
    steps: [
      { agentType: 0 as const, inputTemplate: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT|price|0", conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 1 as const, inputTemplate: "ETH price is {prevResult} USDT. Decide: EXECUTE rebalancing if price dropped >5% from typical level, SKIP if price is stable or rising.", conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 0 as const, inputTemplate: "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT|volume|0", conditionalOnPrev: true, maxRetries: 1 },
    ],
  },
  {
    name: "BTC Sentiment Check",
    description: "Gets Bitcoin price from CoinGecko, then AI analyzes whether conditions are bullish or bearish.",
    steps: [
      { agentType: 0 as const, inputTemplate: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd|bitcoin.usd|0", conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 1 as const, inputTemplate: "Bitcoin price is {prevResult} USD. Analyze market conditions and decide: EXECUTE if bullish, SKIP if bearish or uncertain.", conditionalOnPrev: false, maxRetries: 2 },
    ],
  },
];

interface StepDraft extends PipelineStepInput {
  _id: number;
  // agent from registry (for display only — execution type is agentType)
  selectedAgentId?: number;
}

let idCounter = 0;

function newStep(agentType: 0 | 1 | 2 | 3 = 0): StepDraft {
  return { _id: ++idCounter, agentType, inputTemplate: "", conditionalOnPrev: false, maxRetries: 2 };
}

export default function ComposePage() {
  const router = useRouter();
  const [steps,         setSteps]        = useState<StepDraft[]>([newStep(0), newStep(1)]);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]        = useState<string | null>(null);
  const [pipelineId,    setPipelineId]   = useState<string | null>(null);
  const [agents,        setAgents]       = useState<SomniaAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [communityOpen, setCommunityOpen] = useState(false);

  // Fetch live agents from Somnia registry on mount
  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.agents)) setAgents(d.agents); })
      .catch(() => {/* silent — compose still works without registry */})
      .finally(() => setAgentsLoading(false));
  }, []);

  function addStep() {
    if (steps.length >= 5) return;
    setSteps(prev => [...prev, newStep(0)]);
  }

  function removeStep(id: number) {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter(s => s._id !== id));
  }

  function updateStep(id: number, patch: Partial<StepDraft>) {
    setSteps(prev => prev.map(s => s._id === id ? { ...s, ...patch } : s));
  }

  /** Build a sensible default template when the user picks an agent */
  function selectAgent(stepId: number, agent: SomniaAgent) {
    const step = steps.find(s => s._id === stepId);
    const patch: Partial<StepDraft> = { agentType: agent.executionType, selectedAgentId: agent.id };
    // Auto-fill template only if empty
    if (!step?.inputTemplate.trim()) {
      if (agent.manifest?.endpoint) {
        // External agent — EXTERNAL|endpoint|{}
        // Use relative path — strip origin if manifest has full URL
        const ep = agent.manifest.endpoint.replace(/^https?:\/\/[^/]+/, "");
        patch.inputTemplate = `EXTERNAL|${ep}|{}`;
      } else {
        // Platform type — use placeholder as starter
        patch.inputTemplate = TYPE_CONFIG[agent.executionType]?.placeholder ?? "";
      }
    }
    updateStep(stepId, patch);
  }

  function loadExample(ex: typeof EXAMPLES[0]) {
    setSteps(ex.steps.map(s => ({ ...s, _id: ++idCounter })));
    setError(null);
    setPipelineId(null);
  }

  async function handleSubmit() {
    setError(null);
    const invalid = steps.find(s => !s.inputTemplate.trim());
    if (invalid) {
      setError(`Step ${steps.indexOf(invalid) + 1} needs instructions. Select an agent or type what this step should do.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/pipeline/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: steps.map(({ _id: _, ...s }) => s),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }
      setPipelineId(data.pipelineId);
      // Redirect to the pipeline page after short delay
      setTimeout(() => router.push(`/pipeline/${data.pipelineId}`), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sf-bg">
      <div className="sf-grain-overlay" aria-hidden="true" />
      <SiteNav right={<div className="sf-chain-badge">◈ Live on Somnia</div>} />

      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "60px 24px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{
            fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "var(--brand)",
            marginBottom: "14px", fontFamily: "var(--font-sans)",
          }}>
            Workflow Builder
          </div>
          <h1 style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 42px)",
            fontStyle: "italic", fontWeight: 400,
            lineHeight: 1.1, letterSpacing: "-0.01em",
            color: "var(--text-hi)", marginBottom: "10px",
          }}>
            Build your own AI workflow
          </h1>
          <p style={{
            fontSize: "14px", color: "var(--text-mid)",
            lineHeight: 1.65, maxWidth: "560px",
            fontFamily: "var(--font-sans)",
          }}>
            Chain AI agents together into a workflow. Each agent does one job (check a price,
            read sentiment, assess risk), then passes its output to the next. The final
            agent reviews everything and makes a decision. Every step is recorded on-chain.
          </p>
        </div>

        {/* Examples */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{
            fontSize: "11px", color: "var(--text-lo)",
            fontFamily: "var(--font-mono)", marginBottom: "10px",
            letterSpacing: "0.06em",
          }}>
            QUICK START
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {EXAMPLES.map(ex => (
              <button
                key={ex.name}
                onClick={() => loadExample(ex)}
                className="sf-btn-ghost"
                title={ex.description}
                style={{ fontSize: "12px", padding: "6px 14px" }}
              >
                {ex.name}
              </button>
            ))}
          </div>
          {steps.length >= 2 && steps[0].inputTemplate && (
            <div style={{
              marginTop: "8px", fontSize: "11px", color: "var(--text-lo)",
              fontFamily: "var(--font-sans)", fontStyle: "italic",
            }}>
              {EXAMPLES.find(ex => ex.steps[0]?.inputTemplate === steps[0].inputTemplate)?.description ?? ""}
            </div>
          )}
        </div>

        {/* Steps */}
        <div style={{ marginBottom: "24px" }}>
          {steps.map((step, i) => {
            const typeCfg = TYPE_CONFIG[step.agentType] ?? TYPE_CONFIG[0];
            const selectedAgent = agents.find(a => a.id === step.selectedAgentId);
            return (
              <div key={step._id} style={{ marginBottom: "12px" }}>
                <div className="sf-glass" style={{ padding: "20px" }}>

                  {/* Step header */}
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginBottom: "14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{
                        fontSize: "10px", fontFamily: "var(--font-mono)",
                        color: "var(--text-lo)", letterSpacing: "0.1em",
                      }}>
                        STEP {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ color: "var(--border)" }}>·</span>
                      <span style={{
                        fontSize: "10px", fontFamily: "var(--font-mono)",
                        color: "var(--brand)",
                      }}>
                        {selectedAgent?.name ?? ["Data Lookup", "AI Analysis", "Web Reader", "Custom Agent"][step.agentType]}
                      </span>
                    </div>
                    {steps.length > 1 && (
                      <button
                        onClick={() => removeStep(step._id)}
                        style={{
                          background: "none", border: "none",
                          color: "var(--text-lo)", cursor: "pointer",
                          fontSize: "14px", padding: "2px 6px",
                          fontFamily: "var(--font-mono)",
                        }}
                        title="Remove step"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Agent picker — tiered by category */}
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: "6px",
                    }}>
                      <div style={{
                        fontSize: "11px", color: "var(--text-lo)",
                        fontFamily: "var(--font-mono)",
                      }}>
                        CHOOSE AN AI STEP
                      </div>
                      {agentsLoading && (
                        <span style={{ fontSize: "10px", color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>
                          loading available agents…
                        </span>
                      )}
                      {!agentsLoading && (
                        <span style={{ fontSize: "10px", color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>
                          ◈ {agents.length} agents available
                        </span>
                      )}
                    </div>

                    {/* SomniaFlow agents — green highlight */}
                    {(() => {
                      const sfAgents = agents.filter(a => a.category === "somniaflow");
                      if (sfAgents.length === 0) return null;
                      return (
                        <div style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--ok)", letterSpacing: "0.08em", marginBottom: "4px" }}>
                            SOMNIAFLOW AGENTS — ready to use
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {sfAgents.map(a => (
                              <button
                                key={a.id}
                                onClick={() => selectAgent(step._id, a)}
                                title={a.description}
                                style={{
                                  fontSize: "11px", fontFamily: "var(--font-mono)",
                                  padding: "5px 12px", cursor: "pointer",
                                  border: `1px solid ${step.selectedAgentId === a.id ? "var(--ok)" : "rgba(74,222,128,0.25)"}`,
                                  background: step.selectedAgentId === a.id ? "rgba(74,222,128,0.1)" : "transparent",
                                  color: step.selectedAgentId === a.id ? "var(--ok)" : "rgba(74,222,128,0.7)",
                                  transition: "all 0.15s",
                                  borderRadius: "6px",
                                }}
                              >
                                {a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Platform agents — brand highlight */}
                    {(() => {
                      const plAgents = agents.filter(a => a.category === "platform");
                      if (plAgents.length === 0) return null;
                      return (
                        <div style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--brand)", letterSpacing: "0.08em", marginBottom: "4px" }}>
                            SOMNIA PLATFORM — bring your own data
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {plAgents.map(a => (
                              <button
                                key={a.id}
                                onClick={() => selectAgent(step._id, a)}
                                title={a.description}
                                style={{
                                  fontSize: "11px", fontFamily: "var(--font-mono)",
                                  padding: "5px 12px", cursor: "pointer",
                                  border: `1px solid ${step.selectedAgentId === a.id ? "var(--brand)" : "var(--border)"}`,
                                  background: step.selectedAgentId === a.id ? "var(--brand-dim)" : "transparent",
                                  color: step.selectedAgentId === a.id ? "var(--brand)" : "var(--text-lo)",
                                  transition: "all 0.15s",
                                  borderRadius: "6px",
                                }}
                              >
                                {a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Community agents — collapsed, deduped, callable-only when expanded */}
                    {(() => {
                      const comAgents = agents.filter(a => a.category === "community");
                      if (comAgents.length === 0) return null;
                      // Deduplicate by normalized name (strip "(view)", whitespace, case)
                      const seen = new Set<string>();
                      const unique = comAgents
                        .sort((a, b) => (b.callable ? 1 : 0) - (a.callable ? 1 : 0))
                        .filter(a => {
                          const key = a.name.toLowerCase().replace(/\s*\(view\)\s*/g, "").trim();
                          if (!key || seen.has(key)) return false;
                          seen.add(key);
                          return true;
                        });
                      // Only show callable agents when expanded (non-callable are noise)
                      const callable = unique.filter(a => a.callable);
                      const totalOnChain = comAgents.length;
                      return (
                        <div style={{ marginBottom: "4px" }}>
                          <button
                            onClick={() => setCommunityOpen(prev => !prev)}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              fontSize: "10px", fontFamily: "var(--font-mono)",
                              color: "rgba(96,165,250,0.5)", letterSpacing: "0.08em",
                              marginBottom: "4px", padding: 0,
                              display: "flex", alignItems: "center", gap: "4px",
                            }}
                          >
                            <span style={{ fontSize: "8px" }}>{communityOpen ? "▼" : "▶"}</span>
                            {communityOpen
                              ? `COMMUNITY (${callable.length} available)`
                              : `+ ${totalOnChain} community-built agents`}
                          </button>
                          {communityOpen && (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {callable.length > 0 ? callable.map(a => (
                                <button
                                  key={a.id}
                                  onClick={() => selectAgent(step._id, a)}
                                  title={a.description}
                                  style={{
                                    fontSize: "11px", fontFamily: "var(--font-mono)",
                                    padding: "5px 12px", cursor: "pointer",
                                    border: `1px solid ${step.selectedAgentId === a.id ? "rgba(96,165,250,0.6)" : "rgba(96,165,250,0.15)"}`,
                                    background: step.selectedAgentId === a.id ? "rgba(96,165,250,0.08)" : "transparent",
                                    color: "rgba(96,165,250,0.7)",
                                    transition: "all 0.15s",
                                    borderRadius: "6px",
                                  }}
                                >
                                  {a.name}
                                </button>
                              )) : (
                                <span style={{
                                  fontSize: "11px", fontFamily: "var(--font-mono)",
                                  color: "rgba(96,165,250,0.35)", padding: "5px 0",
                                }}>
                                  No community agents available yet. {unique.length} registered but not callable.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {selectedAgent ? (
                      <div style={{
                        fontSize: "11px", color: "var(--text-mid)",
                        fontFamily: "var(--font-sans)", marginTop: "8px", lineHeight: 1.5,
                        padding: "8px 10px", background: "rgba(74,222,128,0.04)",
                        border: "1px solid rgba(74,222,128,0.15)", borderRadius: "6px",
                      }}>
                        <span style={{ fontWeight: 600, color: "var(--ok)" }}>{selectedAgent.name}</span>
                        {" — "}{selectedAgent.description}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: "11px", color: "var(--text-lo)",
                        fontFamily: "var(--font-sans)", marginTop: "6px", lineHeight: 1.5,
                        fontStyle: "italic",
                      }}>
                        Pick an agent to see what it does
                      </div>
                    )}
                  </div>

                  {/* Input template */}
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{
                      fontSize: "11px", color: "var(--text-lo)",
                      fontFamily: "var(--font-mono)", marginBottom: "6px",
                    }}>
                      INSTRUCTIONS
                    </div>
                    <textarea
                      value={step.inputTemplate}
                      onChange={e => updateStep(step._id, { inputTemplate: e.target.value })}
                      placeholder={typeCfg.placeholder}
                      rows={3}
                      onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 1px rgba(34,211,238,0.15)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = "rgba(22,45,66,0.8)"; e.currentTarget.style.boxShadow = "none"; }}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(22,45,66,0.8)",
                        borderRadius: "8px",
                        color: "var(--text-hi)",
                        fontSize: "12px", fontFamily: "var(--font-mono)",
                        padding: "10px 12px", resize: "vertical",
                        outline: "none", lineHeight: 1.55,
                        transition: "border-color 0.2s, box-shadow 0.2s",
                      }}
                    />
                    <div style={{
                      fontSize: "10px", color: "var(--text-lo)",
                      fontFamily: "var(--font-sans)", marginTop: "4px",
                    }}>
                      {typeCfg.hint}
                    </div>
                  </div>

                  {/* Options row */}
                  <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      fontSize: "11px", fontFamily: "var(--font-mono)",
                      color: "var(--text-lo)", cursor: "pointer",
                    }}>
                      <input
                        type="checkbox"
                        checked={step.conditionalOnPrev}
                        onChange={e => updateStep(step._id, { conditionalOnPrev: e.target.checked })}
                        style={{ accentColor: "var(--brand)" }}
                      />
                      Optional: only run if the previous step says go ahead
                    </label>
                    <label style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      fontSize: "11px", fontFamily: "var(--font-mono)",
                      color: "var(--text-lo)",
                    }}>
                      <span>Retries:</span>
                      <select
                        value={step.maxRetries}
                        onChange={e => updateStep(step._id, { maxRetries: parseInt(e.target.value) })}
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid var(--border)",
                          color: "var(--text-mid)",
                          fontSize: "11px", fontFamily: "var(--font-mono)",
                          padding: "2px 6px", cursor: "pointer",
                          borderRadius: "6px",
                        }}
                      >
                        <option value={0}>0</option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                  </div>

                </div>

                {/* Connector */}
                {i < steps.length - 1 && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    height: "20px",
                  }}>
                    <div style={{
                      width: "1px", height: "20px",
                      background: "var(--border)",
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add step */}
        {steps.length < 5 && (
          <button
            onClick={addStep}
            className="sf-btn-ghost"
            style={{ width: "100%", marginBottom: "24px", fontSize: "12px" }}
          >
            + Add step ({steps.length}/5)
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="sf-shake" style={{
            padding: "12px 14px", marginBottom: "16px",
            border: "1px solid rgba(248,113,113,0.3)",
            background: "rgba(248,113,113,0.05)",
            fontSize: "12px", fontFamily: "var(--font-mono)",
            color: "#f87171",
            borderRadius: "8px",
          }}>
            ✕ {error}
          </div>
        )}

        {/* Success */}
        {pipelineId && (
          <div className="sf-scale-in" style={{
            padding: "12px 14px", marginBottom: "16px",
            border: "1px solid rgba(74,222,128,0.3)",
            background: "rgba(74,222,128,0.05)",
            fontSize: "12px", fontFamily: "var(--font-mono)",
            color: "var(--ok)",
            borderRadius: "8px",
          }}>
            ✓ Workflow #{pipelineId} created on the blockchain. Redirecting…
          </div>
        )}

        {/* Submit */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={handleSubmit}
            disabled={submitting || !!pipelineId}
            className="sf-btn-primary"
            style={{ minWidth: "200px" }}
          >
            {submitting ? "Creating workflow…" : "Create workflow"}
          </button>
          <span style={{
            fontSize: "11px", color: "var(--text-lo)",
            fontFamily: "var(--font-mono)",
          }}>
            Saves your workflow to the blockchain
          </span>
        </div>

        {/* How it works */}
        <div style={{
          marginTop: "32px", padding: "16px 18px",
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.01)",
          borderRadius: "8px",
          fontSize: "12px", color: "var(--text-lo)",
          fontFamily: "var(--font-sans)", lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, color: "var(--text-hi)", marginBottom: "8px", fontSize: "13px" }}>
            What happens when you create a workflow
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div><span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>1.</span> Your steps are saved to the Somnia blockchain as a permanent record.</div>
            <div><span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>2.</span> When you run the workflow, each step executes in order. Step outputs feed into the next step.</div>
            <div><span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>3.</span> If a step produces a PROCEED/SKIP decision, the next step can be configured to run only if the decision is PROCEED.</div>
            <div><span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>4.</span> Every result is permanently recorded on-chain. Anyone can verify what happened.</div>
          </div>
        </div>

      </main>
    </div>
  );
}
