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
    hint: "Format: url|jsonPath|decimals — e.g. https://api.example.com/price|data.price|2",
  },
  1: {
    placeholder: "Analyze this price data and decide whether to rebalance: {prevResult}",
    hint: "Use {prevResult} to reference the previous step's output",
  },
  2: {
    placeholder: "https://example.com|Extract the main headline and key metrics|0",
    hint: "Format: url|extractionPrompt|0",
  },
};

const EXAMPLES = [
  {
    name: "ETH Price Rebalancing",
    steps: [
      { agentType: 0 as const, inputTemplate: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT|price|0", conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 1 as const, inputTemplate: "ETH price is {prevResult} USDT. Decide: EXECUTE rebalancing if price dropped >5% from typical level, SKIP if price is stable or rising.", conditionalOnPrev: false, maxRetries: 2 },
      { agentType: 0 as const, inputTemplate: "https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT|volume|0", conditionalOnPrev: true, maxRetries: 1 },
    ],
  },
  {
    name: "BTC Sentiment Check",
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

function newStep(agentType: 0 | 1 | 2 = 0): StepDraft {
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

  function loadExample(ex: typeof EXAMPLES[0]) {
    setSteps(ex.steps.map(s => ({ ...s, _id: ++idCounter })));
    setError(null);
    setPipelineId(null);
  }

  async function handleSubmit() {
    setError(null);
    const invalid = steps.find(s => !s.inputTemplate.trim());
    if (invalid) {
      setError(`Step ${steps.indexOf(invalid) + 1} needs an input template.`);
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
            Pipeline Composer
          </div>
          <h1 style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 42px)",
            fontStyle: "italic", fontWeight: 400,
            lineHeight: 1.1, letterSpacing: "-0.01em",
            color: "var(--text-hi)", marginBottom: "10px",
          }}>
            Build your own agent flow
          </h1>
          <p style={{
            fontSize: "14px", color: "var(--text-mid)",
            lineHeight: 1.65, maxWidth: "520px",
            fontFamily: "var(--font-sans)",
          }}>
            Chain data fetches, AI reasoning, and web scraping into a multi-step pipeline
            that runs on-chain on the Somnia Shannon testnet.
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
                style={{ fontSize: "12px", padding: "6px 14px" }}
              >
                {ex.name}
              </button>
            ))}
          </div>
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
                        {selectedAgent?.name ?? ["JSON API", "AI Inference", "Web Parse"][step.agentType]}
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

                  {/* Agent picker — live from Somnia registry */}
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: "6px",
                    }}>
                      <div style={{
                        fontSize: "11px", color: "var(--text-lo)",
                        fontFamily: "var(--font-mono)",
                      }}>
                        SELECT AGENT
                      </div>
                      {agentsLoading && (
                        <span style={{ fontSize: "10px", color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>
                          fetching from chain…
                        </span>
                      )}
                      {!agentsLoading && (
                        <span style={{ fontSize: "10px", color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>
                          ◈ {agents.length} agents on Somnia
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {agents.map(a => (
                        <button
                          key={a.id}
                          onClick={() => updateStep(step._id, {
                            agentType: a.executionType,
                            selectedAgentId: a.id,
                          })}
                          title={a.description}
                          style={{
                            fontSize: "11px", fontFamily: "var(--font-mono)",
                            padding: "5px 12px", cursor: "pointer",
                            border: `1px solid ${step.selectedAgentId === a.id ? "var(--brand)" : "var(--border)"}`,
                            background: step.selectedAgentId === a.id ? "var(--brand-dim)" : "transparent",
                            color: step.selectedAgentId === a.id ? "var(--brand)" : "var(--text-lo)",
                            transition: "all 0.15s",
                          }}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                    {selectedAgent && (
                      <div style={{
                        fontSize: "11px", color: "var(--text-lo)",
                        fontFamily: "var(--font-sans)", marginTop: "6px", lineHeight: 1.5,
                      }}>
                        {selectedAgent.description}
                        <span style={{ color: "var(--brand)", marginLeft: "6px" }}>
                          [{selectedAgent.typeLabel}]
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Input template */}
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{
                      fontSize: "11px", color: "var(--text-lo)",
                      fontFamily: "var(--font-mono)", marginBottom: "6px",
                    }}>
                      INPUT TEMPLATE
                    </div>
                    <textarea
                      value={step.inputTemplate}
                      onChange={e => updateStep(step._id, { inputTemplate: e.target.value })}
                      placeholder={typeCfg.placeholder}
                      rows={3}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid var(--border)",
                        color: "var(--text-hi)",
                        fontSize: "12px", fontFamily: "var(--font-mono)",
                        padding: "10px 12px", resize: "vertical",
                        outline: "none", lineHeight: 1.55,
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
                      Skip if previous step failed
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
          <div style={{
            padding: "12px 14px", marginBottom: "16px",
            border: "1px solid rgba(248,113,113,0.3)",
            background: "rgba(248,113,113,0.05)",
            fontSize: "12px", fontFamily: "var(--font-mono)",
            color: "#f87171",
          }}>
            ✕ {error}
          </div>
        )}

        {/* Success */}
        {pipelineId && (
          <div style={{
            padding: "12px 14px", marginBottom: "16px",
            border: "1px solid rgba(74,222,128,0.3)",
            background: "rgba(74,222,128,0.05)",
            fontSize: "12px", fontFamily: "var(--font-mono)",
            color: "var(--ok)",
          }}>
            ✓ Pipeline #{pipelineId} registered on-chain. Redirecting…
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
            {submitting ? "Registering on-chain…" : "Deploy pipeline"}
          </button>
          <span style={{
            fontSize: "11px", color: "var(--text-lo)",
            fontFamily: "var(--font-mono)",
          }}>
            Writes a tx to Somnia Shannon testnet
          </span>
        </div>

        {/* Info */}
        <div style={{
          marginTop: "32px", padding: "16px",
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.01)",
        }}>
          <div style={{
            fontSize: "11px", fontFamily: "var(--font-mono)",
            color: "var(--text-lo)", marginBottom: "8px",
          }}>
            HOW IT WORKS
          </div>
          <ol style={{
            margin: 0, paddingLeft: "20px",
            fontSize: "12px", color: "var(--text-mid)",
            fontFamily: "var(--font-sans)", lineHeight: 1.7,
          }}>
            <li>Your pipeline is registered as a smart contract call on Somnia Shannon testnet</li>
            <li>When triggered, each step is dispatched to our relay which executes the agent</li>
            <li>Results are written back on-chain via <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>ownerHandleResponse()</code></li>
            <li>Every step result is permanently recorded and verifiable on the blockchain explorer</li>
          </ol>
        </div>

      </main>
    </div>
  );
}
