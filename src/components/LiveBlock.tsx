"use client";
import { useState, useEffect } from "react";

export function LiveBlock() {
  const [block, setBlock] = useState<number | null>(null);

  useEffect(() => {
    async function fetchBlock() {
      try {
        const res = await fetch("https://dream-rpc.somnia.network", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        });
        const { result } = await res.json();
        setBlock(parseInt(result, 16));
      } catch { /* RPC unreachable — fail silently */ }
    }
    fetchBlock();
    const interval = setInterval(fetchBlock, 5_000);
    return () => clearInterval(interval);
  }, []);

  if (!block) {
    return (
      <span className="sf-shimmer" style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-lo)", opacity: 0.6 }}>
        connecting...
      </span>
    );
  }
  return (
    <span key={block} className="sf-fade-in" style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ok)" }}>
      block {block.toLocaleString()}
    </span>
  );
}
