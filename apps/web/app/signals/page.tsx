"use client";
import { useEffect, useState } from "react";

interface Signal {
  id: string;
  candidateId: string;
  symbol?: string;
  eventType: string;
  eventCategory: string;
  eventPriority: string;
  eventLabel: string;
  eventDescription?: string;
  changePct?: number;
  priceUsd?: string;
  marketCapUsd?: string;
  liquidityUsd?: string;
  createdAt: string;
}

const Sparkline = ({ change }: { change?: number }) => {
  const width = 60;
  const height = 24;
  const segments = 24;
  const points = [];
  
  for (let i = 0; i < segments; i++) {
    const x = (i / (segments - 1)) * 100;
    const noise = Math.sin((i / segments) * Math.PI * 2.5) * 10;
    const trend = (change || 0) * (i / segments) * 0.2;
    const y = 50 + noise + trend;
    points.push(`${x},${y}`);
  }

  const color = (change || 0) >= 0 ? "#20E5A3" : "#FF546A";
  return (
    <svg width={width} height={height} viewBox="0 0 100 100" style={{ fill: "none" }}>
      <polyline points={points.join(" ")} stroke={color} strokeWidth="2" />
    </svg>
  );
};

const TokenAvatar = ({ symbol }: { symbol?: string }) => {
  const initials = (symbol || "?").slice(0, 2).toUpperCase();
  const colors = ["#20E5A3", "#2585FF", "#866CFF", "#FFB52F", "#FF546A"];
  const colorIndex = (symbol || "").charCodeAt(0) % colors.length;
  return (
    <div style={{
      width: "32px",
      height: "32px",
      borderRadius: "6px",
      background: colors[colorIndex],
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "12px",
      fontWeight: 700,
      color: "#020914",
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch("/api/signals", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setSignals(data.signals || []);
          if (data.signals?.length > 0 && !selectedSignal) {
            setSelectedSignal(data.signals[0]);
          }
        }
      } catch (err) {
        console.error("Failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSignals();
  }, []);

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      "Wallets": "#2585FF",
      "Structure": "#20E5A3",
      "Liquidity": "#FFB52F",
      "Risk": "#FF546A",
    };
    return colors[cat] || "#866CFF";
  };

  const getPriorityColor = (pri: string) => {
    const colors: Record<string, string> = {
      "CRITICAL": "#FF546A",
      "HIGH": "#FFB52F",
      "MEDIUM": "#2585FF",
    };
    return colors[pri] || "#20E5A3";
  };

  const filteredSignals = statusFilter === "all" ? signals : signals.filter(s => s.eventPriority === statusFilter);
  const criticalCount = signals.filter(s => s.eventPriority === "CRITICAL").length;
  const highCount = signals.filter(s => s.eventPriority === "HIGH").length;
  const mediumCount = signals.filter(s => s.eventPriority === "MEDIUM").length;

  return (
    <>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px 0", color: "#fff" }}>Signals Command Center</h2>
        <p style={{ fontSize: "14px", color: "#8a8a9e", margin: 0 }}>Real-time structural, wallet, and risk events</p>
      </div>
    <div style={{ display: "flex", gap: "0", height: "100%" }}>
        {/* LEFT: MAIN */}
        <div style={{ flex: "0 1 72%", display: "flex", flexDirection: "column", minWidth: "0" }}>

          {/* KPIs */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-color)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", flexShrink: 0 }}>
          {[
            { label: "Live Signals", value: signals.length, color: "#2585FF" },
            { label: "Qualified", value: criticalCount, color: "#20E5A3" },
            { label: "In Watch", value: highCount, color: "#FFB52F" },
            { label: "Rejected", value: mediumCount, color: "#FF546A" },
          ].map((m) => (
            <div key={m.label} style={{ padding: "12px", background: "linear-gradient(135deg, var(--bg-interactive) 0%, var(--bg-raised) 100%)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
              <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: m.color, fontFamily: "monospace" }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* FILTERS */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-color)", display: "flex", gap: "8px", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "6px" }}>
            {[
              { label: "All Signals", key: "all", count: signals.length },
              { label: "Qualified", key: "CRITICAL", count: criticalCount },
              { label: "Watching", key: "HIGH", count: highCount },
              { label: "Rejected", key: "MEDIUM", count: mediumCount },
            ].map((f) => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: statusFilter === f.key ? "1px solid #2585FF" : "1px solid var(--border-color)",
                  background: statusFilter === f.key ? "rgba(37, 133, 255, 0.1)" : "transparent",
                  color: statusFilter === f.key ? "#2585FF" : "var(--text-secondary)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {f.label} <span style={{fontSize:"9px"}}>•{f.count}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
            {["1h", "6h", "24h", "7d"].map((t) => (
              <button key={t} style={{
                padding: "6px 10px",
                borderRadius: "5px",
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
              }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* TABLE */}
        <div style={{ flex: 1, overflow: "auto", minHeight: "0" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "60px 40px" }}>Loading…</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-raised)" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>TIME</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>TOKEN</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>EVENT</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>CATEGORY</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>IMPACT</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>PRICE</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>24H</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "9px" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.map((signal) => (
                  <tr key={signal.id} onClick={() => setSelectedSignal(signal)}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      background: selectedSignal?.id === signal.id ? "rgba(37, 133, 255, 0.08)" : "transparent",
                      cursor: "pointer",
                      borderLeft: selectedSignal?.id === signal.id ? "3px solid #2585FF" : "3px solid transparent",
                    }}>
                    <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: "9px" }}>
                      {new Date(signal.createdAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <TokenAvatar symbol={signal.symbol} />
                        {signal.symbol}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: "10px" }}>{signal.eventLabel}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-block", padding: "3px 6px", borderRadius: "3px", fontSize: "9px", fontWeight: 600, background: getCategoryColor(signal.eventCategory) + "20", color: getCategoryColor(signal.eventCategory) }}>
                        {signal.eventCategory}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-block", padding: "3px 6px", borderRadius: "3px", fontSize: "9px", fontWeight: 600, background: getPriorityColor(signal.eventPriority) + "20", color: getPriorityColor(signal.eventPriority) }}>
                        {signal.eventPriority}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", fontSize: "9px" }}>
                      {signal.priceUsd ? `$${Number(signal.priceUsd).toFixed(6)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                      <Sparkline change={signal.changePct} />
                      <span style={{ color: (signal.changePct || 0) >= 0 ? "#20E5A3" : "#FF546A", fontWeight: 600, fontSize: "9px", minWidth: "40px" }}>
                        {signal.changePct ? `${signal.changePct > 0 ? "+" : ""}${signal.changePct.toFixed(1)}%` : "—"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", cursor: "pointer" }}>⋯</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      {selectedSignal && (
        <div style={{ flex: "0 0 360px", display: "flex", flexDirection: "column", background: "var(--bg-surface)", overflow: "hidden", borderLeft: "1px solid var(--border-color)" }}>
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <TokenAvatar symbol={selectedSignal.symbol} />
              <div><div style={{ fontSize: "14px", fontWeight: 800 }}>{selectedSignal.symbol}</div></div>
            </div>
          </div>

          <div style={{ padding: "14px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
            <div style={{ fontSize: "8px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>Price</div>
            <div style={{ fontSize: "24px", fontWeight: 800, fontFamily: "monospace", marginBottom: "4px" }}>
              ${selectedSignal.priceUsd ? Number(selectedSignal.priceUsd).toFixed(8) : "—"}
            </div>
            <div style={{ fontSize: "12px", color: (selectedSignal.changePct || 0) >= 0 ? "#20E5A3" : "#FF546A", fontWeight: 600 }}>
              {selectedSignal.changePct ? `${selectedSignal.changePct > 0 ? "+" : ""}${selectedSignal.changePct.toFixed(2)}% (24h)` : "—"}
            </div>
          </div>

          <div style={{ padding: "14px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { label: "Market Cap", value: selectedSignal.marketCapUsd ? `$${(Number(selectedSignal.marketCapUsd) / 1000).toFixed(1)}K` : "—" },
                { label: "Liquidity", value: selectedSignal.liquidityUsd ? `$${(Number(selectedSignal.liquidityUsd) / 1000).toFixed(1)}K` : "—" },
              ].map((m, i) => (
                <div key={i} style={{ fontSize: "9px", padding: "8px", background: "var(--bg-raised)", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
                  <div style={{ color: "var(--text-muted)", marginBottom: "3px", fontWeight: 600 }}>{m.label}</div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "12px" }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>


          <div style={{ flex: 1, overflow: "auto", padding: "14px" }}>
          </div>

          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border-color)", flexShrink: 0, display: "flex", gap: "8px", flexDirection: "column" }}>
            <button style={{ width: "100%", padding: "10px", background: "#2585FF", color: "#020914", border: "none", borderRadius: "6px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}>
              Set Alert
            </button>
            <button style={{ width: "100%", padding: "10px", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: "6px", fontWeight: 600, fontSize: "12px", cursor: "pointer" }}>
              View Details
            </button>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
