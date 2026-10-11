"use client";
import { useEffect, useState } from "react";

export default function OpsPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);
  const [usage, setUsage] = useState<any>(null);

  useEffect(() => {
    const fetch_data = async () => {
      try {
        const res = await fetch("/api/telemetry", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
          setBackendOnline(data.status !== "OFFLINE" && data.lastWorkerCycleAt);
        } else {
          setBackendOnline(false);
        }
      } catch (err) {
        setBackendOnline(false);
      } finally {
        setLoading(false);
      }
    };
    fetch_data();
    // how much of the free plans is used (the same numbers the site's own brakes use)
    fetch("/api/usage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((u) => u && setUsage(u)).catch(() => undefined);
  }, []);

  const getStatusColor = (online: boolean) => online ? "#20E5A3" : "#FF546A";
  const getStatusLabel = (online: boolean) => online ? "ONLINE" : "OFFLINE";

  return (
    <>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px 0", color: "#fff" }}>Operations</h2>
        <p style={{ fontSize: "14px", color: "#8a8a9e", margin: 0 }}>System health and pipeline status</p>
      </div>
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)" }}>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 40px" }}>Loading...</div>
        ) : (
          <div>
            <div style={{ marginBottom: "32px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "16px", textTransform: "uppercase" }}>System Status</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
                <div style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Worker</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: getStatusColor(backendOnline) }}>{getStatusLabel(backendOnline)}</div>
                </div>
                <div style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Database</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#20E5A3" }}>ONLINE</div>
                </div>
                <div style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Cache (Redis)</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#20E5A3" }}>ONLINE</div>
                </div>
              </div>
            </div>

            {usage && (
              <div style={{ marginBottom: "32px" }}>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px", textTransform: "uppercase" }}>Free plan usage</h3>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 0 12px" }}>
                  Supabase Free allows {usage.plan.dbMb} MB of database and {usage.plan.egressGbMonth} GB sent out a month; Vercel Hobby allows {usage.plan.cpuHoursMonth} CPU-hours a month. The site slows its own scans down when a day's allowance is used up, so these cannot run over.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
                  {[
                    { label: "Database", used: usage.databaseMb, of: usage.plan.dbMb, unit: "MB", note: `pauses scanning at ${usage.budgets.storageStopMb || "—"} MB` },
                    { label: "Sent out this month", used: usage.month.egressMb / 1024, of: usage.plan.egressGbMonth, unit: "GB", note: `today's brake at ${usage.budgets.egressMbPerDay} MB a day` },
                    { label: "Scan CPU this month", used: usage.month.cpuS / 3600, of: usage.plan.cpuHoursMonth, unit: "h", note: `today's brake at ${usage.budgets.cpuSPerDay} s a day (scans only)` },
                  ].map((m) => {
                    const pct = Math.min(100, (100 * m.used) / m.of);
                    const color = pct >= 80 ? "#FF546A" : pct >= 50 ? "#ff9f0a" : "#20E5A3";
                    return (
                      <div key={m.label} style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>{m.label}</div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color }}>{m.used < 10 ? m.used.toFixed(2) : Math.round(m.used)} {m.unit} <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)" }}>of {m.of} {m.unit} ({Math.round(pct)}%)</span></div>
                        <div style={{ height: 4, borderRadius: 2, background: "#2a2a3e", marginTop: 8 }}><div style={{ height: 4, borderRadius: 2, width: `${Math.max(2, pct)}%`, background: color }} /></div>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 6 }}>{m.note}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {status && (
              <div style={{ marginBottom: "32px" }}>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "16px", textTransform: "uppercase" }}>Latest Activity</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
                  <div style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Last Worker Cycle</div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>
                      {status.lastWorkerCycleAt ? new Date(status.lastWorkerCycleAt).toLocaleString() : "Never"}
                    </div>
                  </div>
                  <div style={{ padding: "12px", background: "var(--bg-raised)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Total Candidates</div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "#2585FF" }}>{status.candidateCount || "—"}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
