"use client";

const RadarDesignFixture = () => (
  <div style={{ display: "flex", height: "100%", background: "var(--bg-base)", gap: "0" }}>
    {/* LEFT: TABLE */}
    <div style={{ flex: "0 1 72%", display: "flex", flexDirection: "column", minWidth: "0", borderRight: "1px solid var(--border-color)" }}>
      <div style={{ position: "relative", padding: "32px 32px 20px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "#2585FF", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "12px" }}>
            AUREUS INTELLIGENCE
          </div>
          <h1 style={{ fontSize: "36px", fontWeight: 800, margin: "0 0 8px 0", color: "var(--text-primary)" }}>
            Radar
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
            Discover and verify opportunities across Solana.
          </p>
        </div>
      </div>

      {/* METRICS STRIP */}
      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-color)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", flexShrink: 0 }}>
        {[
          { label: "Candidates", value: "127", color: "#2585FF" },
          { label: "Qualified", value: "14", color: "#20E5A3" },
          { label: "Waiting", value: "89", color: "#FFB52F" },
          { label: "Rejected", value: "24", color: "#FF546A" },
        ].map((m) => (
          <div key={m.label} style={{ padding: "14px", background: "linear-gradient(135deg, var(--bg-interactive) 0%, var(--bg-raised) 100%)", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
            <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: m.color, fontFamily: "monospace", marginTop: "6px" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, overflow: "auto", minHeight: "0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-raised)" }}>
              {["SYMBOL", "PRICE", "MCAP", "LIQUIDITY", "STATUS", "CONFIDENCE"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { symbol: "POOR", price: "$0.00012", mcap: "$152K", liq: "$32K", status: "Qualified" },
              { symbol: "MEME", price: "$0.00045", mcap: "$287K", liq: "$54K", status: "Qualified" },
              { symbol: "DOGE2", price: "$0.00088", mcap: "$445K", liq: "$91K", status: "Waiting" },
              { symbol: "FLOKI", price: "$0.00156", mcap: "$623K", liq: "$128K", status: "Waiting" },
              { symbol: "PEPE", price: "$0.00234", mcap: "$912K", liq: "$201K", status: "Waiting" },
            ].map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-color)", background: i === 0 ? "rgba(37, 133, 255, 0.08)" : "transparent", borderLeft: i === 0 ? "3px solid #2585FF" : "3px solid transparent" }}>
                <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 600 }}>{row.symbol}</td>
                <td style={{ padding: "10px 12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>{row.price}</td>
                <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{row.mcap}</td>
                <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{row.liq}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: "4px", fontSize: "9px", fontWeight: 700, background: row.status === "Qualified" ? "rgba(32, 231, 163, 0.15)" : "rgba(255, 181, 47, 0.15)", color: row.status === "Qualified" ? "#20E5A3" : "#FFB52F" }}>
                    {row.status}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ flex: 1, height: "4px", background: "var(--bg-raised)", borderRadius: "2px", overflow: "hidden", border: "1px solid var(--border-color)" }}>
                      <div style={{ height: "100%", width: `${70 + i * 5}%`, background: "linear-gradient(90deg, #2585FF, #35DCFF)", transition: "width 300ms ease" }} />
                    </div>
                    <span style={{ fontSize: "9px", fontWeight: 700, color: "#35DCFF", minWidth: "28px", textAlign: "right" }}>{70 + i * 5}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* RIGHT PANEL */}
    <div style={{ flex: "0 0 340px", display: "flex", flexDirection: "column", background: "var(--bg-surface)", overflow: "hidden", borderLeft: "1px solid var(--border-color)" }}>
      <div style={{ padding: "18px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>TOKEN</div>
        <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>POOR</div>
        <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>$POOR</div>
      </div>

      <div style={{ padding: "14px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
        <div style={{ fontSize: "8px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>Price</div>
        <div style={{ fontSize: "24px", fontWeight: 800, fontFamily: "monospace" }}>$0.000120</div>
        <div style={{ fontSize: "11px", color: "#20E5A3", fontWeight: 600, marginTop: "4px" }}>+12.3% (24h)</div>
      </div>

      <div style={{ padding: "14px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div style={{ fontSize: "9px", padding: "8px", background: "var(--bg-raised)", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
            <div style={{ color: "var(--text-muted)", marginBottom: "3px", fontWeight: 600 }}>Market Cap</div>
            <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "12px" }}>$152K</div>
          </div>
          <div style={{ fontSize: "9px", padding: "8px", background: "var(--bg-raised)", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
            <div style={{ color: "var(--text-muted)", marginBottom: "3px", fontWeight: 600 }}>Liquidity</div>
            <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "12px" }}>$32K</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "14px" }}>
        <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Structural Verification</div>
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Token passes all structural checks. Liquidity verified. No known red flags.
        </div>
      </div>

      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border-color)", flexShrink: 0, display: "flex", gap: "8px", flexDirection: "column" }}>
        <button style={{ width: "100%", padding: "10px", background: "#2585FF", color: "#020914", border: "none", borderRadius: "6px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}>
          View Details
        </button>
      </div>
    </div>
  </div>
);

export default function DesignPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-base)" }}>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid var(--border-color)", background: "var(--bg-surface)" }}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>Visual Design Fixtures</h2>
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>Development-only component previews. Not in production routes.</p>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ height: "calc(100vh - 120px)" }}>
          <RadarDesignFixture />
        </div>
      </div>
    </div>
  );
}
