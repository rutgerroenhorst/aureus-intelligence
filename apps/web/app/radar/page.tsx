"use client";
import { useEffect, useState } from "react";
import ElitePageWrapper from "@/components/ElitePageWrapper";

interface Candidate {
  id: string;
  symbol: string | null;
  mint: string;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  discovered_at: string;
}

type Tab = "cate" | "signals" | "positions" | "trends" | "momentum" | "performance" | "elite-s" | "early" | "entry" | "qualified" | "stats";

export default function RadarPageElite() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eliteCandidates, setEliteCandidates] = useState<any[]>([]);
  const [ultraEarlyCandidates, setUltraEarlyCandidates] = useState<any[]>([]);
  const [ultraEarlyMomentum, setUltraEarlyMomentum] = useState<any[]>([]);
  const [incubationCandidates, setIncubationCandidates] = useState<any[]>([]);
  const [cateCoins, setCateCoins] = useState<any[]>([]);
  const [cateSummary, setCateSummary] = useState<any>(null);
  const [buySignals, setBuySignals] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [momentum, setMomentum] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("cate");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scrollPositions, setScrollPositions] = useState<{[key in Tab]: number}>({
    cate: 0, signals: 0, positions: 0, trends: 0, momentum: 0, performance: 0,
    "elite-s": 0, early: 0, entry: 0, qualified: 0, stats: 0
  });

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setIsRefreshing(true);
        const [candRes, eliteRes, ultRes, ultMomRes, incRes, cateRes, signalsRes, posRes, trendsRes, momRes, perfRes, netRes] = await Promise.all([
          fetch("/api/candidates"),
          fetch("/api/elite-validator"),
          fetch("/api/ultra-early"),
          fetch("/api/ultra-early-momentum"),
          fetch("/api/incubation"),
          fetch("/api/cate-hunter"),
          fetch("/api/signals"),
          fetch("/api/positions"),
          fetch("/api/trends"),
          fetch("/api/momentum"),
          fetch("/api/performance"),
          fetch("/api/network-sentiment"),
        ]);

        if (candRes.ok) setCandidates(await candRes.json().then(d => d.candidates || []));
        if (eliteRes.ok) setEliteCandidates(await eliteRes.json().then(d => d.candidates || []));
        if (ultRes.ok) setUltraEarlyCandidates(await ultRes.json().then(d => d.candidates || []));
        if (ultMomRes.ok) setUltraEarlyMomentum(await ultMomRes.json().then(d => d.candidates || []));
        if (incRes.ok) setIncubationCandidates(await incRes.json().then(d => d.candidates || []));
        if (cateRes.ok) {
          const cateData = await cateRes.json();
          setCateCoins(cateData.cateCoins || []);
          setCateSummary(cateData.summary || null);
        }
        if (signalsRes.ok) {
          const sig = await signalsRes.json();
          setBuySignals(sig.buy_signals || []);
        }
        if (posRes.ok) setPositions(await posRes.json().then(d => d.positions || []));
        if (trendsRes.ok) setTrends(await trendsRes.json().then(d => d.candidates || []));
        if (momRes.ok) setMomentum(await momRes.json().then(d => d.candidates || []));
        if (perfRes.ok) setPerformance(await perfRes.json().then(d => d.metrics || {}));
        if (netRes.ok) setNetworks(await netRes.json().then(d => d.networks || []));

        setLastUpdate(new Date());
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setIsRefreshing(false);
      }
    };

    fetchAll();
    const poll = setInterval(fetchAll, 10_000);
    return () => clearInterval(poll);
  }, []);

  const TabButton = ({ tab, label, count }: { tab: Tab; label: string; count?: number }) => (
    <button
      onClick={() => {
        const contentDiv = document.querySelector('[data-tab-content]');
        if (contentDiv) {
          setScrollPositions(prev => ({ ...prev, [activeTab]: contentDiv.scrollTop }));
        }
        setActiveTab(tab);
        setTimeout(() => {
          const newContentDiv = document.querySelector('[data-tab-content]');
          if (newContentDiv) {
            newContentDiv.scrollTop = scrollPositions[tab] || 0;
          }
        }, 0);
      }}
      style={{
        padding: "8px 16px",
        background: activeTab === tab ? "#34c759" : "#1a1a1f",
        color: activeTab === tab ? "#000" : "#8a8a8e",
        border: `1px solid ${activeTab === tab ? "#34c759" : "#2a2a2f"}`,
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: 700,
      }}
    >
      {label} {count !== undefined && <span style={{ opacity: 0.8 }}>({count})</span>}
    </button>
  );

  const CoinRow = ({ c, color, score, isBuySignal }: { c: any; color: string; score?: number; isBuySignal?: boolean }) => {
    const mcap = Number(c.market_cap_usd || c.marketCapUsd || 0);
    const conf = Number(c.confidence || c.buy_ratio || c.cateScore || c.buy_score || 0);
    const minutesOld = c.minutesOld || Math.floor((Date.now() - new Date(c.discovered_at).getTime()) / (1000 * 60));
    
    const riskBadge = c.risk || "🟡";
    const riskLevel = c.riskLevel || "MEDIUM";
    const momentum = c.momentum || "";
    const actionWindow = c.actionWindow || "";
    const slippage = c.slippage || "";
    
    const timeLabel = minutesOld < 1 ? "🔥 <1m" : minutesOld < 5 ? "⚡ <5m" : minutesOld < 30 ? "🟠 <30m" : `📊 ${minutesOld}m`;

    return (
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
            <span style={{ fontSize: "11px", opacity: 0.7 }}>{riskBadge} {riskLevel} {momentum && `• ${momentum}`}</span>
          </div>
          <div style={{ fontSize: "10px", color, marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span>{timeLabel}</span>
            <span>{(c.minutesOld || 0).toFixed(0)}m •</span>
            <span>{conf.toFixed(0)}% {c.tier || c.strength || c.phase || c.strength || ""}</span>
          </div>
          {isBuySignal && (
            <div style={{ fontSize: "10px", marginTop: "6px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ color: "#ff9500", fontWeight: 600 }}>{actionWindow}</span>
              <span style={{ color: "#8a8a8e" }}>•</span>
              <span style={{ color: "#8a8a8e" }}>{slippage}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {score && <span style={{ fontSize: "11px", color: "#fff", fontWeight: 700 }}>{Math.round(score)}</span>}
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
        </div>
      </div>
    );
  };

  const renderCATECoins = () => {
    const elite = cateCoins.filter(c => c.tier === "🚀 ELITE");
    const hot = cateCoins.filter(c => c.tier === "🔥 HOT");
    const rising = cateCoins.filter(c => c.tier === "⚡ RISING");
    const watch = cateCoins.filter(c => c.tier === "📊 WATCH");

    return (
      <div style={{ padding: "16px" }}>
        {cateSummary && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px",
            marginBottom: "24px",
            fontSize: "12px"
          }}>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#34c759", fontWeight: 700, fontSize: "16px" }}>{cateSummary.elite || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>🚀 Elite</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#ff9500", fontWeight: 700, fontSize: "16px" }}>{cateSummary.hot || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>🔥 Hot</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#30b0c0", fontWeight: 700, fontSize: "16px" }}>{cateSummary.rising || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>⚡ Rising</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#8a8a8e", fontWeight: 700, fontSize: "16px" }}>{cateSummary.watch || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>📊 Watch</div>
            </div>
          </div>
        )}

        {elite.length > 0 && (
          <>
            <h3 style={{ color: "#34c759", marginBottom: "12px" }}>🚀 ELITE ({elite.length})</h3>
            {elite.map((c, i) => <CoinRow key={`elite-${i}`} c={c} color="#34c759" score={c.cateScore} />)}
          </>
        )}

        {hot.length > 0 && (
          <>
            <h3 style={{ color: "#ff9500", marginBottom: "12px", marginTop: "16px" }}>🔥 HOT ({hot.length})</h3>
            {hot.map((c, i) => <CoinRow key={`hot-${i}`} c={c} color="#ff9500" score={c.cateScore} />)}
          </>
        )}

        {rising.length > 0 && (
          <>
            <h3 style={{ color: "#30b0c0", marginBottom: "12px", marginTop: "16px" }}>⚡ RISING ({rising.length})</h3>
            {rising.map((c, i) => <CoinRow key={`rising-${i}`} c={c} color="#30b0c0" score={c.cateScore} />)}
          </>
        )}

        {watch.length > 0 && (
          <>
            <h3 style={{ color: "#8a8a8e", marginBottom: "12px", marginTop: "16px" }}>📊 WATCH ({watch.length})</h3>
            {watch.map((c, i) => <CoinRow key={`watch-${i}`} c={c} color="#8a8a8e" score={c.cateScore} />)}
          </>
        )}

        {cateCoins.length === 0 && (
          <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
            No CATE signals yet...
          </div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "cate":
        return renderCATECoins();
      case "signals":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#34c759", marginBottom: "16px" }}>🎯 Buy Signals - Entry Opportunities ({buySignals.length})</h3>
            {buySignals.length > 0 ? (
              buySignals.map((c, i) => <CoinRow key={`buy-${i}`} c={c} color="#34c759" isBuySignal={true} />)
            ) : (
              <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
                No viable buy signals right now. Check back soon! 🔄
              </div>
            )}
          </div>
        );
      case "early":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#ff9500", marginBottom: "16px" }}>🚀 Ultra Early Momentum ({ultraEarlyMomentum.length})</h3>
            {ultraEarlyMomentum.length > 0 ? (
              ultraEarlyMomentum.map((c, i) => (
                <div
                  key={i}
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
                    {c.reasons.map((r: string, j: number) => (
                      <span key={j}>{r}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: "8px" }}>
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
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
                No ultra-early momentum signals yet. Waiting for net launches... 🚀
              </div>
            )}
          </div>
        );
      case "elite-s":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#34c759", marginBottom: "16px" }}>Elite ({eliteCandidates.length})</h3>
            {eliteCandidates.map((c, i) => <CoinRow key={i} c={c} color="#34c759" />)}
          </div>
        );
      case "qualified":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#5ac8fa", marginBottom: "16px" }}>Incubation ({incubationCandidates.length})</h3>
            {incubationCandidates.map((c, i) => <CoinRow key={i} c={c} color="#5ac8fa" />)}
          </div>
        );
      case "stats":
        return (
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Total Candidates</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginTop: "8px" }}>{candidates.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>CATE Coins</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#34c759", marginTop: "8px" }}>{cateCoins.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Buy Signals</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#34c759", marginTop: "8px" }}>{buySignals.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Ultra Early</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#ff9500", marginTop: "8px" }}>{ultraEarlyCandidates.length}</div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <ElitePageWrapper>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "16px", color: "#fff" }}>
            📊 Aureus Radar
          </h1>
          
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            <TabButton tab="cate" label="🎯 CATE" count={cateCoins.length} />
            <TabButton tab="signals" label="💰 Buy Signals" count={buySignals.length} />
            <TabButton tab="early" label="🚀 Ultra Momentum" count={ultraEarlyMomentum.length} />
            <TabButton tab="elite-s" label="⭐ Elite" count={eliteCandidates.length} />
            <TabButton tab="qualified" label="💼 Incubation" count={incubationCandidates.length} />
            <TabButton tab="stats" label="📋 Stats" />
          </div>

          <div style={{ fontSize: "12px", color: "#8a8a8e" }}>
            {isRefreshing ? "🔄 Refreshing..." : "✓ Live"}
          </div>
        </div>

        <div data-tab-content style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
          {renderContent()}
        </div>
      </div>
    </ElitePageWrapper>
  );
}
