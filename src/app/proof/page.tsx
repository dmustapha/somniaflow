// [VERIFIED] — Server Component — fetches real on-chain data from getPipelineState
import Link from "next/link";
import { getPipelineState, getTransactionHistory } from "@/lib/pipeline-service";
import { parsePipelineDecision } from "@/lib/parse-decision";
import { SiteNav } from "@/components/SiteNav";

const REGISTRY  = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "";
const EXPLORER  = "https://shannon-explorer.somnia.network";
const CHAIN_ID  = 50312;

const DEMO_IDS  = (process.env.NEXT_PUBLIC_DEMO_PIPELINE_IDS ?? "1,2")
  .split(",")
  .map(s => s.trim());

function formatPrice(raw: string): string {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return raw;
  return `$${(n / 100).toFixed(2)} USD`;
}

function formatVolume(raw: string): string {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return raw;
  return `$${(n / 1_000_000).toFixed(1)}M 24h volume`;
}

export default async function ProofPage() {
  // Fetch pipeline states and TX history in parallel
  const [stateResults, historyResults] = await Promise.all([
    Promise.allSettled(DEMO_IDS.map(id => getPipelineState(id))),
    Promise.allSettled(DEMO_IDS.map(id => getTransactionHistory(id))),
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
          Every decision is permanently recorded
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
          There&apos;s no server deciding what happens — the rules are written into a smart contract
          that anyone can read. Click any transaction record below to verify it yourself on the blockchain.
        </p>

        {/* Pipeline state sections — TX hashes lead */}
        {DEMO_IDS.map((id, idx) => {
          const stateResult   = stateResults[idx];
          const historyResult = historyResults[idx];
          const state         = stateResult.status === "fulfilled" ? stateResult.value : null;
          const history       = historyResult.status === "fulfilled" ? historyResult.value : [];

          const step0Result  = state?.stepResults?.[0];
          const step1Result  = state?.stepResults?.[1];
          const step2Result  = state?.stepResults?.[2];
          const decision     = step1Result ? parsePipelineDecision(step1Result) : null;

          const hasResults = state && (state.status === "Complete" || state.stepResults?.some(Boolean));

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
                  ETH Rebalancing Agent
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
                        {run.steps.map((step) => (
                          <div key={step.txHash} style={{
                            display: "flex", alignItems: "baseline", gap: "10px",
                          }}>
                            <span style={{
                              fontSize: "10px", fontFamily: "var(--font-mono)",
                              color: "var(--text-lo)", flexShrink: 0, minWidth: "44px",
                            }}>
                              Step {step.step + 1}
                            </span>
                            <a
                              href={step.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: "11px", fontFamily: "var(--font-mono)",
                                color: "var(--brand)", textDecoration: "none", opacity: 0.8,
                              }}
                            >
                              {step.txHash.slice(0, 14)}…{step.txHash.slice(-6)} ↗
                            </a>
                          </div>
                        ))}
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
                  No runs recorded yet.{" "}
                  <Link
                    href={`/pipeline/${id}?demo=execute`}
                    style={{ color: "var(--brand)", textDecoration: "none" }}
                  >
                    Run the demo →
                  </Link>
                  {" "}to generate your first blockchain record here.
                </div>
              )}

              {/* Last run details — below the proof records */}
              {hasResults && (
                <div className="sf-glass" style={{ padding: "18px 20px" }}>
                  <div style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-lo)", marginBottom: "12px", letterSpacing: "0.08em",
                  }}>
                    LAST RUN RESULTS
                  </div>

                  {step0Result && (
                    <div className="sf-dr">
                      <span className="sf-dr-key">Step 1 — ETH price</span>
                      <span className="sf-dr-val hi">{formatPrice(step0Result)}</span>
                    </div>
                  )}

                  {decision && (
                    <div className="sf-dr">
                      <span className="sf-dr-key">Step 2 — AI decision</span>
                      <span className={`sf-dr-val ${decision.decision === "EXECUTE" ? "ok" : ""}`}>
                        {decision.decision === "EXECUTE" ? "Rebalance" : "Wait"}
                        {decision.swapPct > 0 && ` · ${decision.swapPct}% rebalance`}
                      </span>
                    </div>
                  )}

                  {step1Result && decision && (
                    <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: "10px", color: "var(--text-lo)", fontFamily: "var(--font-sans)" }}>
                        AI reasoning
                      </span>
                      <p style={{
                        margin: "4px 0 0", fontSize: "12px", color: "var(--text-mid)",
                        lineHeight: 1.55, fontFamily: "var(--font-sans)",
                      }}>
                        {decision.reasoning}
                      </p>
                    </div>
                  )}

                  {step2Result ? (
                    <div className="sf-dr">
                      <span className="sf-dr-key">Step 3 — 24h volume</span>
                      <span className="sf-dr-val hi">{formatVolume(step2Result)}</span>
                    </div>
                  ) : (
                    state?.stepStatuses?.[2] === "skipped" && (
                      <div className="sf-dr">
                        <span className="sf-dr-key">Step 3</span>
                        <span className="sf-dr-val" style={{ color: "var(--text-lo)" }}>
                          SKIPPED — smart contract blocked this step
                        </span>
                      </div>
                    )
                  )}
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
            Smart Contract
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
              href={`${EXPLORER}/address/${REGISTRY || "0xF1d42cC99604b1AE50322156AF1AE28db965Cbd6"}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "12px", fontFamily: "var(--font-mono)",
                color: "var(--brand)", textDecoration: "none",
                wordBreak: "break-all", lineHeight: 1.5,
              }}
            >
              {REGISTRY || "0xF1d42cC99604b1AE50322156AF1AE28db965Cbd6"} ↗
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
            Click any transaction record above to see it on the blockchain. If the AI decided to
            rebalance, you&apos;ll see 3 records. If it decided to wait, only 2 — the smart contract
            blocked the third step automatically.
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
