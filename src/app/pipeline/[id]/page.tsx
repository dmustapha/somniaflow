// [VERIFIED] — Next.js 14 App Router + SSE via EventSource — Observatory design
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StepCard } from "@/components/StepCard";
import { SiteNav } from "@/components/SiteNav";
import { parsePipelineDecision } from "@/lib/parse-decision";
import type { PipelineSSEEvent, PipelineStepStatus, PipelineDecision, PipelineStepDef } from "@/types";

const EXPLORER = "https://shannon-explorer.somnia.network";

// ── Step context: human-readable names, descriptions, and formatters ──
// Maps agent endpoint patterns → what this step does in plain English.

interface StepContext {
  label:    string;
  sublabel: string;
  format:   (raw: string) => string;
}

const STEP_PATTERNS: Array<{
  match: (def: PipelineStepDef) => boolean;
  ctx:   StepContext;
}> = [
  {
    match: d => d.inputTemplate.includes("/api/agent/crypto-price"),
    ctx: {
      label: "Live ETH Price",
      sublabel: "Fetches the current ETH price from market data",
      format: raw => {
        try {
          const p = JSON.parse(raw);
          const dir = Number(p.change_24h) >= 0 ? "up" : "down";
          return `${p.symbol ?? "ETH"} is at $${Number(p.price).toLocaleString()} (${dir} ${Math.abs(p.change_24h)}% today)`;
        } catch { return raw; }
      },
    },
  },
  {
    match: d => d.inputTemplate.includes("/api/agent/fear-greed"),
    ctx: {
      label: "Market Sentiment",
      sublabel: "Reads the crypto market fear and greed index",
      format: raw => {
        try {
          const p = JSON.parse(raw);
          const mood = String(p.classification ?? "").toLowerCase();
          const arrow = p.trend === "rising" ? "trending up" : p.trend === "falling" ? "trending down" : "holding steady";
          return `Market mood: ${mood} (${p.value}/100), ${arrow}`;
        } catch { return raw; }
      },
    },
  },
  {
    match: d => d.inputTemplate.includes("/api/agent/risk-eval"),
    ctx: {
      label: "Risk Assessment",
      sublabel: "Calculates whether conditions favor trading",
      format: raw => raw, // decision card handles this
    },
  },
  {
    match: d => d.agentType === 1 && /market|price|risk|rebalanc|bullish|bearish|sentiment/i.test(d.inputTemplate),
    ctx: {
      label: "Final AI Decision",
      sublabel: "AI reviews all the data and makes the final call",
      format: raw => raw, // decision card handles this
    },
  },
  {
    match: d => d.inputTemplate.includes("ticker/price") || d.inputTemplate.includes("simple/price"),
    ctx: {
      label: "Live Price Check",
      sublabel: "Gets the current price from a market API",
      format: raw => { const n = Number(raw.trim()); return !isNaN(n) ? `Current price: $${n.toLocaleString()}` : raw; },
    },
  },
  {
    match: d => d.inputTemplate.includes("ticker/24hr"),
    ctx: {
      label: "Trading Volume",
      sublabel: "Checks how much is being traded right now",
      format: raw => { const n = Number(raw.trim()); return !isNaN(n) ? `24h trading volume: $${n.toLocaleString()}` : raw; },
    },
  },
];

// Fallback labels when no pattern matches
const FALLBACK_LABELS: Record<number, { name: string; sublabel: string }> = {
  0: { name: "Data Lookup",     sublabel: "Fetches live data from an API" },
  1: { name: "AI Decision",     sublabel: "AI analyzes the data and decides" },
  2: { name: "Web Reader",      sublabel: "Reads and extracts info from a webpage" },
  3: { name: "External Agent",  sublabel: "Runs a specialized agent" },
};

function getStepContext(def: PipelineStepDef): StepContext | null {
  for (const p of STEP_PATTERNS) {
    if (p.match(def)) return p.ctx;
  }
  return null;
}

function stepLabel(def: PipelineStepDef): string {
  const ctx = getStepContext(def);
  if (ctx) return ctx.label;
  // Fallback: try to extract a name from external agent endpoint
  if (def.agentType === 3) {
    const match = def.inputTemplate.match(/\/api\/agent\/([^|"}\s]+)/);
    if (match) return match[1].split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return FALLBACK_LABELS[def.agentType]?.name ?? `Step ${def.index + 1}`;
}

function stepSublabel(def: PipelineStepDef): string {
  return getStepContext(def)?.sublabel ?? FALLBACK_LABELS[def.agentType]?.sublabel ?? "";
}

function stepFormatter(def: PipelineStepDef): ((raw: string) => string) {
  const ctx = getStepContext(def);
  return ctx?.format ?? defaultFormat;
}

/** Step-specific loading messages */
function pendingCopyFor(def: PipelineStepDef): string {
  if (def.inputTemplate.includes("/api/agent/crypto-price")) return "Checking ETH price...";
  if (def.inputTemplate.includes("/api/agent/fear-greed"))   return "Reading market sentiment...";
  if (def.inputTemplate.includes("/api/agent/risk-eval"))    return "Calculating risk level...";
  if (def.agentType === 1)                                    return "AI reviewing the data...";
  return "Fetching data...";
}

/** Default formatter for results that don't match any step pattern */
function defaultFormat(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();

  if (trimmed.startsWith("ERROR:") || trimmed.startsWith("error:")) return trimmed;
  if (trimmed.includes("DECISION:")) return trimmed; // decision card handles this
  if (/^https?:\/\/\S+$/.test(trimmed)) return trimmed;

  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") {
    return num >= 1000 ? `$${num.toLocaleString()}` : String(num);
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const preview = parsed.slice(0, 3).map((item: unknown) =>
        typeof item === "object" && item !== null
          ? Object.entries(item as Record<string, unknown>).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(", ")
          : String(item)
      ).join(" | ");
      return `[${parsed.length} items] ${preview}${parsed.length > 3 ? " ..." : ""}`;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      if (keys.length <= 5) {
        return keys.map(k => {
          const v = (parsed as Record<string, unknown>)[k];
          const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          if (typeof v === "number") return `${label}: ${v >= 1000 ? v.toLocaleString() : v}`;
          if (typeof v === "string" && v.length > 40) return `${label}: ${v.substring(0, 40)}...`;
          return `${label}: ${v}`;
        }).join(" · ");
      }
      return JSON.stringify(parsed, null, 2).substring(0, 400);
    }
  } catch { /* not JSON */ }

  return raw.length > 200 ? raw.substring(0, 200) + "..." : raw;
}

interface StepState {
  status:         PipelineStepStatus;
  result?:        string;
  streamingText?: string;
  decision?:      PipelineDecision;
  durationMs?:    number;
  sttCost?:       string;
  requestId?:     string;
  txHash?:        string;
  sseAgentType?:  number; // from SSE events when stepDefs not loaded
}

function makeInitialSteps(count: number): StepState[] {
  return Array.from({ length: count }, () => ({ status: "idle" as PipelineStepStatus }));
}

export default function PipelinePage({ params }: { params: { id: string } }) {
  const [stepDefs,   setStepDefs]   = useState<PipelineStepDef[]>([]);
  const [steps,      setSteps]      = useState<StepState[]>(makeInitialSteps(3));
  const [pipeStatus, setPipeStatus] = useState<"idle" | "running" | "complete" | "failed">("idle");
  const [totalMs,    setTotalMs]    = useState<number | null>(null);
  const [txHashes,    setTxHashes]   = useState<string[]>([]);
  const [isSimulated, setIsSimulated] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const stepCount = stepDefs.length > 0 ? stepDefs.length : steps.length;
  const pipelineName = stepDefs.length > 0
    ? stepDefs.map(d => stepLabel(d)).join(" → ")
    : `Pipeline #${params.id}`;
  const pipelineTagline = stepDefs.length > 0
    ? `${stepCount}-step workflow · every result saved to the blockchain`
    : `${stepCount} steps`;

  const sseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startSSE(autoSimulate?: "execute" | "skip", trigger?: boolean) {
    if (esRef.current) esRef.current.close();
    if (sseTimeoutRef.current) clearTimeout(sseTimeoutRef.current);

    const url = autoSimulate
      ? `/api/pipeline/${params.id}/stream?autoSimulate=${autoSimulate}`
      : trigger
        ? `/api/pipeline/${params.id}/stream?trigger=true`
        : `/api/pipeline/${params.id}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (e) => handleEvent(JSON.parse(e.data) as PipelineSSEEvent);
    es.onerror   = () => {
      setError("Lost connection — the run may still be completing. Refresh to check.");
      es.close();
    };

    // 90-second timeout: guard against hung pipelines
    sseTimeoutRef.current = setTimeout(() => {
      if (esRef.current === es) {
        es.close();
        setPipeStatus("failed");
        setError("Timed out after 90 seconds. Please try again.");
      }
    }, 90_000);
  }

  function handleEvent(event: PipelineSSEEvent) {
    switch (event.type) {
      case "pipeline_started":
        setPipeStatus("running");
        setTxHashes([]);
        setSteps(makeInitialSteps(event.data.stepCount || stepCount));
        break;

      case "step_dispatched": {
        // Map SSE agent type string → numeric type for StepCard rendering
        const AGENT_TYPE_MAP: Record<string, number> = { JSON_API: 0, LLM_INFERENCE: 1, LLM_PARSE_WEBSITE: 2, EXTERNAL: 3 };
        const sseType = AGENT_TYPE_MAP[event.data.agentType] ?? 0;
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], status: "pending", requestId: event.data.requestId, sseAgentType: sseType };
          return n;
        });
        break;
      }

      case "step_complete": {
        const rawResult = event.data.result;
        const hasDecision = rawResult?.includes("DECISION:");
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = {
            ...n[event.data.step],
            status:     "complete",
            result:     rawResult,
            decision:   hasDecision ? parsePipelineDecision(rawResult) : n[event.data.step].decision,
            durationMs: event.data.durationMs,
            sttCost:    event.data.sttCost,
            txHash:     event.data.txHash,
          };
          return n;
        });
        break;
      }

      case "decision": {
        // Attach decision to the step that produced it
        // Find the most recently completed step with a DECISION result (any agent type)
        setSteps(prev => {
          const n = [...prev];
          // Search backwards for the most recently completed step with DECISION in result
          let targetIdx = -1;
          for (let i = n.length - 1; i >= 0; i--) {
            if (n[i].status === "complete" && n[i].result?.includes("DECISION:") && !n[i].decision) {
              targetIdx = i;
              break;
            }
          }
          // Fallback: find any LLM step
          if (targetIdx < 0) targetIdx = stepDefs.findIndex(d => d.agentType === 1);
          if (targetIdx >= 0 && n[targetIdx]) {
            n[targetIdx] = { ...n[targetIdx], decision: event.data };
          }
          return n;
        });
        break;
      }

      case "step_skipped":
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], status: "skipped" };
          return n;
        });
        break;

      case "step_reasoning":
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], streamingText: event.data.chunk };
          return n;
        });
        break;

      case "step_retrying":
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], status: "retrying" };
          return n;
        });
        break;

      case "pipeline_complete":
        if (sseTimeoutRef.current) { clearTimeout(sseTimeoutRef.current); sseTimeoutRef.current = null; }
        setPipeStatus("complete");
        setTotalMs(event.data.totalMs);
        setTxHashes(event.data.txHashes ?? []);
        setIsSimulated(event.data.simulated === true);
        esRef.current?.close();
        break;

      case "pipeline_failed":
        if (sseTimeoutRef.current) { clearTimeout(sseTimeoutRef.current); sseTimeoutRef.current = null; }
        setPipeStatus("failed");
        setError(`Run failed at step ${event.data.step + 1}: ${event.data.reason}`);
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], status: "failed" };
          return n;
        });
        esRef.current?.close();
        break;
    }
  }

  async function handleSimulate(branch: "execute" | "skip") {
    if (triggering || pipeStatus === "running") return;
    setTriggering(true);
    setError(null);
    setSteps(makeInitialSteps(stepCount));
    setTotalMs(null);
    setTxHashes([]);
    setIsSimulated(false);
    startSSE(branch);
    setTriggering(false);
  }

  async function handleTrigger() {
    if (triggering || pipeStatus === "running") return;
    setTriggering(true);
    setError(null);
    setSteps(makeInitialSteps(stepCount));
    setTotalMs(null);
    setTxHashes([]);
    setIsSimulated(false);
    // Pass trigger=true so relay + event listener + tx all run in the same
    // serverless function instance — Vercel-safe, no cross-process pipelineBus.
    startSSE(undefined, true);
    setTriggering(false);
  }

  // Load previous run state on mount + URL param auto-trigger
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch(`/api/pipeline/${params.id}/state`);
        if (!res.ok) return;
        const state = await res.json();

        // Load step definitions so labels are accurate
        if (Array.isArray(state.steps) && state.steps.length > 0) {
          setStepDefs(state.steps);
        }

        if (state.status === "Idle" || !state.stepResults?.length) return;

        const count = state.steps?.length || state.stepStatuses?.length || 4;
        setSteps(Array.from({ length: count }, (_, i) => {
          // Detect DECISION format in any step result (LLM or external risk-eval)
          const hasDecision = state.stepResults?.[i]?.includes("DECISION:");
          return {
            status: (state.stepStatuses?.[i] ?? "idle") as PipelineStepStatus,
            result: state.stepResults?.[i] || undefined,
            decision: hasDecision
              ? parsePipelineDecision(state.stepResults[i])
              : undefined,
          };
        }));
        if (state.status === "Complete") setPipeStatus("complete");
        if (state.status === "Failed")   setPipeStatus("failed");
      } catch { /* silent */ }
    }

    loadHistory().then(() => {
      // Auto-trigger from URL param after history loads
      const sp = new URLSearchParams(window.location.search);
      const demoParam = sp.get("demo") as "execute" | "skip" | null;
      if (demoParam === "execute" || demoParam === "skip") {
        window.history.replaceState({}, "", `/pipeline/${params.id}`);
        handleSimulate(demoParam);
      }
    });

    return () => {
      esRef.current?.close();
      if (sseTimeoutRef.current) clearTimeout(sseTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const isRunning    = pipeStatus === "running" || triggering;
  const isComplete   = pipeStatus === "complete";
  const isFailed     = pipeStatus === "failed";
  const isSkipBranch = steps.some(s => s.status === "skipped");
  const decision     = steps.find(s => s.decision)?.decision;

  const eyebrow = pipeStatus === "idle"     ? "Ready to start"
                : pipeStatus === "running"  ? "Workflow running now"
                : pipeStatus === "complete" ? "Run complete"
                : "Run failed";

  return (
    <div className="sf-bg">
      <div className="sf-grain-overlay" aria-hidden="true" />

      <SiteNav right={<div className="sf-chain-badge">◈ Live on Somnia</div>} />

      {/* Main — asymmetric 60/40, mobile: controls stack above trace */}
      <main
        className="sf-main-grid"
        style={{
          maxWidth: "1200px", margin: "0 auto",
          display: "grid", gridTemplateColumns: "60% 40%",
          minHeight: "calc(100dvh - 49px)",
        }}
      >

        {/* Left: editorial + execution trace */}
        <div
          className="sf-pipeline-trace"
          style={{
            padding: "60px 48px 48px 36px",
            borderRight: "1px solid var(--border)",
            display: "flex", flexDirection: "column",
          }}
        >
          <Link
            href="/"
            style={{
              fontSize: "12px", fontFamily: "var(--font-mono)",
              color: "var(--text-mid)", textDecoration: "none",
              marginBottom: "14px", display: "inline-block",
            }}
          >
            ← Back to home
          </Link>

          <div style={{
            fontSize: "12px", fontWeight: 600, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--brand)",
            marginBottom: "18px", fontFamily: "var(--font-sans)",
          }}>
            {eyebrow}
          </div>

          <h1 style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3vw, 40px)",
            fontStyle: "italic", fontWeight: 400,
            lineHeight: 1.1, letterSpacing: "-0.01em",
            color: "var(--text-hi)", marginBottom: "6px",
          }}>
            {pipelineName}
          </h1>
          <div style={{
            fontSize: "13px", fontFamily: "var(--font-mono)",
            color: "var(--text-mid)", marginBottom: "14px",
          }}>
            {pipelineTagline}
          </div>

          {/* Status line */}
          <div style={{ marginBottom: "28px", minHeight: "22px" }}>
            {isRunning && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div className="sf-live-dot" />
                <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--ok)" }}>
                  workflow running...
                </span>
              </div>
            )}
            {isComplete && totalMs !== null && (
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--ok)" }}>
                ✓ completed in {(totalMs / 1000).toFixed(2)}s
              </span>
            )}
            {isFailed && (
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "#f87171" }}>
                ✕ run failed
              </span>
            )}
            {!isRunning && !isComplete && !isFailed && (
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
                {stepCount} step{stepCount !== 1 ? "s" : ""}{stepDefs.length > 0 ? `: ${pipelineTagline.toLowerCase()}` : ""}
              </span>
            )}
          </div>

          {/* Idle instruction */}
          {pipeStatus === "idle" && !steps.some(s => s.status !== "idle") && (
            <p style={{
              fontSize: "13px", color: "var(--text-lo)", marginBottom: "28px",
              fontFamily: "var(--font-sans)", lineHeight: 1.6, maxWidth: "460px",
            }}>
              Run a demo to watch each AI step execute in real time, or trigger a live run on the blockchain.
            </p>
          )}

          {/* Execution trace */}
          <div>
            {steps.map((step, i) => {
              const def = stepDefs[i];
              return (
                <div key={i}>
                  <StepCard
                    index={i}
                    agentType={def?.agentType ?? step.sseAgentType ?? 0}
                    status={step.status}
                    result={step.result}
                    streamingText={step.streamingText}
                    decision={step.decision}
                    durationMs={step.durationMs}
                    sttCost={step.sttCost}
                    requestId={step.requestId}
                    txHash={step.txHash}
                    label={def ? stepLabel(def) : (FALLBACK_LABELS[step.sseAgentType ?? 0]?.name ?? `Step ${i + 1}`)}
                    sublabel={def ? stepSublabel(def) : (FALLBACK_LABELS[step.sseAgentType ?? 0]?.sublabel ?? undefined)}
                    conditional={def?.conditionalOnPrev ? "Only runs if the previous step says go ahead" : undefined}
                    formatResult={def ? stepFormatter(def) : defaultFormat}
                    pendingCopy={
                      def ? pendingCopyFor(def)
                      : (step.sseAgentType === 1 ? "AI analyzing data..."
                      : "Fetching data...")
                    }
                  />
                  {i < steps.length - 1 && <div className="sf-connector" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: controls — description first, then run, then completion */}
        <div
          className="sf-pipeline-controls"
          style={{
            padding: "60px 36px 48px 32px",
            display: "flex", flexDirection: "column",
            gap: "16px",
          }}
        >

          {/* Pipeline description */}
          <div className="sf-glass" style={{ padding: "20px" }}>
            <div style={{
              fontSize: "13px", fontWeight: 600,
              color: "var(--text-hi)", marginBottom: "12px",
              fontFamily: "var(--font-sans)",
            }}>
              How this workflow runs
            </div>
            <p style={{
              fontSize: "12px", color: "var(--text-mid)",
              lineHeight: 1.6, margin: "0 0 12px",
              fontFamily: "var(--font-sans)",
            }}>
              {stepDefs.length > 0
                ? "Each step gathers data or makes a decision, then passes the result to the next step. The AI at the end reviews everything and decides whether to act."
                : "Multi-step AI workflow running on the Somnia blockchain."}
            </p>
            {stepDefs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
                {stepDefs.map((def, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    fontSize: "11px", fontFamily: "var(--font-sans)", color: "var(--text-mid)",
                  }}>
                    <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--text-lo)", minWidth: "14px" }}>{i + 1}.</span>
                    <span style={{ fontWeight: 600, color: "var(--text-hi)" }}>{stepLabel(def)}</span>
                    <span style={{ color: "var(--text-lo)" }}>{stepSublabel(def)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{
              padding: "10px 12px", marginBottom: "8px",
              border: "1px solid rgba(74,222,128,0.2)",
              background: "rgba(74,222,128,0.03)",
              fontSize: "11px", color: "var(--text-mid)",
              fontFamily: "var(--font-sans)", lineHeight: 1.55,
              borderRadius: "8px",
            }}>
              <span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>PROCEED</span>
              {" "}— The AI says conditions look good. All steps run and every result is permanently saved on the blockchain.
            </div>
            <div style={{
              padding: "10px 12px",
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.01)",
              fontSize: "11px", color: "var(--text-mid)",
              fontFamily: "var(--font-sans)", lineHeight: 1.55,
              borderRadius: "8px",
            }}>
              <span style={{ color: "var(--text-lo)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>SKIP</span>
              {" "}— The AI says conditions are unfavorable. Some steps are skipped, and the skip decision is recorded on-chain as proof.
            </div>
          </div>

          {/* Run card */}
          <div className="sf-glass" style={{ padding: "20px" }}>
            <div style={{
              fontSize: "13px", fontWeight: 600,
              color: "var(--text-hi)", marginBottom: "4px",
              fontFamily: "var(--font-sans)",
            }}>
              Run Workflow
            </div>
            <div style={{
              fontSize: "11px", color: "var(--text-lo)",
              fontFamily: "var(--font-sans)", marginBottom: "14px", lineHeight: 1.5,
            }}>
              Live mode saves results to the blockchain. Demo mode runs a simulation.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => handleSimulate("execute")}
                disabled={isRunning}
                className="sf-btn-primary"
                style={{ width: "100%", textAlign: "center" }}
              >
                {isRunning ? "Running..." : "▶ Run demo: all steps execute"}
              </button>
              <button
                onClick={() => handleSimulate("skip")}
                disabled={isRunning}
                className="sf-btn-ghost"
                style={{ width: "100%", textAlign: "center" }}
              >
                Run demo: AI skips a step
              </button>
              <div style={{
                fontSize: "10px", color: "var(--text-lo)",
                fontFamily: "var(--font-mono)", textAlign: "center",
                letterSpacing: "0.06em", marginTop: "4px",
              }}>
                or run it for real on the blockchain
              </div>
              <button
                onClick={handleTrigger}
                disabled={isRunning}
                className="sf-btn-ghost"
                title="Runs on the real blockchain — results are permanently saved"
                style={{ width: "100%", textAlign: "center", fontSize: "11px" }}
              >
                Run on blockchain (live)
              </button>
            </div>

            {error && (
              <div className="sf-shake" style={{
                marginTop: "12px", padding: "10px 12px",
                border: "1px solid rgba(248,113,113,0.3)",
                background: "rgba(248,113,113,0.05)",
                fontSize: "11px", fontFamily: "var(--font-mono)",
                color: "#f87171", lineHeight: 1.5,
                borderRadius: "8px",
              }}>
                ✕ {error}
              </div>
            )}
          </div>

          {/* Completion summary — what just happened */}
          {isComplete && (
            <div className="sf-glass sf-glass-raised sf-scale-in" style={{ padding: "20px" }}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: "14px",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-hi)", fontFamily: "var(--font-sans)" }}>
                  What just happened
                </div>
                <span style={{
                  fontSize: "10px", padding: "3px 8px",
                  border: `1px solid ${isSimulated ? "var(--border)" : "rgba(74,222,128,0.3)"}`,
                  color: isSimulated ? "var(--text-lo)" : "var(--ok)",
                  fontFamily: "var(--font-mono)", fontWeight: 600,
                  borderRadius: "20px",
                }}>
                  {isSimulated ? "DEMO RUN" : "RECORDED"}
                </span>
              </div>

              {decision && (
                <div className="sf-dr">
                  <span className="sf-dr-key">AI verdict</span>
                  <span className={`sf-dr-val ${decision.decision === "EXECUTE" ? "ok" : ""}`}>
                    {decision.decision === "EXECUTE" ? "Proceed with trade" : "Skip this time"}
                    {decision.swapPct > 0 && ` · ${decision.swapPct}% allocation`}
                  </span>
                </div>
              )}
              <div className="sf-dr">
                <span className="sf-dr-key">Path taken</span>
                <span className="sf-dr-val">
                  {isSkipBranch
                    ? `Skip path · ${steps.filter(s => s.status === "complete").length} steps ran`
                    : `Full run · ${steps.filter(s => s.status === "complete").length} steps ran`}
                </span>
              </div>
              <div className="sf-dr">
                <span className="sf-dr-key">Duration</span>
                <span className="sf-dr-val hi">{totalMs !== null ? `${(totalMs / 1000).toFixed(2)}s` : "—"}</span>
              </div>

              {isSimulated ? (
                <div style={{ marginTop: "14px" }}>
                  <div style={{
                    fontSize: "10px", color: "var(--text-lo)",
                    marginBottom: "4px", fontFamily: "var(--font-mono)",
                  }}>
                    This is a demo run — no on-chain transactions.
                    Use &ldquo;Run on blockchain&rdquo; to save real results permanently.
                  </div>
                </div>
              ) : txHashes.length > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{
                    fontSize: "10px", color: "var(--text-lo)",
                    marginBottom: "6px", fontFamily: "var(--font-mono)",
                  }}>
                    Blockchain records
                  </div>
                  {txHashes.map((hash, i) => (
                    <a
                      key={hash}
                      href={`${EXPLORER}/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "block", fontSize: "11px",
                        fontFamily: "var(--font-mono)", color: "var(--brand)",
                        opacity: 0.7, marginBottom: "3px", textDecoration: "none",
                      }}
                    >
                      Step {i + 1} ↗ {hash.slice(0, 10)}…{hash.slice(-6)}
                    </a>
                  ))}
                </div>
              )}

              <div style={{ marginTop: "14px", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <Link
                  href="/proof"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-mid)", textDecoration: "none",
                  }}
                >
                  View all recorded results →
                </Link>
                <a
                  href={`${EXPLORER}/address/${process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1"}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--brand)", textDecoration: "none",
                  }}
                >
                  ↗ verify on explorer
                </a>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
