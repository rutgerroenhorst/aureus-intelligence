"use client";
import { useEffect, useState } from "react";

export default function OpsPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);

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
  }, []);

  const getStatusColor = (online: boolean) => online ? "#20E5A3" : "#FF546A";
  const getStatusLabel = (online: boolean) => online ? "ONLINE" : "OFFLINE";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)" }}>
      <div style={{ padding: "32px 32px 24px", borderBottom: "1px solid var(--border-color)" }}>
        <div style={{ fontSize: "10px", fontWeight: 700, color: "#2585FF", textTransform: "uppercase", marginBottom: "12px" }}>AUREUS INTELLIGENCE</div>
        <h1 style={{ fontSize: "36px", fontWeight: 800, margin: "0 0 8px 0" }}>Operations</h1>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>System health and pipeline status</p>
      </div>

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
  );
}
