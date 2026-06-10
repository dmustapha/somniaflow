import Link from "next/link";
import { Suspense } from "react";
import { getPipelineState, getStepDefinitions } from "@/lib/pipeline-service";
import { LiveBlock } from "@/components/LiveBlock";
import { SiteNav } from "@/components/SiteNav";

const DEMO_PIPELINE_IDS = (process.env.NEXT_PUBLIC_DEMO_PIPELINE_IDS ?? "1,2")
  .split(",")
  .map(s => s.trim());

const REGISTRY_ADDR  = "0xE1264BB2a3961d616D965b78873800682571eCbC";
const REGISTRY_SHORT = `0x${REGISTRY_ADDR.slice(2, 6)}\u2026${REGISTRY_ADDR.slice(-4)}`;

const AGENT_TYPE_NAMES: Record<number, string> = { 0: "JSON API", 1: "AI Inference", 2: "Web Parse", 3: "External" };

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
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
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
          ? stepDefs.map(d => AGENT_TYPE_NAMES[d.agentType]).join(" → ")
          : `Pipeline #${id}`;
        const pipeDesc  = stepDefs.length > 0
          ? `${stepDefs.length} agents · on-chain orchestration`
          : "3 agents";
        const dotColor  = STATUS_COLOR[state.status] ?? "var(--text-lo)";
        const isRunning = state.status === "Running";

        return (
          <Link key={id} href={`/pipeline/${id}?demo=execute`} style={{ textDecoration: "none" }}>
            <div
              className="sf-glass"
              style={{
                padding: "16px 20px",
                display: "flex", alignItems: "center", gap: "14px",
                cursor: "pointer", transition: "background 0.15s",
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
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {[1, 2].map(i => (
        <div key={i} className="sf-glass" style={{ height: "64px", animation: "sf-pulse 1.5s ease-in-out infinite" }} />
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
        <div style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "60px 36px",
          width: "100%",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: "10px", fontWeight: 500, letterSpacing: "0.2em",
            textTransform: "uppercase", color: "var(--brand)",
            marginBottom: "28px", fontFamily: "var(--font-mono)",
            display: "flex", alignItems: "center", gap: "16px",
          }}>
            <span style={{ width: "40px", height: "1px", background: "linear-gradient(90deg, transparent, var(--brand))", flexShrink: 0 }} />
            On-chain multi-agent orchestration
            <span style={{ width: "40px", height: "1px", background: "linear-gradient(90deg, var(--brand), transparent)", flexShrink: 0 }} />
          </div>

          <h1 style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(30px, 3.8vw, 52px)",
            fontStyle: "italic",
            fontWeight: 400,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--text-hi)",
            marginBottom: "22px",
          }}>
            Chain AI agents together and{" "}
            <em style={{ color: "var(--brand)" }}>record every<br />
            decision permanently on-chain.</em>
          </h1>

          <p style={{
            fontSize: "15px", lineHeight: 1.7, color: "var(--text-mid)",
            maxWidth: "560px", marginBottom: "36px",
            fontFamily: "var(--font-sans)",
          }}>
            SomniaFlow runs sequences of AI agents coordinated by a smart contract.
            Each step can fetch data, run LLM inference, or parse the web.
            The contract decides which steps execute based on each agent&apos;s output.
            No server, no human in the loop — the logic is transparent and anyone can audit it.
          </p>

          {/* Plain-English stat strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4,1fr)",
            border: "1px solid var(--border)",
            maxWidth: "540px", marginBottom: "32px",
            margin: "0 auto 32px",
          }}>
            {[
              { val: "LIVE",     label: "On Somnia blockchain",    color: "var(--ok)"      },
              { val: "ON-CHAIN", label: "Decisions stored forever", color: "var(--ok)"      },
              { val: "OPEN",     label: "Anyone can verify",        color: "var(--text-hi)" },
              { val: "FAST",     label: "~1s block times",          color: "var(--text-hi)" },
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
                  fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.1em", color: "var(--text-lo)", fontFamily: "var(--font-sans)",
                }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Demo CTAs */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=execute`}>
              <button className="sf-btn-primary">Run demo: AI executes all steps</button>
            </Link>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=skip`}>
              <button className="sf-btn-ghost">Run demo: AI skips a step</button>
            </Link>
          </div>
          <div style={{ marginBottom: "48px" }}>
            <Link
              href="/compose"
              style={{
                fontSize: "13px", fontFamily: "var(--font-sans)",
                color: "var(--text-mid)", textDecoration: "none",
                letterSpacing: "0.02em",
              }}
            >
              or build your own pipeline →
            </Link>
          </div>

          {/* Scroll cue */}
          <div style={{
            fontSize: "11px", fontFamily: "var(--font-mono)",
            color: "var(--text-lo)", letterSpacing: "0.08em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>
            <span>↓</span>
            <span>see live demo below</span>
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
              Live demos
            </div>
            <div className="sf-glass" style={{ padding: "20px" }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-hi)", marginBottom: "14px" }}>
                Demo pipelines
              </div>
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
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-hi)", lineHeight: 1.1 }}>
                  How It Works
                </div>
                <span style={{
                  fontSize: "10px", padding: "3px 8px",
                  border: "1px solid rgba(74,222,128,0.3)", color: "var(--ok)",
                  fontFamily: "var(--font-mono)", fontWeight: 600,
                }}>
                  ON-CHAIN
                </span>
              </div>

              {[
                { k: "Smart contract decides", v: "Reads each agent's output and decides which step runs next", cls: ""      },
                { k: "Decision source",        v: "Smart contract — not a server, not an API",                 cls: "ok"    },
                { k: "All steps run",          v: "Every agent executes and is recorded on-chain",             cls: ""      },
                { k: "Step skipped",           v: "Contract blocks the step — still recorded on-chain",        cls: ""      },
                { k: "Contract address",       v: REGISTRY_SHORT,                                              cls: "brand" },
              ].map(({ k, v, cls }) => (
                <div key={k} className="sf-dr">
                  <span className="sf-dr-key">{k}</span>
                  <span className={`sf-dr-val ${cls}`} style={{ maxWidth: "220px", textAlign: "right" }}>{v}</span>
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
                    opacity: 0.7, transition: "opacity 0.15s",
                  }}
                >
                  ↗ view contract on explorer
                </a>
                <Link
                  href="/proof"
                  style={{
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-mid)", textDecoration: "none",
                    opacity: 0.7,
                  }}
                >
                  See all recorded decisions →
                </Link>
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
