"use client";

import { useState, useEffect, useMemo } from "react";
import { useFetch } from "@/hooks/useFetch";
import { ErrorBoundary } from "@/components/ErrorBoundary";

interface Coin {
  symbol: string;
  mint: string;
  stealthScore?: number;
  score?: number;
  dangerScore?: number;
  buyRatio?: number;
  holderTop10?: number;
  volumeVelocity?: number;
  minutesOld?: number;
  market_cap_usd?: number;
}

export default function CommandCenter() {
  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, { entryMcap: number; entryTime: number }>>({});
  const [alertSetup, setAlertSetup] = useState<{ show: boolean; coin: Coin | null; webhookUrl: string }>({
    show: false,
    coin: null,
    webhookUrl: ""
  });
  const { data, loading, error } = useFetch("/api/early-coins?limit=100");

  const coins = data?.candidates || [];
  const topCoins = coins.slice(0, 20);

  // Load watchlist & entries from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("aureus:watchlist");
    const savedEntries = localStorage.getItem("aureus:entries");
    if (saved) setWatchlist(JSON.parse(saved));
    if (savedEntries) setEntries(JSON.parse(savedEntries));
  }, []);

  // Save watchlist to localStorage
  useEffect(() => {
    localStorage.setItem("aureus:watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  // Save entries to localStorage
  useEffect(() => {
    localStorage.setItem("aureus:entries", JSON.stringify(entries));
  }, [entries]);

  const toggleWatchlist = (mint: string) => {
    setWatchlist(prev =>
      prev.includes(mint) ? prev.filter(m => m !== mint) : [...prev, mint]
    );
  };

  const recordEntry = (coin: Coin) => {
    setEntries(prev => ({
      ...prev,
      [coin.mint]: { entryMcap: coin.market_cap_usd || 0, entryTime: Date.now() }
    }));
  };

  const getProfit = (coin: Coin) => {
    const entry = entries[coin.mint];
    if (!entry) return null;
    const currentMcap = coin.market_cap_usd || 0;
    const roi = ((currentMcap - entry.entryMcap) / entry.entryMcap * 100).toFixed(1);
    const multiple = (currentMcap / entry.entryMcap).toFixed(2);
    return { roi, multiple, entryMcap: entry.entryMcap };
  };

  const getStatus = (coin: Coin) => {
    if ((coin.dangerScore || 0) > 40) return { emoji: "🔴", text: "RISKY", color: "#ff3b30" };
    if ((coin.minutesOld || 0) / (60 * 24) < 3) return { emoji: "⏳", text: "TOO EARLY", color: "#30b0c0" };
    return { emoji: "🟢", text: "READY", color: "#34c759" };
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0d", color: "#fff", fontFamily: "monospace", display: "flex", flexDirection: "column" }}>
      {/* HEADER */}
      <div style={{ background: "#0f1116", borderBottom: "1px solid #2a2a2f", padding: "16px 20px" }}>
        <h1 style={{ margin: "0", fontSize: "18px" }}>📡 AUREUS COMMAND CENTER</h1>
        <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Bloomberg Terminal for moonshots</div>
      </div>

      {/* MAIN */}
      <div style={{ display: "flex", flex: 1 }}>
        {/* LEFT: LIST */}
        <div style={{ flex: "0 0 35%", borderRight: "1px solid #2a2a2f", overflow: "auto", padding: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: "bold", marginBottom: "12px" }}>TOP CANDIDATES ({topCoins.length})</div>
          {topCoins.map((coin, idx) => {
            const status = getStatus(coin);
            const isWatched = watchlist.includes(coin.mint);
            const profit = getProfit(coin);
            return (
              <div key={coin.mint} onClick={() => setSelectedCoin(coin)} style={{
                background: selectedCoin?.mint === coin.mint ? "#1a1a1f" : isWatched ? "rgba(52, 199, 89, 0.1)" : "transparent",
                border: `1px solid ${selectedCoin?.mint === coin.mint ? "#34c759" : isWatched ? "#34c759" : "#2a2a2f"}`,
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "8px",
                cursor: "pointer",
                opacity: selectedCoin?.mint === coin.mint ? 1 : isWatched ? 0.9 : 0.7
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: "bold" }}>
                  <span>#{idx + 1} {coin.symbol} {isWatched && "★"}</span>
                  <span style={{ color: status.color }}>{status.emoji}</span>
                </div>
                <div style={{ fontSize: "10px", color: "#8a8a8e", marginTop: "4px" }}>
                  {((coin.minutesOld || 0) / (60 * 24)).toFixed(1)}d • {coin.score}/150 • {((coin.buyRatio || 0) * 100).toFixed(0)}%
                </div>
                {profit && (
                  <div style={{ fontSize: "9px", color: profit.roi.startsWith("-") ? "#ff3b30" : "#34c759", marginTop: "4px", fontWeight: "bold" }}>
                    P&L: {profit.roi}% ({profit.multiple}x)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* RIGHT: DETAIL */}
        <div style={{ flex: 1, padding: "20px", overflow: "auto" }}>
          {selectedCoin ? (
            <>
              <div style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>
                {selectedCoin.symbol}
                <span style={{ fontSize: "14px", marginLeft: "12px", color: getStatus(selectedCoin).color }}>
                  {getStatus(selectedCoin).emoji} {getStatus(selectedCoin).text}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                {[
                  { label: "QUALITY", value: `${selectedCoin.score}/150`, color: "#34c759" },
                  { label: "VELOCITY", value: `${Math.round(selectedCoin.stealthScore || 0)}/155`, color: "#30b0c0" },
                  { label: "DANGER", value: `${Math.round(selectedCoin.dangerScore || 0)}/100`, color: selectedCoin.dangerScore! > 40 ? "#ff3b30" : "#34c759" },
                  { label: "MCAP", value: `$${((selectedCoin.market_cap_usd || 0) / 1000).toFixed(0)}k`, color: "#fff" }
                ].map((m) => (
                  <div key={m.label} style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#8a8a8e" }}>{m.label}</div>
                    <div style={{ fontSize: "16px", fontWeight: "bold", color: m.color, marginTop: "4px" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>EXIT TARGETS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {[2, 5, 10].map((x) => (
                    <div key={x} style={{ background: "#1a1a1f", padding: "8px", borderRadius: "4px", textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: "#8a8a8e" }}>{x}x</div>
                      <div style={{ fontSize: "13px", fontWeight: "bold", color: "#34c759" }}>
                        ${(((selectedCoin.market_cap_usd || 0) * x) / 1000).toFixed(0)}k
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {(() => {
                const profit = getProfit(selectedCoin);
                return (
                  <>
                    {profit && (
                      <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", marginBottom: "16px", border: "1px solid #2a2a2f" }}>
                        <div style={{ fontSize: "10px", color: "#8a8a8e" }}>YOUR ENTRY</div>
                        <div style={{ fontSize: "12px", fontWeight: "bold", color: "#34c759", marginTop: "4px" }}>
                          Entry: ${(profit.entryMcap / 1000).toFixed(0)}k | ROI: {profit.roi}% | {profit.multiple}x
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      <button onClick={() => window.open(`https://dexscreener.com/solana/${selectedCoin.mint}`)}
                        style={{ flex: 1, padding: "10px", background: "#34c759", color: "#000", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        📊 DexScreener
                      </button>
                      <button onClick={() => setAlertSetup({ show: true, coin: selectedCoin, webhookUrl: "" })}
                        style={{ flex: 1, padding: "10px", background: "#1a1a1f", color: "#30b0c0", border: "1px solid #30b0c0", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        🔔 Alert
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => toggleWatchlist(selectedCoin.mint)}
                        style={{ flex: 1, padding: "10px", background: watchlist.includes(selectedCoin.mint) ? "#34c759" : "#1a1a1f", color: watchlist.includes(selectedCoin.mint) ? "#000" : "#fff", border: watchlist.includes(selectedCoin.mint) ? "none" : "1px solid #2a2a2f", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        💾 {watchlist.includes(selectedCoin.mint) ? "Saved" : "Watchlist"}
                      </button>
                      <button onClick={() => recordEntry(selectedCoin)}
                        style={{ flex: 1, padding: "10px", background: "#1a1a1f", color: profit ? "#34c759" : "#8a8a8e", border: profit ? "1px solid #34c759" : "1px solid #2a2a2f", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        ✍️ {profit ? "Update Entry" : "Track Entry"}
                      </button>
                    </div>
                  </>
                );
              })()}

              {alertSetup.show && alertSetup.coin && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                  <div style={{ background: "#0f1116", border: "1px solid #2a2a2f", borderRadius: "8px", padding: "20px", maxWidth: "400px", width: "90%" }}>
                    <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "12px" }}>
                      🔔 Set Alert for {alertSetup.coin.symbol}
                    </div>
                    <div style={{ fontSize: "11px", color: "#8a8a8e", marginBottom: "12px" }}>
                      When this coin reaches 🟢 READY status or hits your target, we'll send a notification.
                    </div>
                    <input type="text" placeholder="Telegram Bot Token (optional)" value={alertSetup.webhookUrl}
                      onChange={(e) => setAlertSetup({ ...alertSetup, webhookUrl: e.target.value })}
                      style={{ width: "100%", padding: "8px", background: "#1a1a1f", border: "1px solid #2a2a2f", borderRadius: "4px", color: "#fff", marginBottom: "12px", fontFamily: "monospace", fontSize: "11px" }} />
                    <div style={{ fontSize: "10px", color: "#8a8a8e", marginBottom: "12px" }}>
                      💡 Tip: Get a token from <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{ color: "#30b0c0" }}>@BotFather</a> on Telegram
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={async () => {
                        if (alertSetup.webhookUrl) {
                          localStorage.setItem(`aureus:alert:${alertSetup.coin!.mint}`, alertSetup.webhookUrl);

                          // Send test alert
                          try {
                            await fetch("/api/send-alert", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                mint: alertSetup.coin!.mint,
                                symbol: alertSetup.coin!.symbol,
                                status: getStatus(alertSetup.coin!),
                                quality: alertSetup.coin!.score || 0,
                                velocity: alertSetup.coin!.stealthScore || 0,
                                danger: alertSetup.coin!.dangerScore || 0,
                                mcap: alertSetup.coin!.market_cap_usd || 0,
                                target2x: ((alertSetup.coin!.market_cap_usd || 0) * 2),
                                target5x: ((alertSetup.coin!.market_cap_usd || 0) * 5),
                                target10x: ((alertSetup.coin!.market_cap_usd || 0) * 10),
                                telegramBotToken: alertSetup.webhookUrl
                              })
                            });
                          } catch (err) {
                            console.error("Failed to send alert:", err);
                          }
                        }
                        setAlertSetup({ show: false, coin: null, webhookUrl: "" });
                      }}
                        style={{ flex: 1, padding: "10px", background: "#34c759", color: "#000", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        ✓ Save
                      </button>
                      <button onClick={() => setAlertSetup({ show: false, coin: null, webhookUrl: "" })}
                        style={{ flex: 1, padding: "10px", background: "#1a1a1f", color: "#fff", border: "1px solid #2a2a2f", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "12px" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "#8a8a8e", textAlign: "center", marginTop: "40px" }}>
              ← Click a coin to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
