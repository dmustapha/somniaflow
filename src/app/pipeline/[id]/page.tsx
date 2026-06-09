// [VERIFIED] — Next.js 14 App Router + SSE via EventSource — Observatory design
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StepCard } from "@/components/StepCard";
import { SiteNav } from "@/components/SiteNav";
import { parsePipelineDecision } from "@/lib/parse-decision";
import type { PipelineSSEEvent, PipelineStepStatus, PipelineDecision } from "@/types";

const EXPLORER = "https://shannon-explorer.somnia.network";

// Human-readable pipeline metadata
const PIPELINE_META: Record<string, { name: string; tagline: string }> = {
  "1": { name: "ETH Rebalancing Agent", tagline: "3 steps: check price · AI decides · record on blockchain" },
  "2": { name: "ETH Rebalancing Agent v2", tagline: "3 steps: check price · AI decides · record on blockchain" },
};

// Per-step plain-English labels and context
const STEP_CONTEXT = [
  {
    label:        "Check ETH/USD Price",
    sublabel:     "CoinPaprika API",
    conditional:  undefined as string | undefined,
    formatResult: (r: string) => `$${(parseInt(r, 10) / 100).toFixed(2)} USD`,
    pendingCopy:  "Fetching current ETH price from CoinPaprika...",
  },
  {
    label:        "AI Rebalancing Decision",
    sublabel:     "Qwen 3 30B AI model",
    conditional:  undefined as string | undefined,
    formatResult: undefined as ((r: string) => string) | undefined,
    pendingCopy:  "AI analyzing price data — generating rebalancing decision...",
  },
  {
    label:        "Check 24h Trading Volume",
    sublabel:     "CoinPaprika volume data",
    conditional:  "Only runs if the AI decided to rebalance",
    formatResult: (r: string) => `$${(parseInt(r, 10) / 1_000_000).toFixed(1)}M 24h volume`,
    pendingCopy:  "AI decided to rebalance — fetching 24h trading volume...",
  },
];

interface StepState {
  status:         PipelineStepStatus;
  result?:        string;
  streamingText?: string;
  decision?:      PipelineDecision;
  durationMs?:    number;
  sttCost?:       string;
  requestId?:     string;
  txHash?:        string;
}

const INITIAL_STEPS: StepState[] = [
  { status: "idle" },
  { status: "idle" },
  { status: "idle" },
];

const AGENT_TYPES = [0, 1, 0]; // data API, LLM, data API

export default function PipelinePage({ params }: { params: { id: string } }) {
  const [steps,      setSteps]      = useState<StepState[]>(INITIAL_STEPS);
  const [pipeStatus, setPipeStatus] = useState<"idle" | "running" | "complete" | "failed">("idle");
  const [totalMs,    setTotalMs]    = useState<number | null>(null);
  const [txHashes,   setTxHashes]   = useState<string[]>([]);
  const [error,      setError]      = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const meta = PIPELINE_META[params.id] ?? { name: `Demo ${params.id}`, tagline: "" };

  function startSSE() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/api/pipeline/${params.id}/stream`);
    esRef.current = es;
    es.onmessage = (e) => handleEvent(JSON.parse(e.data) as PipelineSSEEvent);
    es.onerror   = () => {
      setError("Lost connection — the run may still be completing. Refresh to check.");
      es.close();
    };
  }

  function handleEvent(event: PipelineSSEEvent) {
    switch (event.type) {
      case "pipeline_started":
        setPipeStatus("running");
        setTxHashes([]);
        setSteps(INITIAL_STEPS.map(s => ({ ...s })));
        break;

      case "step_dispatched":
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = { ...n[event.data.step], status: "pending", requestId: event.data.requestId };
          return n;
        });
        break;

      case "step_complete":
        setSteps(prev => {
          const n = [...prev];
          n[event.data.step] = {
            ...n[event.data.step],
            status:     "complete",
            result:     event.data.result,
            durationMs: event.data.durationMs,
            sttCost:    event.data.sttCost,
            txHash:     event.data.txHash,
          };
          return n;
        });
        break;

      case "decision":
        setSteps(prev => {
          const n = [...prev];
          n[1] = { ...n[1], decision: event.data };
          return n;
        });
        break;

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
        setPipeStatus("complete");
        setTotalMs(event.data.totalMs);
        setTxHashes(event.data.txHashes ?? []);
        esRef.current?.close();
        break;

      case "pipeline_failed":
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
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setTotalMs(null);
    setTxHashes([]);
    startSSE();
    try {
      await fetch("/api/pipeline/simulate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ pipelineId: params.id, branch }),
      });
    } finally {
      setTriggering(false);
    }
  }

  async function handleTrigger() {
    if (triggering || pipeStatus === "running") return;
    setTriggering(true);
    setError(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setTotalMs(null);
    setTxHashes([]);
    startSSE();

    try {
      const res = await fetch("/api/pipeline/trigger", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ pipelineId: params.id }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        setError(msg ?? "Trigger failed");
        esRef.current?.close();
      }
    } finally {
      setTriggering(false);
    }
  }

  // Load previous run state on mount + URL param auto-trigger
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch(`/api/pipeline/${params.id}/state`);
        if (!res.ok) return;
        const state = await res.json();
        if (state.status === "Idle" || !state.stepResults?.length) return;
        setSteps(prev => prev.map((s, i) => ({
          ...s,
          status: (state.stepStatuses?.[i] ?? "idle") as PipelineStepStatus,
          result: state.stepResults?.[i] || undefined,
          decision: i === 1 && state.stepResults?.[1]
            ? parsePipelineDecision(state.stepResults[1])
            : undefined,
        })));
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

    return () => { esRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const isRunning    = pipeStatus === "running" || triggering;
  const isComplete   = pipeStatus === "complete";
  const isFailed     = pipeStatus === "failed";
  const isSkipBranch = steps[2].status === "skipped";
  const decision     = steps[1].decision;

  const eyebrow = pipeStatus === "idle"     ? "Live run — ready to start"
                : pipeStatus === "running"  ? "Agents running now"
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
          <div style={{
            fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
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
            {meta.name}
          </h1>
          <div style={{
            fontSize: "13px", fontFamily: "var(--font-mono)",
            color: "var(--text-lo)", marginBottom: "14px",
          }}>
            {meta.tagline}
          </div>

          {/* Status line */}
          <div style={{ marginBottom: "28px", minHeight: "22px" }}>
            {isRunning && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div className="sf-live-dot" />
                <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--ok)" }}>
                  agents running...
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
                3 steps: check ETH price · AI decides · check trading volume
              </span>
            )}
          </div>

          {/* Idle instruction */}
          {pipeStatus === "idle" && !steps.some(s => s.status !== "idle") && (
            <p style={{
              fontSize: "13px", color: "var(--text-lo)", marginBottom: "28px",
              fontFamily: "var(--font-sans)", lineHeight: 1.6, maxWidth: "460px",
            }}>
              Choose a demo to the right and watch three AI agents run live, one after the other.
              You&apos;ll see each step complete in real time.
            </p>
          )}

          {/* Execution trace */}
          <div>
            {steps.map((step, i) => (
              <div key={i}>
                <StepCard
                  index={i}
                  agentType={AGENT_TYPES[i]}
                  status={step.status}
                  result={step.result}
                  streamingText={step.streamingText}
                  decision={step.decision}
                  durationMs={step.durationMs}
                  sttCost={step.sttCost}
                  requestId={step.requestId}
                  txHash={step.txHash}
                  label={STEP_CONTEXT[i]?.label}
                  sublabel={STEP_CONTEXT[i]?.sublabel}
                  conditional={STEP_CONTEXT[i]?.conditional}
                  formatResult={STEP_CONTEXT[i]?.formatResult}
                  pendingCopy={STEP_CONTEXT[i]?.pendingCopy}
                />
                {i < steps.length - 1 && <div className="sf-connector" />}
              </div>
            ))}
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

          {/* Pipeline description — FIRST so user understands before acting */}
          <div className="sf-glass" style={{ padding: "20px" }}>
            <div style={{
              fontSize: "13px", fontWeight: 600,
              color: "var(--text-hi)", marginBottom: "12px",
              fontFamily: "var(--font-sans)",
            }}>
              {meta.name}
            </div>
            <p style={{
              fontSize: "12px", color: "var(--text-mid)",
              lineHeight: 1.6, margin: "0 0 12px",
              fontFamily: "var(--font-sans)",
            }}>
              Check price → AI decides → act only if needed
            </p>
            <div style={{
              padding: "10px 12px", marginBottom: "8px",
              border: "1px solid rgba(74,222,128,0.2)",
              background: "rgba(74,222,128,0.03)",
              fontSize: "11px", color: "var(--text-mid)",
              fontFamily: "var(--font-sans)", lineHeight: 1.55,
            }}>
              <span style={{ color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>AI REBALANCES</span>
              {" "}— all 3 steps run and are recorded on the blockchain.
            </div>
            <div style={{
              padding: "10px 12px",
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.01)",
              fontSize: "11px", color: "var(--text-mid)",
              fontFamily: "var(--font-sans)", lineHeight: 1.55,
            }}>
              <span style={{ color: "var(--text-lo)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>AI WAITS</span>
              {" "}— the smart contract stops after step 2 and skips the volume check.
            </div>
          </div>

          {/* Run card */}
          <div className="sf-glass" style={{ padding: "20px" }}>
            <div style={{
              fontSize: "13px", fontWeight: 600,
              color: "var(--text-hi)", marginBottom: "14px",
              fontFamily: "var(--font-sans)",
            }}>
              Run Demo
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => handleSimulate("execute")}
                disabled={isRunning}
                className="sf-btn-primary"
                style={{ width: "100%", textAlign: "center" }}
              >
                {triggering ? "starting..." : "Run demo: AI decides to rebalance"}
              </button>
              <button
                onClick={() => handleSimulate("skip")}
                disabled={isRunning}
                className="sf-btn-ghost"
                style={{ width: "100%", textAlign: "center" }}
              >
                Run demo: AI decides to wait
              </button>
              <button
                onClick={handleTrigger}
                disabled={isRunning}
                className="sf-btn-ghost"
                title="Triggers a real on-chain transaction — requires a funded pipeline wallet"
                style={{ width: "100%", textAlign: "center", fontSize: "11px", opacity: 0.5 }}
              >
                ▶ Trigger live on-chain
              </button>
            </div>

            {error && (
              <div style={{
                marginTop: "12px", padding: "10px 12px",
                border: "1px solid rgba(248,113,113,0.3)",
                background: "rgba(248,113,113,0.05)",
                fontSize: "11px", fontFamily: "var(--font-mono)",
                color: "#f87171", lineHeight: 1.5,
              }}>
                ✕ {error}
              </div>
            )}
          </div>

          {/* Completion summary — what just happened */}
          {isComplete && (
            <div className="sf-glass" style={{ padding: "20px" }}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: "14px",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-hi)", fontFamily: "var(--font-sans)" }}>
                  What just happened
                </div>
                <span style={{
                  fontSize: "10px", padding: "3px 8px",
                  border: "1px solid rgba(74,222,128,0.3)",
                  color: "var(--ok)", fontFamily: "var(--font-mono)", fontWeight: 600,
                }}>
                  RECORDED
                </span>
              </div>

              {decision && (
                <div className="sf-dr">
                  <span className="sf-dr-key">AI decision</span>
                  <span className={`sf-dr-val ${decision.decision === "EXECUTE" ? "ok" : ""}`}>
                    {decision.decision === "EXECUTE" ? "Rebalance" : "Wait"}
                  </span>
                </div>
              )}
              {decision && decision.swapPct > 0 && (
                <div className="sf-dr">
                  <span className="sf-dr-key">Rebalance amount</span>
                  <span className="sf-dr-val hi">{decision.swapPct}%</span>
                </div>
              )}
              <div className="sf-dr">
                <span className="sf-dr-key">Path taken</span>
                <span className="sf-dr-val">{isSkipBranch ? "Wait · 2 steps ran" : "Rebalance · 3 steps ran"}</span>
              </div>
              <div className="sf-dr">
                <span className="sf-dr-key">Duration</span>
                <span className="sf-dr-val hi">{totalMs !== null ? `${(totalMs / 1000).toFixed(2)}s` : "—"}</span>
              </div>

              {txHashes.length > 0 && (
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
                    color: "var(--text-mid)", textDecoration: "none", opacity: 0.7,
                  }}
                >
                  See all recorded decisions →
                </Link>
                <a
                  href={`${EXPLORER}/address/${process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--brand)", textDecoration: "none", opacity: 0.7,
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
