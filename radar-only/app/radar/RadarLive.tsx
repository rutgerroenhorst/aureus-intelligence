"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { BoardView } from "../../lib/boardTypes";
import { ago, usd, dexUrl } from "../../lib/format";
import { formatConfidence } from "../../lib/confidenceFormatter";
import { formatRelativeTime } from "../../lib/telemetry-utils";
import { getV2Status, V2_STATUS_LABELS } from "../../lib/v2StatusType";

const MCAP_CEILING = 150_000;

function V2StatusBadge({ status }: { status: string | null }) {
  const v2Status = getV2Status(status);
  const config = V2_STATUS_LABELS[v2Status];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
      <span style={{ fontSize: "12px", fontWeight: "600", color: config.color ? `var(${config.color})` : "var(--muted)" }}>
        {config.label}
      </span>
      {config.secondary && <span style={{ fontSize: "12px", color: "var(--muted)" }}>{config.secondary}</span>}
    </div>
  );
}

function CandidateCard({ v }: { v: any }) {
  const mcap = v.marketCapUsd;
  const liq = v.liquidityUsd;
  const isQualified = v.v2StructuralStatus === "STRUCTURALLY_QUALIFIED";

  return (
    <Link
      href={`/candidate/${v.id}`}
      className="dcard"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        textDecoration: "none",
        color: "inherit",
        borderColor: isQualified ? "var(--go)" : "var(--border)",
        backgroundColor: isQualified ? "rgba(34, 197, 94, 0.05)" : "var(--panel)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div>
          <h3 style={{ margin: "0 0 3px 0", fontSize: "14px", fontWeight: "600", color: isQualified ? "var(--go)" : "var(--text)" }}>
            {v.symbol ?? "Unknown"}
          </h3>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>{v.code ?? v.id.slice(0, 8)}</p>
        </div>
        <V2StatusBadge status={v.v2StructuralStatus} />
      </div>

      {isQualified && v.v2PassedGates && v.v2PassedGates.length > 0 && (
        <div style={{ fontSize: "11px", gap: "4px", display: "flex", flexDirection: "column", padding: "8px", backgroundColor: "rgba(34, 197, 94, 0.08)", borderRadius: "4px" }}>
          <span style={{ color: "var(--go)", fontWeight: "600" }}>Qualified via:</span>
          {v.v2PassedGates.slice(0, 3).map((g) => (
            <div key={g.gateId} style={{ color: "var(--muted)", lineHeight: "1.3" }}>
              • {g.reason}
            </div>
          ))}
          {v.v2PassedGates.length > 3 && (
            <div style={{ color: "var(--muted)", fontStyle: "italic" }}>
              +{v.v2PassedGates.length - 3} more checks passed
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", fontSize: "12px", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
        <div>
          <p style={{ margin: "0 0 6px 0", color: "var(--muted)", fontSize: "11px" }}>MCap</p>
          <p style={{ margin: 0, color: "var(--text)" }}>{mcap != null ? usd(mcap) : "—"}</p>
        </div>
        <div>
          <p style={{ margin: "0 0 6px 0", color: "var(--muted)", fontSize: "11px" }}>Liq</p>
          <p style={{ margin: 0, color: "var(--text)" }}>{liq != null ? usd(liq) : "—"}</p>
        </div>
        <div>
          <p style={{ margin: "0 0 6px 0", color: "var(--muted)", fontSize: "11px" }}>24h Vol</p>
          <p style={{ margin: 0, color: "var(--text)" }}>{v.volumeUsd != null ? usd(v.volumeUsd) : "—"}</p>
        </div>
      </div>

      {!isQualified && v.v2StructuralStatus === "INSUFFICIENT_DATA" && (
        <div style={{ fontSize: "12px", color: "var(--muted)" }}>
          More data required
        </div>
      )}

      {v.v2MissingFields && v.v2MissingFields.length > 0 && (
        <div style={{ fontSize: "12px", color: "var(--caution)" }}>
          {v.v2MissingFields[0]}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px", borderTop: "1px solid var(--border)", fontSize: "12px" }}>
        <span style={{ color: "var(--muted)" }}>{formatRelativeTime(v.discoveredAt)}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.open(dexUrl(v.mint, v.pool), "_blank");
          }}
          style={{ color: "var(--go)", textDecoration: "none", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
        >
          chart ↗
        </button>
      </div>
    </Link>
  );
}

export function RadarLive({ initial }: { initial: BoardView }) {
  const [board, setBoard] = useState<BoardView>(initial);
  const [bandId, setBandId] = useState<string>("all");
  const [now, setNow] = useState<number>(() => Date.parse(initial.generatedAt) || 0);

  useEffect(() => {
    const saved = window.localStorage.getItem("aureus:mcapBand");
    if (saved) setBandId(saved);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      setNow(Date.now());
      // Auto-refresh the board every 5 seconds
      try {
        const res = await fetch('/api/board');
        const updated = await res.json();
        setBoard(updated);
      } catch (err) {
        console.error('Auto-refresh failed:', err);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Get all candidates sorted by qualification status
  const sorted = useMemo(() => {
    const allCandidates = [
      ...(board.sections.ENTRY_READY ?? []),
      ...(board.sections.ENTRY_APPROACHING ?? []),
      ...(board.sections.PRIMARY_WATCH ?? []),
      ...(board.sections.SETUP_FORMING ?? []),
      ...(board.sections.ASSESSING ?? []),
      ...(board.sections.DISCOVERED ?? []),
    ];

    // Sort: ALL QUALIFIED first (structurally qualified coins), then by confidence score
    const result = allCandidates.sort((a, b) => {
      const aQualified = a.v2StructuralStatus === "STRUCTURALLY_QUALIFIED" ? 1 : 0;
      const bQualified = b.v2StructuralStatus === "STRUCTURALLY_QUALIFIED" ? 1 : 0;

      // All structurally qualified coins first
      if (aQualified !== bQualified) return bQualified - aQualified;
      return (b.v2StructuralConfidence ?? 0) - (a.v2StructuralConfidence ?? 0);
    });

    return result;
  }, [board.sections]);

  const filtered =
    bandId === "all"
      ? sorted
      : sorted.filter(
          (c) =>
            c.marketCapUsd != null &&
            c.marketCapUsd >= (bandId === "large" ? 50_000 : 5_000) &&
            c.marketCapUsd <= (bandId === "large" ? 150_000 : 50_000)
        );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Radar</h1>
          <p className="page-sub">Phase 1 structural qualification scan</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", margin: "16px 0", flexWrap: "wrap" }}>
        {(["all", "small", "large"] as const).map((b) => (
          <button
            key={b}
            className="pill"
            onClick={() => {
              setBandId(b);
              window.localStorage.setItem("aureus:mcapBand", b);
            }}
            style={{
              opacity: bandId === b ? 1 : 0.5,
              cursor: "pointer",
            }}
          >
            {b === "all" ? "All" : b === "small" ? "5k-50k" : "50k-150k"}
          </button>
        ))}
      </div>

      <div className="rest-rows">
        {filtered.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>No candidates in this band</div>
        ) : (
          filtered.map((v) => <CandidateCard key={v.id} v={v} />)
        )}
      </div>
    </div>
  );
}
