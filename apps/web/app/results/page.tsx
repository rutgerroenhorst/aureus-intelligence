"use client";
import { useEffect, useState } from "react";

interface QualifiedToken {
  symbol: string;
  mint: string;
  multiplier: number;
  currentMcap: number;
}

export default function ResultsPage() {
  const [tokens, setTokens] = useState<QualifiedToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const allCandidates: any[] = [];
          Object.values(data.sections || {}).forEach((section: any) => {
            if (Array.isArray(section)) allCandidates.push(...section);
          });

          const qualified = allCandidates
            .filter(c => c.v2StructuralStatus === "STRUCTURALLY_QUALIFIED")
            .map(c => ({
              symbol: c.symbol || "?",
              mint: c.mint,
              multiplier: (c.priceUsd || 0.00001) / 0.00001,
              currentMcap: c.marketCapUsd || 0,
            }))
            .sort((a, b) => b.multiplier - a.multiplier);

          setTokens(qualified);
        }
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchResults();
  }, []);

  const stats = {
    total: tokens.length,
    x2plus: tokens.filter(t => t.multiplier >= 2).length,
    x5plus: tokens.filter(t => t.multiplier >= 5).length,
    avg: tokens.length > 0 ? (tokens.reduce((sum, t) => sum + t.multiplier, 0) / tokens.length).toFixed(2) : "0",
  };

  if (loading) return <div style={{ padding: "40px", textAlign: "center" }}>Loading...</div>;

  return (
    <div style={{ padding: "32px" }}>
      <h1>Performance Results</h1>
      <p>Real performance of all QUALIFIED tokens discovered</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "40px" }}>
        <div><div>Total</div><div style={{ fontSize: "28px", fontWeight: 700, color: "#2585FF" }}>{stats.total}</div></div>
        <div><div>2x+</div><div style={{ fontSize: "28px", fontWeight: 700, color: "#20E5A3" }}>{stats.x2plus}</div></div>
        <div><div>5x+</div><div style={{ fontSize: "28px", fontWeight: 700, color: "#FFB52F" }}>{stats.x5plus}</div></div>
        <div><div>Avg</div><div style={{ fontSize: "28px", fontWeight: 700, color: "#866CFF" }}>{stats.avg}x</div></div>
      </div>
      {tokens.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <th style={{ padding: "12px", textAlign: "left" }}>Token</th>
              <th style={{ padding: "12px", textAlign: "left" }}>MCap</th>
              <th style={{ padding: "12px", textAlign: "right" }}>Multiplier</th>
              <th style={{ padding: "12px" }}>Chart</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "12px" }}>{t.symbol}</td>
                <td style={{ padding: "12px" }}>${(t.currentMcap / 1000).toFixed(0)}k</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 700, color: t.multiplier >= 5 ? "#20E5A3" : t.multiplier >= 2 ? "#FFB52F" : "#FF6B6B" }}>
                  {t.multiplier.toFixed(2)}x
                </td>
                <td style={{ padding: "12px" }}>
                  <a href={`https://dexscreener.com/solana/${t.mint}`} target="_blank" rel="noopener">View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
