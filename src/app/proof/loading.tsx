export default function ProofLoading() {
  return (
    <div className="sf-bg">
      <div className="sf-grain-overlay" aria-hidden="true" />
      <main style={{ maxWidth: "820px", margin: "0 auto", padding: "48px 36px 80px" }}>
        <div style={{ height: "20px", width: "280px", background: "var(--surface-2)", borderRadius: "4px", marginBottom: "14px", animation: "sf-pulse 1.5s ease-in-out infinite" }} />
        <div style={{ height: "36px", width: "500px", background: "var(--surface-2)", borderRadius: "4px", marginBottom: "10px", animation: "sf-pulse 1.5s ease-in-out infinite" }} />
        <div style={{ height: "18px", width: "400px", background: "var(--surface-2)", borderRadius: "4px", marginBottom: "40px", animation: "sf-pulse 1.5s ease-in-out infinite" }} />
        {[1, 2].map(i => (
          <div key={i} className="sf-glass" style={{ height: "120px", marginBottom: "16px", animation: "sf-pulse 1.5s ease-in-out infinite" }} />
        ))}
      </main>
    </div>
  );
}
