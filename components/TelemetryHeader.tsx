"use client";

import { useEffect, useState } from "react";
import { formatLatency, formatRelativeTime, type FeedTelemetry } from "../lib/telemetry-utils";

export function TelemetryHeader() {
  const [telemetry, setTelemetry] = useState<FeedTelemetry | null>(null);

  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const res = await fetch("/api/telemetry");
        const data = await res.json();
        setTelemetry(data);
      } catch (err) {
        console.error("Telemetry fetch failed:", err);
      }
    };

    fetchTelemetry();
    const interval = setInterval(() => fetchTelemetry(), 5000);
    return () => clearInterval(interval);
  }, []);

  if (!telemetry) {
    return (
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--panel)",
          fontSize: "12px",
          color: "var(--muted)",
        }}
      >
        Loading telemetry...
      </div>
    );
  }

  const statusColor =
    telemetry.status === "LIVE"
      ? "var(--emerald)"
      : telemetry.status === "DEGRADED"
        ? "var(--amber)"
        : "var(--coral)";

  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        backgroundColor: "var(--panel)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "12px",
        gap: "24px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ color: statusColor, fontWeight: 600 }}>
          ● {telemetry.status}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {formatLatency(telemetry.latencyMs)} latency
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: "16px",
          fontSize: "11px",
          color: "var(--muted-2)",
        }}
      >
        <div>
          <span style={{ color: "var(--muted)" }}>Candidates:</span>{" "}
          {telemetry.candidateCount}
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>Qualified:</span>{" "}
          {telemetry.v2QualifiedCount}
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>Last check:</span>{" "}
          {formatRelativeTime(telemetry.lastV2EvaluationAt)}
        </div>
      </div>
    </div>
  );
}
