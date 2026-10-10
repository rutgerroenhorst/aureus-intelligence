"use client";
import { useState } from "react";
import { usePolling } from "@/lib/usePolling";

interface Meta { name: string; slug: string; mcap: number | null; h24: number | null; h6: number | null }
interface Now {
  solUsd: number | null; sol24h: number | null; dex24h: number | null; dexChange1d: number | null; dexChange7d: number | null;
  pump24h: number | null; pumpChange1d: number | null; fng: number | null; fngLabel: string | null; metas: Meta[];
}

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;
};
const sgn = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null ? "#b4b4c6" : v >= 0 ? "#34c759" : "#ff453a");

/**
 * The market around the coins, in one line: is Solana trading heating up or cooling off, and which narratives are moving.
 * From the Learning Lab's hourly collection (DefiLlama, Jupiter, DexScreener, alternative.me); nothing here is a forecast.
 */
export function MarketStrip() {
  const [d, setD] = useState<{ at: number | null; now: Now | null; spark: number[] } | null>(null);
  usePolling(async () => {
    try {
      const res = await fetch("/api/regime", { cache: "no-store" });
      if (res.ok) setD(await res.json());
    } catch {
      /* keep the last one */
    }
  }, 300_000);
  const n = d?.now;
  if (!n) return null;
  const mood = n.dexChange1d != null && n.dexChange7d != null ? (n.dexChange1d < -15 && n.dexChange7d < -15 ? "cooling" : n.dexChange1d > 15 && n.dexChange7d > 15 ? "heating up" : "steady") : null;
  const hot = [...n.metas].filter((m) => (m.mcap ?? 0) > 5e6 && m.h24 != null).sort((a, b) => (b.h24 ?? 0) - (a.h24 ?? 0)).slice(0, 3);
  const item = (label: string, value: string, sub?: string, color?: string) => (
    <div style={{ minWidth: 120 }}>
      <div style={{ color: "#8a8a9e", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: color ?? "#ececf4", fontWeight: 700, fontSize: 14 }}>{value}</div>
      {sub && <div style={{ color: "#8a8a9e", fontSize: 11 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: "10px 14px", margin: "0 0 14px", display: "flex", flexWrap: "wrap", gap: "10px 22px", alignItems: "flex-start" }} title="Market backdrop from DefiLlama, Jupiter, DexScreener and alternative.me, refreshed about hourly by the Learning Lab. Context, not a forecast.">
      {item("Market now", mood ?? "-", "Solana trading", mood === "cooling" ? "#ff9f0a" : mood === "heating up" ? "#34c759" : undefined)}
      {item("SOL", n.solUsd != null ? `$${n.solUsd.toFixed(2)}` : "-", `${sgn(n.sol24h, 2)} in 24 h`, tone(n.sol24h))}
      {item("Solana DEX volume", usd(n.dex24h), `${sgn(n.dexChange1d, 0)} vs yesterday · ${sgn(n.dexChange7d, 0)} vs last week`, tone(n.dexChange1d))}
      {item("pump.fun volume", usd(n.pump24h), `${sgn(n.pumpChange1d, 0)} vs yesterday`, tone(n.pumpChange1d))}
      {item("Fear and greed", n.fng != null ? `${n.fng} ${n.fngLabel ?? ""}` : "-")}
      {hot.length > 0 && item("Narratives moving", hot.map((m) => m.name).join(" · "), hot.map((m) => sgn(m.h24, 1)).join(" · "), "#30b0c0")}
    </div>
  );
}
