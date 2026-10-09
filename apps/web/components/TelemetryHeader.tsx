"use client";

import { useState } from "react";
import { usePolling } from "../lib/usePolling";
import { formatLatency, formatRelativeTime, type FeedTelemetry } from "../lib/telemetry-utils";

export function TelemetryHeader() {
  const [telemetry, setTelemetry] = useState<FeedTelemetry | null>(null);

  // Was every 5 s, always. Now every 30 s while in use, paused while hidden, slower when untouched.
  usePolling(async () => {
    try {
      const res = await fetch("/api/telemetry");
      const data = await res.json();
      setTelemetry(data);
    } catch (err) {
      console.error("Telemetry fetch failed:", err);
    }
  }, 30_000);

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
