"use client";
import { useState } from "react";
import { CheckBadge, CheckButton, CheckPanel, useCoinCheck, type CheckNote } from "./CoinCheck";

/**
 * One coin on the CATE, Buy Signals, Elite and Incubation tabs. A component of its own (not one defined inside the page): a component defined inside another
 * is a new component on every render, so the page's refresh every 30 seconds would throw away what a card remembers, such as the answer of a Check.
 */
export function CoinRow({ c, color, score, isBuySignal, tab, note }: { c: any; color: string; score?: number; isBuySignal?: boolean; tab: string | undefined; note?: CheckNote }) {
  const [entered, setEntered] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const check = useCoinCheck(c.mint, c.chain, tab, c.symbol);
  const conf = Number(c.confidence || c.buy_ratio || c.cateScore || c.buy_score || 0);
  const minutesOld = c.minutesOld || Math.floor((Date.now() - new Date(c.discovered_at).getTime()) / (1000 * 60));

  const riskBadge = c.risk || "🟡";
  const riskLevel = c.riskLevel || "MEDIUM";
  const momentum = c.momentum || "";
  const actionWindow = c.actionWindow || "";
  const slippage = c.slippage || "";

  const timeLabel = minutesOld < 1 ? "🔥 <1m" : minutesOld < 5 ? "⚡ <5m" : minutesOld < 30 ? "🟠 <30m" : `📊 ${minutesOld}m`;

  const markEntered = async () => {
    try {
      const entryMcap = Number(c.marketCapUsd || c.market_cap_usd || 50000);
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: c.symbol, mint: c.mint, entryMcap, tab: tab ?? null, action: "add-entry" }),
      });
      // Say so when it was NOT saved: a green "Entered" over a failed save is a false record.
      if (!res.ok) throw new Error(`my-trades ${res.status}`);
      setEntered(true);
      setTimeout(() => setEntered(false), 3000);
    } catch (err) {
      console.error("Entry track error:", err);
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 4000);
    }
  };

  return (
    <>
      <div
        style={{
          background: "#0f1116",
          border: `2px solid ${color}`,
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
            {c.symbol}
            <span style={{ fontSize: "11px", opacity: 0.7 }}>
              {riskBadge} {riskLevel} {momentum && `• ${momentum}`}
            </span>
          </div>
          <div style={{ fontSize: "10px", color, marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span>{timeLabel}</span>
            <span>{(c.minutesOld || 0).toFixed(0)}m •</span>
            <span>
              {conf.toFixed(0)}% {c.tier || c.strength || c.phase || c.strength || ""}
            </span>
          </div>
          {isBuySignal && (
            <div style={{ fontSize: "10px", marginTop: "6px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ color: "#ff9500", fontWeight: 600 }}>{actionWindow}</span>
              <span style={{ color: "#8a8a8e" }}>•</span>
              <span style={{ color: "#8a8a8e" }}>{slippage}</span>
            </div>
          )}
          <CheckBadge note={note} />
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {score && <span style={{ fontSize: "11px", color: "#fff", fontWeight: 700 }}>{Math.round(score)}</span>}
          <div style={{ display: "flex", gap: "6px", flexDirection: "column" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                markEntered();
              }}
              style={{
                padding: "4px 8px",
                background: entered ? "#34c759" : "#1a1a1f",
                color: entered ? "#000" : saveFailed ? "#ff9f0a" : "#34c759",
                border: `1px solid ${saveFailed ? "#ff9f0a" : "#34c759"}`,
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {entered ? "✅ Entered" : saveFailed ? "⚠ Not saved" : "✔ Enter"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(`https://dexscreener.com/solana/${c.mint}`, "_blank");
              }}
              style={{
                padding: "4px 8px",
                background: "#1a1a1f",
                color: "#34c759",
                border: "1px solid #34c759",
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              DexScreener
            </button>
            <CheckButton state={check} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(c.mint);
                alert(`Copied: ${c.mint}`);
              }}
              title={c.mint}
              style={{
                padding: "4px 8px",
                background: "#1a1a1f",
                color: "#8a8a8e",
                border: "1px solid #8a8a8e",
                borderRadius: "4px",
                fontSize: "9px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                maxWidth: "150px",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              📋 Copy Mint
            </button>
          </div>
        </div>
      </div>
      <CheckPanel state={check} />
    </>
  );
}

/** One coin on the Ultra Momentum tab: the same card as before, with the Check button added. */
export function UltraCard({ c, entered, onEnter, tab, note }: { c: any; entered: boolean; onEnter: () => void; tab: string | undefined; note?: CheckNote }) {
  const check = useCoinCheck(c.mint, c.chain, tab, c.symbol);
  return (
    <>
      <div
        style={{
          background: "#0f1116",
          border: "2px solid #ff9500",
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "8px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
          {c.symbol}
          <span style={{ fontSize: "11px", opacity: 0.7 }}>• {c.signal}</span>
        </div>
        <div style={{ fontSize: "10px", color: "#ff9500", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <span>🔥 {c.secondsOld}s old</span>
          <span>${Math.round(c.mcap).toLocaleString()}</span>
          <span>Score: {c.score}</span>
        </div>
        <div style={{ fontSize: "9px", color: "#8a8a8e", marginTop: "6px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {(c.reasons ?? []).map((r: string, j: number) => (
            <span key={j}>{r}</span>
          ))}
        </div>
        <CheckBadge note={note} />
        <div style={{ marginTop: "8px", display: "flex", gap: "6px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnter();
            }}
            style={{
              padding: "4px 8px",
              background: entered ? "#34c759" : "#1a1a1f",
              color: entered ? "#000" : "#34c759",
              border: "1px solid #34c759",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {entered ? "✅ Entered" : "✔ Enter"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://dexscreener.com/solana/${c.mint}`, "_blank");
            }}
            style={{
              padding: "4px 8px",
              background: "#1a1a1f",
              color: "#ff9500",
              border: "1px solid #ff9500",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            🔍 DexScreener
          </button>
          <CheckButton state={check} />
        </div>
      </div>
      <CheckPanel state={check} />
    </>
  );
}
