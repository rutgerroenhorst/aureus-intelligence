"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";

/**
 * The coin's name on a card. On Solana it opens the coin's dossier (/coin/<mint>: the chart, what the lab saw, the checks);
 * the other networks have no dossier yet, so there it is plain text.
 */
export function CoinName({ mint, chain, children, size = 15 }: { mint: string; chain?: string; children: ReactNode; size?: number }) {
  const style = { color: "#fff", fontSize: size, fontWeight: 700 } as const;
  if (!mint || (chain && chain !== "solana")) return <b style={style}>{children}</b>;
  return (
    <Link href={`/coin/${mint}`} className="coin-name" style={{ ...style, textDecoration: "none" }} title="Open this coin's dossier">
      {children}
    </Link>
  );
}

/**
 * A tab's heading with its explanation behind a small "i": the paragraph under every heading pushed the first coin down by a third of a phone screen.
 * `aside` is the one fact that should stay visible (when the list was last updated).
 */
export function TabIntro({ title, color, aside, children }: { title: ReactNode; color: string; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ color, margin: 0 }}>{title}</h3>
        <button type="button" className="info-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="About this tab">
          i
        </button>
        {aside && <span style={{ fontSize: 11, color: "#8a8a8e" }}>{aside}</span>}
      </div>
      {open && <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 6, lineHeight: 1.5 }}>{children}</div>}
    </div>
  );
}

/** A small magnifier for the Check button (it was an emoji). */
export function IconSearch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
