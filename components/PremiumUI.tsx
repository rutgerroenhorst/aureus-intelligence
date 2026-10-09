"use client";
import React, { ReactNode } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   PREMIUM UI COMPONENT LIBRARY — Aureus Intelligence Terminal Design System
   ═══════════════════════════════════════════════════════════════════════════ */

// ============ KPI CARD — Premium Metric Display with Layered Background ============
export const KPICard = ({
  label,
  value,
  subtext,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
  icon?: ReactNode;
}) => (
  <div
    style={{
      padding: "20px",
      background: "linear-gradient(180deg, var(--bg-interactive) 0%, var(--bg-raised) 100%)",
      border: "1px solid var(--border-color)",
      borderRadius: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      transition: "all 160ms ease",
      cursor: "default",
      position: "relative",
      overflow: "hidden",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color-highlight)";
      (e.currentTarget as HTMLElement).style.background = "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-interactive) 100%)";
      (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(37, 133, 255, 0.08)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
      (e.currentTarget as HTMLElement).style.background = "linear-gradient(180deg, var(--bg-interactive) 0%, var(--bg-raised) 100%)";
      (e.currentTarget as HTMLElement).style.boxShadow = "none";
    }}
  >
    {icon && <div style={{ fontSize: "20px", opacity: 0.95 }}>{icon}</div>}
    <div
      style={{
        fontSize: "10px",
        fontWeight: 700,
        textTransform: "uppercase",
        color: "var(--text-muted)",
        letterSpacing: "0.7px",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: "32px",
        fontWeight: 800,
        color: color || "var(--text-primary)",
        fontFamily: "ui-monospace, monospace",
        lineHeight: 1,
        letterSpacing: "-0.8px",
      }}
    >
      {value}
    </div>
    {subtext && (
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          lineHeight: 1.4,
        }}
      >
        {subtext}
      </div>
    )}
  </div>
);

// ============ BADGE — Semantic Color System with Enhanced Depth ============
export const Badge = ({
  label,
  variant = "default",
}: {
  label: string;
  variant?:
    | "default"
    | "emerald"
    | "amber"
    | "coral"
    | "violet"
    | "blue";
}) => {
  const variantConfig: Record<string, { bg: string; text: string; border: string; glow?: string }> = {
    default: {
      bg: "rgba(104, 131, 163, 0.12)",
      text: "var(--text-muted)",
      border: "rgba(104, 131, 163, 0.24)",
    },
    emerald: {
      bg: "rgba(32, 231, 163, 0.12)",
      text: "var(--emerald)",
      border: "rgba(32, 231, 163, 0.28)",
      glow: "rgba(32, 231, 163, 0.15)",
    },
    amber: {
      bg: "rgba(255, 181, 47, 0.12)",
      text: "var(--amber-warn)",
      border: "rgba(255, 181, 47, 0.24)",
      glow: "rgba(255, 181, 47, 0.12)",
    },
    coral: {
      bg: "rgba(255, 82, 104, 0.12)",
      text: "var(--coral-danger)",
      border: "rgba(255, 82, 104, 0.28)",
      glow: "rgba(255, 82, 104, 0.15)",
    },
    violet: {
      bg: "rgba(134, 108, 255, 0.12)",
      text: "var(--violet)",
      border: "rgba(134, 108, 255, 0.28)",
      glow: "rgba(134, 108, 255, 0.12)",
    },
    blue: {
      bg: "rgba(37, 133, 255, 0.12)",
      text: "var(--blue-electric)",
      border: "rgba(37, 133, 255, 0.28)",
      glow: "rgba(37, 133, 255, 0.15)",
    },
  };

  const config = variantConfig[variant];

  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: "8px",
        background: config.bg,
        color: config.text,
        fontSize: "10px",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        border: `1px solid ${config.border}`,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        boxShadow: config.glow ? `0 0 12px ${config.glow}` : "none",
        transition: "all 120ms ease",
      }}
    >
      {label}
    </span>
  );
};

// ============ SEGMENTED CONTROL — Premium Filter Toggle with Inner Glow ============
export const SegmentedControl = ({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) => (
  <div
    style={{
      display: "flex",
      gap: "4px",
      padding: "5px",
      background: "var(--bg-raised)",
      border: "1px solid var(--border-color)",
      borderRadius: "10px",
    }}
  >
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        style={{
          padding: "9px 14px",
          borderRadius: "8px",
          border: value === opt.value ? "1px solid rgba(37, 133, 255, 0.35)" : "none",
          background: value === opt.value ? "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-interactive) 100%)" : "transparent",
          color:
            value === opt.value ? "var(--blue-electric)" : "var(--text-muted)",
          fontSize: "12px",
          fontWeight: value === opt.value ? 700 : 500,
          cursor: "pointer",
          transition: "all 140ms ease",
          boxShadow: value === opt.value ? "0 0 16px rgba(37, 133, 255, 0.15)" : "none",
        }}
        onMouseEnter={(e) => {
          if (value !== opt.value) {
            (e.target as HTMLButtonElement).style.color =
              "var(--text-secondary)";
            (e.target as HTMLButtonElement).style.background = "rgba(37, 133, 255, 0.04)";
          }
        }}
        onMouseLeave={(e) => {
          if (value !== opt.value) {
            (e.target as HTMLButtonElement).style.color = "var(--text-muted)";
            (e.target as HTMLButtonElement).style.background = "transparent";
          }
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// ============ PAGE HEADER — Section Title with Eyebrow ============
export const PageHeader = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) => (
  <div style={{ marginBottom: "28px" }}>
    <div
      style={{
        fontSize: "10px",
        fontWeight: 700,
        textTransform: "uppercase",
        color: "var(--blue-electric)",
        letterSpacing: "1.2px",
        marginBottom: "10px",
      }}
    >
      Aureus Intelligence
    </div>
    <h1
      style={{
        fontSize: "38px",
        fontWeight: 800,
        margin: 0,
        marginBottom: "12px",
        color: "var(--text-primary)",
        letterSpacing: "-1px",
      }}
    >
      {title}
    </h1>
    <p
      style={{
        fontSize: "15px",
        color: "var(--text-secondary)",
        margin: 0,
        lineHeight: 1.7,
        maxWidth: "72ch",
      }}
    >
      {subtitle}
    </p>
  </div>
);

// ============ EMPTY STATE — No Data Messaging with Terminal Aesthetic ============
export const EmptyState = ({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
}) => (
  <div
    style={{
      textAlign: "center",
      padding: "100px 60px",
      color: "var(--text-muted)",
      background: "linear-gradient(135deg, rgba(37, 133, 255, 0.03) 0%, rgba(53, 220, 255, 0.02) 100%)",
      borderRadius: "14px",
      border: "1px solid var(--border-color)",
    }}
  >
    {icon && (
      <div
        style={{
          fontSize: "64px",
          marginBottom: "24px",
          opacity: 0.75,
        }}
      >
        {icon}
      </div>
    )}
    <h2
      style={{
        fontSize: "20px",
        fontWeight: 700,
        marginBottom: "12px",
        color: "var(--text-secondary)",
      }}
    >
      {title}
    </h2>
    <p style={{ fontSize: "14px", lineHeight: 1.6, maxWidth: "520px", margin: "0 auto", color: "var(--text-muted)" }}>
      {description}
    </p>
  </div>
);

// ============ STATUS BADGE — Candidate/Token Status ============
export const StatusBadge = ({
  status,
}: {
  status: "STRUCTURALLY_QUALIFIED" | "INSUFFICIENT_DATA" | "FATAL_REJECT" | "UNKNOWN";
}) => {
  const statusConfig: Record<
    string,
    { label: string; variant: "emerald" | "amber" | "coral" | "default" }
  > = {
    STRUCTURALLY_QUALIFIED: { label: "Qualified", variant: "emerald" },
    INSUFFICIENT_DATA: { label: "Waiting", variant: "amber" },
    FATAL_REJECT: { label: "Rejected", variant: "coral" },
    UNKNOWN: { label: "Unknown", variant: "default" },
  };

  const config = statusConfig[status] || statusConfig.UNKNOWN;
  return <Badge label={config.label} variant={config.variant} />;
};
