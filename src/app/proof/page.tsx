// [VERIFIED] — Server Component — fetches real on-chain data from getPipelineState
import Link from "next/link";
import { getPipelineState, getTransactionHistory, getStepDefinitions } from "@/lib/pipeline-service";
import { parsePipelineDecision } from "@/lib/parse-decision";
import { SiteNav } from "@/components/SiteNav";
import { agentDisplayName } from "@/lib/agent-display";

const REGISTRY  = "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1";
const EXPLORER  = "https://shannon-explorer.somnia.network";
const CHAIN_ID  = 50312;

const DEMO_IDS  = (process.env.NEXT_PUBLIC_DEMO_PIPELINE_IDS ?? "1,2")
  .split(",")
  .map(s => s.trim());

export default async function ProofPage() {
  // Fetch pipeline states, step defs, and TX history in parallel
  const [stateResults, historyResults, stepDefsResults] = await Promise.all([
    Promise.allSettled(DEMO_IDS.map(id => getPipelineState(id))),
    Promise.allSettled(DEMO_IDS.map(id => getTransactionHistory(id))),
    Promise.allSettled(DEMO_IDS.map(id => getStepDefinitions(id))),
  ]);

  return (
    <div className="sf-bg">
      <div className="sf-grain-overlay" aria-hidden="true" />

      <SiteNav right={<div className="sf-chain-badge">◈ Live on Somnia</div>} />

      {/* Single-column, data-focused layout */}
      <main style={{ maxWidth: "820px", margin: "0 auto", padding: "48px 36px 80px" }}>

        <div style={{
          fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "var(--brand)",
          marginBottom: "14px", fontFamily: "var(--font-sans)",
        }}>
          Blockchain Proof
        </div>

        <h1 style={{
          fontFamily: "var(--font-serif)",
          fontSize: "clamp(28px, 3.5vw, 40px)",
          fontStyle: "italic", fontWeight: 400,
          lineHeight: 1.1, letterSpacing: "-0.01em",
          color: "var(--text-hi)", marginBottom: "10px",
        }}>
          Every decision is permanently recorded and publicly verifiable.
        </h1>

        <p style={{
          fontSize: "14px", lineHeight: 1.7, color: "var(--text-mid)",
          maxWidth: "580px", marginBottom: "40px", fontFamily: "var(--font-sans)",
        }}>
          There&apos;s no company server deciding what happens. The rules are written into
          the blockchain for anyone to see. Click any record below to verify it yourself.
        </p>

        {/* Pipeline state sections — TX hashes lead */}
        {DEMO_IDS.map((id, idx) => {
          const stateResult    = stateResults[idx];
          const historyResult  = historyResults[idx];
          const stepDefsResult = stepDefsResults[idx];
          const state          = stateResult.status === "fulfilled" ? stateResult.value : null;
          const history        = historyResult.status === "fulfilled" ? historyResult.value : [];
          const stepDefs       = stepDefsResult?.status === "fulfilled" ? stepDefsResult.value : [];

          const hasResults = state && (state.status === "Complete" || state.stepResults?.some(Boolean));

          // Find LLM step for decision display
          const llmStepIdx = stepDefs.findIndex(d => d.agentType === 1);
          const llmResult  = llmStepIdx >= 0 ? state?.stepResults?.[llmStepIdx] : state?.stepResults?.[1];
          const decision   = llmResult ? parsePipelineDecision(llmResult) : null;

          const pipelineName = stepDefs.length > 0
            ? stepDefs.map(d => agentDisplayName(d)).join(" → ")
            : `Pipeline #${id}`;

          return (
            <div key={id} style={{ marginBottom: "40px" }}>
              {/* Pipeline header */}
              <div style={{
                display: "flex", alignItems: "center", gap: "12px",
                marginBottom: "14px",
              }}>
                <h2 style={{
                  fontSize: "16px", fontWeight: 700,
                  color: "var(--text-hi)", fontFamily: "var(--font-sans)",
                  margin: 0,
                }}>
                  {pipelineName}
                </h2>
                <span style={{
                  fontSize: "10px", fontFamily: "var(--font-mono)",
                  color: "var(--text-lo)",
                }}>
                  #{id}
                </span>
                {state && (
                  <span style={{
                    fontSize: "10px", fontFamily: "var(--font-mono)",
                    fontWeight: 600, padding: "2px 7px",
                    border: `1px solid ${state.status === "Complete" ? "rgba(74,222,128,0.3)" : "var(--border)"}`,
                    color: state.status === "Complete" ? "var(--ok)" : "var(--text-lo)",
                    borderRadius: "20px",
                  }}>
                    {state.status.toUpperCase()}
                  </span>
                )}
              </div>

              {/* TX hash history — LEADS the section */}
              {history.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  {history.map((run, runIdx) => (
                    <div key={runIdx} className="sf-glass" style={{ padding: "16px 18px" }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        marginBottom: "10px",
                      }}>
                        <span style={{
                          fontSize: "11px", fontFamily: "var(--font-mono)",
                          color: "var(--text-lo)",
                        }}>
                          Run #{history.length - runIdx}
                        </span>
                        <span style={{
                          fontSize: "10px", fontFamily: "var(--font-mono)",
                          color: "var(--text-lo)",
                        }}>
                          · {run.steps.length} transaction{run.steps.length !== 1 ? "s" : ""} · block {run.steps[0]?.blockNumber?.toLocaleString() ?? "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {run.steps.map((step) => {
                          const cleanHash = step.txHash.trim();
                          return (
                            <div key={cleanHash} style={{
                              display: "flex", alignItems: "baseline", gap: "10px",
                            }}>
                              <span style={{
                                fontSize: "10px", fontFamily: "var(--font-mono)",
                                color: "var(--text-lo)", flexShrink: 0, minWidth: "44px",
                              }}>
                                Step {step.step + 1}
                              </span>
                              <a
                                href={`${EXPLORER}/tx/${cleanHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: "11px", fontFamily: "var(--font-mono)",
                                  color: "var(--brand)", textDecoration: "none", opacity: 0.8,
                                  transition: "opacity 0.15s, transform 0.15s",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateX(2px)"; }}
                                onMouseLeave={e => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.transform = "translateX(0)"; }}
                              >
                                {cleanHash.slice(0, 14)}…{cleanHash.slice(-6)} ↗
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sf-glass" style={{
                  padding: "18px 20px", marginBottom: "12px",
                  fontSize: "13px", color: "var(--text-lo)",
                  fontFamily: "var(--font-sans)", lineHeight: 1.6,
                }}>
                  No blockchain records yet.{" "}
                  <Link
                    href={`/pipeline/${id}?demo=execute`}
                    style={{ color: "var(--brand)", textDecoration: "none" }}
                  >
                    Run the demo →
                  </Link>
                  {" "}to create the first blockchain record.
                </div>
              )}

              {/* Last run details — below the proof records */}
              {hasResults && (
                <div className="sf-glass" style={{ padding: "18px 20px" }}>
                  <div style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-lo)", marginBottom: "12px", letterSpacing: "0.08em",
                  }}>
                    LATEST RESULTS
                  </div>

                  {state.stepResults?.map((result, i) => {
                    if (!result) return null;
                    const def     = stepDefs[i];
                    const isLlm   = def?.agentType === 1;
                    const isSkip  = state.stepStatuses?.[i] === "skipped";
                    const stepDecision = isLlm ? parsePipelineDecision(result) : null;

                    if (isSkip) return (
                      <div key={i} className="sf-dr">
                        <span className="sf-dr-key">Step {i + 1}</span>
                        <span className="sf-dr-val" style={{ color: "var(--text-lo)" }}>SKIPPED</span>
                      </div>
                    );

                    if (stepDecision) return (
                      <div key={i}>
                        <div className="sf-dr">
                          <span className="sf-dr-key">Step {i + 1} — AI verdict</span>
                          <span className={`sf-dr-val ${stepDecision.decision === "EXECUTE" ? "ok" : ""}`}>
                            {stepDecision.decision === "EXECUTE" ? "Proceed" : "Skip"}
                            {stepDecision.swapPct > 0 && ` · ${stepDecision.swapPct}%`}
                          </span>
                        </div>
                        {stepDecision.reasoning && (
                          <div style={{ padding: "6px 0 8px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <p style={{
                              margin: 0, fontSize: "11px", color: "var(--text-mid)",
                              lineHeight: 1.55, fontFamily: "var(--font-sans)",
                            }}>
                              {stepDecision.reasoning}
                            </p>
                          </div>
                        )}
                      </div>
                    );

                    return (
                      <div key={i} className="sf-dr">
                        <span className="sf-dr-key">
                          Step {i + 1}{def ? ` — ${agentDisplayName(def)}` : ""}
                        </span>
                        <span className="sf-dr-val hi" style={{ maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {result.length > 60 ? `${result.slice(0, 60)}…` : result}
                        </span>
                      </div>
                    );
                  })}

                  {/* Show skipped steps that have no result */}
                  {state.stepStatuses?.map((status, i) => {
                    if (status !== "skipped" || state.stepResults?.[i]) return null;
                    return (
                      <div key={`skip-${i}`} className="sf-dr">
                        <span className="sf-dr-key">Step {i + 1}</span>
                        <span className="sf-dr-val" style={{ color: "var(--text-lo)" }}>SKIPPED</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {!hasResults && state && (
                <div className="sf-glass" style={{
                  padding: "14px 18px",
                  fontSize: "12px", color: "var(--text-lo)",
                  fontFamily: "var(--font-sans)",
                }}>
                  Status: {state.status} · Balance: {state.sttBalance} STT (test tokens)
                </div>
              )}
            </div>
          );
        })}

        {/* Smart contract details */}
        <div className="sf-glass" style={{ padding: "20px", marginBottom: "16px" }}>
          <div style={{
            fontSize: "13px", fontWeight: 600,
            color: "var(--text-hi)", marginBottom: "14px",
            fontFamily: "var(--font-sans)",
          }}>
            Blockchain Details
          </div>

          <div className="sf-dr">
            <span className="sf-dr-key">Network</span>
            <span className="sf-dr-val">Somnia Testnet</span>
          </div>
          <div className="sf-dr">
            <span className="sf-dr-key">Chain ID</span>
            <span className="sf-dr-val">{CHAIN_ID}</span>
          </div>

          <div style={{ marginTop: "12px" }}>
            <div style={{
              fontSize: "10px", color: "var(--text-lo)",
              fontFamily: "var(--font-mono)", marginBottom: "6px",
            }}>
              Contract Address
            </div>
            <a
              href={`${EXPLORER}/address/${REGISTRY}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "12px", fontFamily: "var(--font-mono)",
                color: "var(--brand)", textDecoration: "none",
                wordBreak: "break-all", lineHeight: 1.5,
              }}
            >
              {REGISTRY} ↗
            </a>
          </div>
        </div>

        {/* Verify note */}
        <div className="sf-glass" style={{ padding: "16px 20px" }}>
          <div style={{
            fontSize: "13px", fontWeight: 600,
            color: "var(--text-hi)", marginBottom: "10px",
            fontFamily: "var(--font-sans)",
          }}>
            How to verify
          </div>
          <p style={{
            fontSize: "12px", color: "var(--text-mid)", lineHeight: 1.6,
            margin: 0, fontFamily: "var(--font-sans)",
          }}>
            Click any record above to see it on the Somnia blockchain explorer. When the AI
            decides to proceed, all steps run and are saved. When it decides to skip, the
            blockchain blocks that step automatically, so you see fewer records.
          </p>
        </div>

        <div style={{ marginTop: "32px" }}>
          <Link href="/" style={{
            fontSize: "13px", fontWeight: 500,
            color: "var(--text-lo)", fontFamily: "var(--font-sans)",
            textDecoration: "none",
          }}>
            ← Back to home
          </Link>
        </div>

      </main>
    </div>
  );
}
