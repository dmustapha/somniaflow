import Link from "next/link";
import { Suspense } from "react";
import { getPipelineState } from "@/lib/pipeline-service";
import { LiveBlock } from "@/components/LiveBlock";
import { SiteNav } from "@/components/SiteNav";

const DEMO_PIPELINE_IDS = (process.env.NEXT_PUBLIC_DEMO_PIPELINE_IDS ?? "1,2")
  .split(",")
  .map(s => s.trim());

const REGISTRY_ADDR  = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "";
const REGISTRY_SHORT = REGISTRY_ADDR
  ? `0x${REGISTRY_ADDR.slice(2, 6)}\u2026${REGISTRY_ADDR.slice(-4)}`
  : "0xF1d4\u2026Cbd6";

const STATUS_COLOR: Record<string, string> = {
  Idle:     "var(--text-lo)",
  Running:  "var(--brand)",
  Complete: "var(--ok)",
  Failed:   "#f87171",
};

const PIPELINE_META: Record<string, { name: string; description: string }> = {
  "1": {
    name:        "ETH Rebalancing Agent",
    description: "Check price · AI decides · Check volume",
  },
  "2": {
    name:        "ETH Rebalancing Agent v2",
    description: "Check price · AI decides · Check volume",
  },
};

async function PipelineList() {
  const states = await Promise.allSettled(
    DEMO_PIPELINE_IDS.map(id => getPipelineState(id))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {states.map((result, i) => {
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
        const state    = result.value;
        const pipeMeta = PIPELINE_META[id] ?? { name: `Demo ${id}`, description: "3 steps" };
        const dotColor = STATUS_COLOR[state.status] ?? "var(--text-lo)";
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
                  {pipeMeta.name}
                </div>
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
                  {pipeMeta.description}
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
            Demo: AI making financial decisions on-chain
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
            An AI agent that reads<br />
            ETH prices, decides whether<br />
            to rebalance, and{" "}
            <em style={{ color: "var(--brand)" }}>records every<br />
            decision permanently.</em>
          </h1>

          <p style={{
            fontSize: "15px", lineHeight: 1.7, color: "var(--text-mid)",
            maxWidth: "560px", marginBottom: "36px",
            fontFamily: "var(--font-sans)",
          }}>
            SomniaFlow runs three AI agents in sequence: one checks the ETH price,
            one decides whether to rebalance your portfolio, and one acts on that
            decision — all coordinated by a smart contract with no human in the loop.
            The logic is transparent and tamper-proof — anyone can audit it.
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
              { val: "NONE",     label: "No central server",        color: "var(--text-hi)" },
              { val: "$0",       label: "Free to run",              color: "var(--text-hi)" },
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", marginBottom: "48px" }}>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=execute`}>
              <button className="sf-btn-primary">Run demo: AI decides to rebalance</button>
            </Link>
            <Link href={`/pipeline/${DEMO_PIPELINE_IDS[0] ?? "1"}?demo=skip`}>
              <button className="sf-btn-ghost">Run demo: AI decides to wait</button>
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
                { k: "Smart contract decides", v: "Reads the AI's output and chooses which steps run next",   cls: ""      },
                { k: "Decision source",        v: "Smart contract — not a server, not an API",               cls: "ok"    },
                { k: "AI rebalances",          v: "All 3 steps run and are recorded on-chain",               cls: ""      },
                { k: "AI waits",               v: "Only 2 steps run — contract blocks the third",            cls: ""      },
                { k: "Contract address",       v: REGISTRY_SHORT || "0xF1d4\u2026Cbd6",                     cls: "brand" },
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
                  ↗ view contract on blockchain explorer
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
