"use client";
import { useEffect, useState } from "react";

interface EliteDashboard {
  system_stats: any;
  whale_stats: any;
  warning_stats: any;
  top_opportunities: any[];
  risk_distribution: any[];
  status: string;
}

export default function ElitePage() {
  const [dashboard, setDashboard] = useState<EliteDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await fetch("/api/elite-dashboard", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setDashboard(data);
        }
      } catch (err) {
        console.error("Failed to fetch elite dashboard:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px 0", color: "#fff" }}>
          🔥 Elite Intelligence System
        </h2>
        <p style={{ fontSize: "14px", color: "#8a8a9e", margin: 0 }}>
          Whale tracking • Contract forensics • Risk analysis • Early warning
        </p>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {loading ? (
          <div style={{ color: "#8a8a9e", textAlign: "center", padding: "60px" }}>
            Loading elite analytics...
          </div>
        ) : !dashboard ? (
          <div style={{ color: "#8a8a9e", textAlign: "center", padding: "60px" }}>
            Elite system initializing...
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "32px" }}>
              <div style={{ padding: "16px", background: "rgba(52, 199, 89, 0.1)", border: "1px solid rgba(52, 199, 89, 0.3)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>Tracked</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#34c759" }}>{dashboard.system_stats.total_coins_tracked}</div>
                <div style={{ fontSize: "10px", color: "#8a8a9e", marginTop: "4px" }}>coins</div>
              </div>

              <div style={{ padding: "16px", background: "rgba(48, 176, 192, 0.1)", border: "1px solid rgba(48, 176, 192, 0.3)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>Whales</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#30b0c0" }}>{dashboard.system_stats.tracked_whales}</div>
                <div style={{ fontSize: "10px", color: "#8a8a9e", marginTop: "4px" }}>proven</div>
              </div>

              <div style={{ padding: "16px", background: "rgba(52, 199, 89, 0.1)", border: "1px solid rgba(52, 199, 89, 0.3)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>Tradeable</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#34c759" }}>{dashboard.system_stats.tradeable_coins}</div>
                <div style={{ fontSize: "10px", color: "#8a8a9e", marginTop: "4px" }}>low risk</div>
              </div>

              <div style={{ padding: "16px", background: "rgba(255, 59, 48, 0.1)", border: "1px solid rgba(255, 59, 48, 0.3)", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>Warnings</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#ff3b30" }}>{dashboard.system_stats.active_warnings}</div>
                <div style={{ fontSize: "10px", color: "#8a8a9e", marginTop: "4px" }}>active</div>
              </div>
            </div>

            <div style={{ color: "#8a8a9e", fontSize: "12px", textAlign: "center", paddingTop: "32px" }}>
              ✅ {dashboard.status} • {new Date(dashboard.timestamp).toLocaleTimeString()}
            </div>
          </>
        )}
      </div>
    </>
  );
}
