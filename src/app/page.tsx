import Link from "next/link";
import { Suspense } from "react";
import { getPipelineState, getStepDefinitions } from "@/lib/pipeline-service";
import { LiveBlock } from "@/components/LiveBlock";
import { SiteNav } from "@/components/SiteNav";
import { agentDisplayName } from "@/lib/agent-display";

const DEMO_PIPELINE_IDS = (process.env.NEXT_PUBLIC_DEMO_PIPELINE_IDS ?? "1,2")
  .split(",")
  .map(s => s.trim());

const REGISTRY_ADDR  = "0x7B19a2a65bC9604A40cc27F03C21A5329A7793e1";
const REGISTRY_SHORT = `0x${REGISTRY_ADDR.slice(2, 6)}\u2026${REGISTRY_ADDR.slice(-4)}`;

const STATUS_COLOR: Record<string, string> = {
  Idle:     "var(--text-lo)",
  Running:  "var(--brand)",
  Complete: "var(--ok)",
  Failed:   "#f87171",
};

async function PipelineList() {
  const [stateResults, stepResults] = await Promise.all([
    Promise.allSettled(DEMO_PIPELINE_IDS.map(id => getPipelineState(id))),
    Promise.allSettled(DEMO_PIPELINE_IDS.map(id => getStepDefinitions(id))),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {stateResults.map((result, i) => {
        const id = DEMO_PIPELINE_IDS[i];
        if (result.status === "rejected") {
          return (
            <div
              key={id}
              className="sf-glass"
              style={{ padding: "14px 18px", fontSize: "12px", color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}
            >
              Demo {id} — not yet active
            </div>
          );
        }
        const state     = result.value;
        const stepDefs  = stepResults[i]?.status === "fulfilled" ? stepResults[i].value : [];
        const pipeName  = stepDefs.length > 0
          ? stepDefs.map(d => agentDisplayName(d)).join(" → ")
          : `Pipeline #${id}`;
        const pipeDesc  = stepDefs.length > 0
          ? `${stepDefs.length} AI steps · blockchain-verified`
          : "Multi-step AI workflow";
        const dotColor  = STATUS_COLOR[state.status] ?? "var(--text-lo)";
        const isRunning = state.status === "Running";

        return (
          <Link key={id} href={`/pipeline/${id}?demo=execute`} style={{ textDecoration: "none" }}>
            <div
              className="sf-glass sf-pipeline-item"
              style={{
                padding: "16px 20px",
                display: "flex", alignItems: "center", gap: "14px",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                  backgroundColor: dotColor,
                  boxShadow: isRunning ? `0 0 6px ${dotColor}` : "none",
                  animation: isRunning ? "sf-pulse 2s ease-in-out infinite" : "none",
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-hi)", marginBottom: "3px" }}>
                  {pipeName}
                </div>
                <div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
                  {pipeDesc}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{
                  fontSize: "12px", fontWeight: 600, fontFamily: "var(--font-mono)",
                  color: dotColor, letterSpacing: "0.05em",
                }}>
                  {state.status.toUpperCase()}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {[1, 2].map(i => (
        <div key={i} className="sf-glass sf-shimmer" style={{ height: "64px" }} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="sf-bg">
      <div className="sf-grain-overlay" aria-hidden="true" />

      <SiteNav right={<><div className="sf-live-dot" /><LiveBlock /></>} />

      {/* HERO — full viewport, editorial only, no live data */}
      <section style={{
        minHeight: "calc(100dvh - 49px)",
        display: "flex", alignItems: "center",
        borderBottom: "1px solid var(--border)",
      }}>
        <div className="sf-hero-inner" style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "60px 36px",
          width: "100%",
          textAlign: "center",
        }}>
          <div className="sf-fade-up" style={{
            fontSize: "11px", fontWeight: 500, letterSpacing: "0.18em",
            textTransform: "uppercase", color: "var(--brand)",
            marginBottom: "28px", fontFamily: "var(--font-mono)",
            display: "flex", alignItems: "center", gap: "16px",
          }}>
            <span style={{ width: "40px", height: "1px", background: "linear-gradient(90deg, transparent, var(--brand))", flexShrink: 0 }} />
            AI workflows recorded on the blockchain
            <span style={{ width: "40px", height: "1px", background: "linear-gradient(90deg, var(--brand), transparent)", flexShrink: 0 }} />
          </div>

          <h1 className="sf-fade-up sf-stagger-1" style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(30px, 3.8vw, 52px)",
            fontStyle: "italic",
            fontWeight: 400,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--text-hi)",
            marginBottom: "22px",
          }}>
            Chain AI steps together and{" "}
            <em style={{ color: "var(--brand)" }}>record every
            decision permanently on the blockchain.</em>
          </h1>

          <p className="sf-fade-up sf-stagger-2" style={{
            fontSize: "15px", lineHeight: 1.7, color: "var(--text-mid)",
            maxWidth: "560px", marginBottom: "36px",
            fontFamily: "var(--font-sans)",
          }}>
            Fully automatic. SomniaFlow connects AI steps into workflows where
            the blockchain decides what runs next. Every decision is
            transparent and anyone can verify it.
          </p>

          {/* Plain-English stat strip */}
          <div className="sf-stat-grid sf-fade-up sf-stagger-3" style={{
            display: "grid", gridTemplateColumns: "repeat(4,1fr)",
            border: "1px solid var(--border)",
            maxWidth: "540px", marginBottom: "32px",
            margin: "0 auto 32px",
          }}>
            {[
              { val: "LIVE",   label: "Network status",       color: "var(--ok)"      },
              { val: "4",      label: "AI steps per workflow", color: "var(--text-hi)" },
              { val: "100%",   label: "Publicly verifiable",  color: "var(--ok)"      },
              { val: "<1s",    label: "Response speed",        color: "var(--text-hi)" },
            ].map((s, i) => (
              <div key={i} style={{
                padding: "12px 14px",
                borderRight: i < 3 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{
                  fontSize: "18px", fontWeight: 700, letterSpacing: "-0.02em",
                  color: s.color, marginBottom: "3px", fontFamily: "var(--font-sans)",
                }}>
                  {s.val}
                </div>
                <div style={{
                  fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: "var(--text-mid)", fontFamily: "var(--font-sans)",
                }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Demo CTAs */}
          <div className="sf-fade-up sf-stagger-4" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=execute`}>
              <button className="sf-btn-primary">Watch a live demo</button>
            </Link>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=skip`}>
              <button className="sf-btn-ghost">Watch AI skip a step</button>
            </Link>
          </div>
          <div className="sf-fade-up sf-stagger-5" style={{ marginBottom: "48px" }}>
            <Link
              href="/compose"
              className="sf-btn-ghost"
              style={{
                fontSize: "13px", fontFamily: "var(--font-sans)",
                padding: "8px 20px",
                display: "inline-flex", alignItems: "center", gap: "6px",
              }}
            >
              Build your own workflow <span style={{ fontSize: "16px" }}>→</span>
            </Link>
          </div>

          {/* Scroll cue */}
          <div className="sf-fade-up sf-stagger-6" style={{
            fontSize: "11px", fontFamily: "var(--font-mono)",
            color: "var(--text-lo)", letterSpacing: "0.08em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>
            <span className="sf-float">↓</span>
            <span>see demo workflows below</span>
          </div>
        </div>
      </section>

      {/* DASHBOARD — below fold: pipeline list + how it works */}
      <section>
        <div
          className="sf-main-grid"
          style={{
            maxWidth: "1200px", margin: "0 auto",
            display: "grid", gridTemplateColumns: "55% 45%",
          }}
        >

          {/* Left: pipeline list */}
          <div style={{
            padding: "48px 48px 48px 36px",
            borderRight: "1px solid var(--border)",
          }}>
            <div style={{
              fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "var(--text-lo)",
              marginBottom: "16px", fontFamily: "var(--font-sans)",
            }}>
              Demo workflows
            </div>
            <div className="sf-glass" style={{ padding: "20px" }}>
              <Suspense fallback={<PipelineSkeleton />}>
                <PipelineList />
              </Suspense>
            </div>
          </div>

          {/* Right: how it works */}
          <div style={{
            padding: "48px 36px 48px 32px",
            display: "flex", flexDirection: "column", gap: "16px",
            justifyContent: "flex-start",
          }}>
            <div style={{
              fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "var(--text-lo)",
              marginBottom: "0", fontFamily: "var(--font-sans)",
            }}>
              How it works
            </div>

            <div className="sf-glass" style={{ padding: "20px" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "14px",
              }}>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-hi)", fontFamily: "var(--font-sans)" }}>
                  Workflow logic
                </div>
                <span style={{
                  fontSize: "10px", padding: "3px 8px",
                  border: "1px solid rgba(74,222,128,0.3)", color: "var(--ok)",
                  fontFamily: "var(--font-mono)", fontWeight: 600,
                  borderRadius: "20px",
                }}>
                  ON-CHAIN
                </span>
              </div>

              {[
                { k: "Blockchain decides",     v: "Reads each step's output and picks what runs next",        cls: ""      },
                { k: "Decision maker",         v: "The blockchain, not a company server",                      cls: "ok"    },
                { k: "All steps run",          v: "Every AI step runs and gets saved to the blockchain",       cls: ""      },
                { k: "Step skipped",           v: "Blockchain blocks the step, still saved as proof",          cls: ""      },
                { k: "Blockchain address",     v: REGISTRY_SHORT,                                              cls: "brand" },
              ].map(({ k, v, cls }) => (
                <div key={k} className="sf-dr">
                  <span className="sf-dr-key">{k}</span>
                  <span className={`sf-dr-val ${cls}`} style={{ maxWidth: "260px", textAlign: "right" }}>{v}</span>
                </div>
              ))}

              <div style={{ marginTop: "14px", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                <a
                  href={`https://shannon-explorer.somnia.network/address/${REGISTRY_ADDR}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--brand)", textDecoration: "none",
                  }}
                >
                  ↗ verify on blockchain explorer
                </a>
                <Link
                  href="/proof"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-mid)", textDecoration: "none",
                  }}
                >
                  View all recorded results →
                </Link>
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
