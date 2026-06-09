// [VERIFIED] — Observatory design system (Deep Navy / Cyan)
"use client";

import { useState, useEffect } from "react";
import type { PipelineStepStatus, PipelineDecision } from "@/types";

const EXPLORER = "https://shannon-explorer.somnia.network";

const STATUS_ICON: Record<PipelineStepStatus, string> = {
  idle:     "·",
  pending:  "◌",
  complete: "✓",
  failed:   "✕",
  retrying: "↻",
  skipped:  "–",
};

interface StepCardProps {
  index:          number;
  agentType:      number;
  status:         PipelineStepStatus;
  result?:        string;
  streamingText?: string;
  decision?:      PipelineDecision;
  durationMs?:    number;
  sttCost?:       string;
  requestId?:     string;
  txHash?:        string;
  // Contextual display
  label?:         string;    // "Fetch ETH/USD Price"
  sublabel?:      string;    // "CoinPaprika API via Somnia JSON API agent"
  conditional?:   string;    // "Only fires if LLM decides EXECUTE"
  formatResult?:  (raw: string) => string;
  pendingCopy?:   string;    // contextual pending message
}

function WordReveal({ text }: { text: string }) {
  const words = text.split(" ");
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= words.length) return;
    const delay = Math.max(30, 2000 / words.length);
    const t = setTimeout(() => setShown(s => s + 1), delay);
    return () => clearTimeout(t);
  }, [shown, words.length]);

  return (
    <div className="sf-mono-block" style={{ marginTop: "10px" }}>
      {words.slice(0, shown).join(" ")}
      {shown < words.length && (
        <span style={{ animation: "sf-blink 1s step-end infinite", color: "var(--brand)" }}>▋</span>
      )}
    </div>
  );
}

export function StepCard({
  index,
  agentType,
  status,
  result,
  streamingText,
  decision,
  durationMs,
  sttCost,
  requestId,
  txHash,
  label,
  sublabel,
  conditional,
  formatResult,
  pendingCopy,
}: StepCardProps) {
  // Fallback labels when no context provided
  const defaultLabel = agentType === 1 ? "AI Decision" : "Data Fetch";
  const defaultSublabel = agentType === 1 ? "AI model" : "API call";
  const displayLabel   = label   ?? defaultLabel;
  const displaySublabel = sublabel ?? defaultSublabel;
  const defaultPendingCopy = "awaiting Somnia validator network...";

  const showFooter =
    (durationMs !== undefined && durationMs > 0) ||
    (sttCost && sttCost !== "0") ||
    !!txHash ||
    !!requestId;

  const decisionBadge = status === "complete" && decision;

  const badgeColor = decisionBadge
    ? (decision.decision === "EXECUTE" ? "var(--ok)" : "var(--text-lo)")
    : status === "complete"  ? "var(--ok)"
    : status === "pending"   ? "var(--brand)"
    : status === "failed"    ? "#f87171"
    : status === "retrying"  ? "#fbbf24"
    : "var(--text-lo)";

  const badgeBorder = decisionBadge
    ? (decision.decision === "EXECUTE" ? "rgba(74,222,128,0.3)" : "var(--border)")
    : status === "complete"  ? "rgba(74,222,128,0.3)"
    : status === "pending"   ? "var(--brand-glow)"
    : status === "failed"    ? "rgba(248,113,113,0.3)"
    : status === "retrying"  ? "rgba(251,191,36,0.3)"
    : "var(--border)";

  const badgeBg = decisionBadge
    ? (decision.decision === "EXECUTE" ? "rgba(74,222,128,0.06)" : "transparent")
    : status === "complete"  ? "rgba(74,222,128,0.06)"
    : status === "pending"   ? "var(--brand-dim)"
    : status === "failed"    ? "rgba(248,113,113,0.06)"
    : status === "retrying"  ? "rgba(251,191,36,0.06)"
    : "transparent";

  const badgeLabel = decisionBadge
    ? decision.decision
    : status === "idle"      ? "IDLE"
    : status === "pending"   ? "PENDING"
    : status === "complete"  ? "DONE"
    : status === "failed"    ? "FAILED"
    : status === "retrying"  ? "RETRY"
    : "SKIPPED";

  // Format the result for display
  const displayResult = result && formatResult ? formatResult(result) : result;

  return (
    <div className="sf-glass" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>

        {/* Step icon circle */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div className={`sf-step-icon ${status}`}>
            {status === "pending" && <div className="sf-step-spin" />}
            {STATUS_ICON[status]}
          </div>
        </div>

        {/* Card body */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Header row */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: "6px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{
                fontSize: "10px", fontFamily: "var(--font-mono)",
                color: "var(--text-lo)", letterSpacing: "0.1em",
              }}>
                STEP {String(index + 1).padStart(2, "0")}
              </span>
              <span style={{ color: "var(--border)" }}>·</span>
              <span style={{
                fontSize: "10px", fontFamily: "var(--font-mono)",
                color: "var(--text-lo)", letterSpacing: "0.05em",
              }}>
                {displaySublabel}
              </span>
            </div>

            <span
              className="sf-badge"
              style={{ fontSize: "10px", color: badgeColor, borderColor: badgeBorder, background: badgeBg }}
            >
              {badgeLabel}
            </span>
          </div>

          {/* Step label */}
          <div style={{
            fontSize: "15px", fontWeight: 600,
            color: "var(--text-hi)", marginBottom: "4px",
            fontFamily: "var(--font-sans)",
          }}>
            {displayLabel}
          </div>

          {/* Conditional note */}
          {conditional && (
            <div style={{
              fontSize: "11px", fontFamily: "var(--font-mono)",
              color: "var(--text-lo)", marginBottom: "6px",
            }}>
              ◆ {conditional}
            </div>
          )}

          {/* Pending */}
          {status === "pending" && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <div className="sf-spinner" />
              <span style={{
                fontSize: "11px", fontFamily: "var(--font-mono)",
                color: "var(--brand-soft)",
              }}>
                {pendingCopy ?? defaultPendingCopy}
              </span>
            </div>
          )}

          {/* Retrying */}
          {status === "retrying" && (
            <div style={{
              fontSize: "11px", fontFamily: "var(--font-mono)",
              color: "#fbbf24", marginTop: "4px",
            }}>
              ↻ retrying after timeout
            </div>
          )}

          {/* LLM streaming */}
          {streamingText && agentType === 1 && status !== "complete" && (
            <WordReveal text={streamingText} />
          )}

          {/* LLM decision card — structured display (replaces raw mono block) */}
          {decision && status === "complete" && agentType === 1 && (
            <div style={{
              marginTop: "12px", padding: "14px 16px",
              border: `1px solid ${decision.decision === "EXECUTE" ? "rgba(74,222,128,0.25)" : "var(--border)"}`,
              background: decision.decision === "EXECUTE" ? "rgba(74,222,128,0.04)" : "rgba(255,255,255,0.01)",
            }}>
              {/* Decision + swap + confidence row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{
                  fontSize: "15px", fontWeight: 700,
                  color: decision.decision === "EXECUTE" ? "var(--ok)" : "var(--text-lo)",
                  fontFamily: "var(--font-sans)",
                }}>
                  {decision.decision}
                </span>
                {decision.swapPct > 0 && (
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
                    {decision.swapPct}% rebalance
                  </span>
                )}
                <span style={{
                  marginLeft: "auto", fontSize: "10px",
                  fontFamily: "var(--font-mono)", color: "var(--text-lo)",
                  padding: "2px 6px", border: "1px solid var(--border)",
                }}>
                  {decision.confidence}
                </span>
              </div>
              {/* LLM reasoning */}
              <p style={{
                fontSize: "12px", lineHeight: 1.65,
                color: "var(--text-mid)", margin: 0,
                fontFamily: "var(--font-sans)",
              }}>
                {decision.reasoning}
              </p>
            </div>
          )}

          {/* Result — JSON API (formatted) */}
          {displayResult && status === "complete" && agentType !== 1 && (
            <div style={{
              marginTop: "8px", fontFamily: "var(--font-mono)",
              fontSize: "13px", color: "var(--ok)", fontWeight: 600,
            }}>
              {displayResult}
            </div>
          )}

          {/* Skipped message */}
          {status === "skipped" && (
            <div style={{
              marginTop: "6px", fontSize: "11px", fontFamily: "var(--font-mono)",
              color: "var(--text-lo)",
            }}>
              skipped — the smart contract decided not to run this step
            </div>
          )}

          {/* Footer */}
          {showFooter && (
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              marginTop: "12px", paddingTop: "10px",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              flexWrap: "wrap",
            }}>
              {durationMs !== undefined && durationMs > 0 && (
                <span style={{
                  fontSize: "10px", fontFamily: "var(--font-mono)",
                  color: "var(--text-lo)",
                }}>
                  {(durationMs / 1000).toFixed(2)}s
                </span>
              )}
              {sttCost && sttCost !== "0" && (
                <span style={{
                  fontSize: "10px", fontFamily: "var(--font-mono)",
                  color: "var(--text-lo)",
                }}>
                  {sttCost} STT
                </span>
              )}
              {(txHash || requestId) && (
                <a
                  href={`${EXPLORER}/tx/${txHash ?? requestId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "10px", fontFamily: "var(--font-mono)",
                    color: "var(--brand)", opacity: 0.6,
                    textDecoration: "none", marginLeft: "auto",
                    transition: "opacity 0.15s",
                  }}
                >
                  ↗ tx {(txHash ?? requestId ?? "").slice(0, 8)}…
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
