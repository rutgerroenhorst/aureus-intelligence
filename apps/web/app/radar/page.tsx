"use client";
import { useState } from "react";
import ElitePageWrapper from "@/components/ElitePageWrapper";
import { usePolling, useOnScanDone } from "@/lib/usePolling";
import { RunnersTab, type Runner, type RunnersLab, type RunnersPrior } from "./RunnersTab";
import { GraduatesTab, type Graduate, type GradMeta } from "./GraduatesTab";

interface Candidate {
  id: string;
  symbol: string | null;
  mint: string;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  discovered_at: string;
}

type Tab = "cate" | "signals" | "positions" | "trends" | "momentum" | "performance" | "elite-s" | "early" | "entry" | "qualified" | "stats" | "runners" | "graduates";

// The name the learning system and the trade journal use for each Radar tab.
const JOURNAL_TAB: Partial<Record<Tab, string>> = {
  cate: "cate",
  signals: "buy_signals",
  early: "ultra_momentum",
  "elite-s": "elite",
  qualified: "incubation",
  runners: "runners",
  graduates: "graduates",
};

export default function RadarPageElite() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eliteCandidates, setEliteCandidates] = useState<any[]>([]);
  const [ultraEarlyCandidates, setUltraEarlyCandidates] = useState<any[]>([]);
  const [ultraEarlyMomentum, setUltraEarlyMomentum] = useState<any[]>([]);
  const [incubationCandidates, setIncubationCandidates] = useState<any[]>([]);
  const [cateCoins, setCateCoins] = useState<any[]>([]);
  const [cateSummary, setCateSummary] = useState<any>(null);
  const [buySignals, setBuySignals] = useState<any[]>([]);
  const [graduates, setGraduates] = useState<Graduate[]>([]);
  const [gradMeta, setGradMeta] = useState<GradMeta | null>(null);
  const [gradLab, setGradLab] = useState<{ followed3d: number; held2: { p: number } } | null>(null);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [runnersLab, setRunnersLab] = useState<RunnersLab | null>(null);
  const [runnersPrior, setRunnersPrior] = useState<RunnersPrior | null>(null);
  const [failedEntries, setFailedEntries] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [momentum, setMomentum] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [safety, setSafety] = useState<{ total: number; safe: number; rejected: number; unverified: number; noData: number } | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("early");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scrollPositions, setScrollPositions] = useState<{[key in Tab]: number}>({
    cate: 0, signals: 0, positions: 0, trends: 0, momentum: 0, performance: 0,
    "elite-s": 0, early: 0, entry: 0, qualified: 0, stats: 0, runners: 0, graduates: 0
  });
  const [enteredCoins, setEnteredCoins] = useState<Set<string>>(new Set());

  // One request for everything (/api/radar-bundle), and only while the screen is visible.
  // A source that failed comes back as null: keep showing its previous data instead of blanking it.
  const fetchAll = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/radar-bundle", { cache: "no-store" });
      if (!res.ok) throw new Error(`radar-bundle ${res.status}`);
      const { data: d, failed } = await res.json();
      setFailedSources(Array.isArray(failed) ? failed : []);

      if (d.candidates) setCandidates(d.candidates.candidates || []);
      if (d.elite) setEliteCandidates(d.elite.candidates || []);
      if (d.ultraEarly) setUltraEarlyCandidates(d.ultraEarly.candidates || []);
      if (d.ultraEarlyMomentum) setUltraEarlyMomentum(d.ultraEarlyMomentum.candidates || []);
      if (d.incubation) setIncubationCandidates(d.incubation.candidates || []);
      if (d.cate) {
        setCateCoins(d.cate.cateCoins || []);
        setCateSummary(d.cate.summary || null);
      }
      if (d.signals) setBuySignals(d.signals.buy_signals || []);
      if (d.graduates) {
        setGraduates(d.graduates.candidates || []);
        setGradLab(d.graduates.lab || null);
        setGradMeta({ summary: d.graduates.summary || [], source: d.graduates.source, asOf: d.graduates.asOf });
      }
      if (d.runners) {
        setRunners(d.runners.candidates || []);
        setRunnersLab(d.runners.lab || null);
        setRunnersPrior(d.runners.prior || null);
      }
      if (d.positions) setPositions(d.positions.positions || []);
      if (d.trends) setTrends(d.trends.candidates || []);
      if (d.momentum) setMomentum(d.momentum.candidates || []);
      if (d.performance) setPerformance(d.performance.metrics || {});
      if (d.networks) setNetworks(d.networks.networks || []);
      setSafety(d.safety || null);

      setLastUpdate(new Date());
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  usePolling(fetchAll, 20_000);
  // A scan has just finished: show its coins now instead of at the next 20 s tick.
  useOnScanDone(() => void fetchAll());

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

  /** "I entered this" for the lanes beyond the Radar's door (Runners, Graduations): one record in the trade journal, with the tab it came from. */
  const enterCoin = async (c: { symbol: string | null; mint: string; mcap: number | null }, tabKey: "runners" | "graduates") => {
    try {
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: c.symbol, mint: c.mint, entryMcap: c.mcap, tab: JOURNAL_TAB[tabKey] ?? null, action: "add-entry" }),
      });
      if (!res.ok) throw new Error(`my-trades ${res.status}`);
      setEnteredCoins((prev) => new Set([...prev, c.mint]));
      setFailedEntries((prev) => { const n = new Set(prev); n.delete(c.mint); return n; });
    } catch (err) {
      console.error("Could not save the entry:", err);
      setFailedEntries((prev) => new Set([...prev, c.mint]));
    }
  };

  const CoinRow = ({ c, color, score, isBuySignal }: { c: any; color: string; score?: number; isBuySignal?: boolean }) => {
    const [entered, setEntered] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const mcap = Number(c.market_cap_usd || c.marketCapUsd || 0);
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
        const res = await fetch('/api/my-trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: c.symbol,
            mint: c.mint,
            entryMcap,
            tab: JOURNAL_TAB[activeTab] ?? null,
            action: 'add-entry'
          })
        });
        // Say so when it was NOT saved: a green "Entered" over a failed save is a false record.
        if (!res.ok) throw new Error(`my-trades ${res.status}`);
        setEntered(true);
        setTimeout(() => setEntered(false), 3000);
      } catch (err) {
        console.error('Entry track error:', err);
        setSaveFailed(true);
        setTimeout(() => setSaveFailed(false), 4000);
      }
    };

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
      case "graduates":
        return <GraduatesTab coins={graduates} lab={gradLab} meta={gradMeta} entered={enteredCoins} failedMints={failedEntries} onEnter={(c) => enterCoin(c, "graduates")} />;
      case "runners":
        return (
          <RunnersTab
            runners={runners}
            lab={runnersLab}
            prior={runnersPrior}
            entered={enteredCoins}
            failedMints={failedEntries}
            onEnter={(c) => enterCoin(c, "runners")}
          />
        );
      case "early":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#ff9500", marginBottom: "16px" }}>🚀 Ultra Early Momentum ({ultraEarlyMomentum.length})</h3>
            {ultraEarlyMomentum.length > 0 ? (
              ultraEarlyMomentum.map((c, i) => {
                const markEntered = async () => {
                  try {
                    const res = await fetch('/api/my-trades', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        symbol: c.symbol,
                        mint: c.mint,
                        entryMcap: c.mcap,
                        tab: JOURNAL_TAB[activeTab] ?? null,
                        action: 'add-entry'
                      })
                    });
                    if (!res.ok) throw new Error(`my-trades ${res.status}`);
                    setEnteredCoins(prev => new Set([...prev, c.mint]));
                    setTimeout(() => setEnteredCoins(prev => {
                      const next = new Set(prev);
                      next.delete(c.mint);
                      return next;
                    }), 3000);
                  } catch (err) {
                    console.error('Entry track error:', err);
                    window.alert('Not saved: the trade could not be recorded. Try again.');
                  }
                };
                const isEntered = enteredCoins.has(c.mint);

                return (
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
                    <div style={{ marginTop: "8px", display: "flex", gap: "6px" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markEntered();
                        }}
                        style={{
                          padding: "4px 8px",
                          background: isEntered ? "#34c759" : "#1a1a1f",
                          color: isEntered ? "#000" : "#34c759",
                          border: "1px solid #34c759",
                          borderRadius: "4px",
                          fontSize: "10px",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isEntered ? "✅ Entered" : "✔ Enter"}
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
                    </div>
                  </div>
                );
              })
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
          
          <div className="radar-tabs" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            <TabButton tab="cate" label="🎯 CATE" count={cateCoins.length} />
            <TabButton tab="signals" label="💰 Buy Signals" count={buySignals.length} />
            <TabButton tab="early" label="🚀 Ultra Momentum" count={ultraEarlyMomentum.length} />
            <TabButton tab="elite-s" label="⭐ Elite" count={eliteCandidates.length} />
            <TabButton tab="qualified" label="💼 Incubation" count={incubationCandidates.length} />
            <TabButton tab="runners" label="🏃 Runners" count={runners.length} />
            <TabButton tab="graduates" label="🎓 Graduations" count={graduates.filter((g) => g.healthy !== false).length} />
            <TabButton tab="stats" label="📋 Stats" />
          </div>

          <div style={{ fontSize: "12px", color: "#8a8a8e", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>
              {isRefreshing
                ? "🔄 Refreshing..."
                : lastUpdate
                  ? `${failedSources.length ? "⚠ Partly refreshed" : "✓ Screen refreshed"} ${lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Loading..."}
            </span>
            <button
              onClick={() => void fetchAll()}
              disabled={isRefreshing}
              aria-label="Refresh now"
              style={{ background: "#1a1a1f", color: "#8a8a8e", border: "1px solid #2a2a2f", borderRadius: "6px", padding: "4px 10px", fontSize: "12px", cursor: "pointer" }}
            >
              ↻ Refresh
            </button>
          </div>
          {failedSources.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#ff9f0a" }}>
              ⚠ {failedSources.length} data source{failedSources.length === 1 ? "" : "s"} could not be loaded just now ({failedSources.join(", ")}). Lists may be incomplete or out of date; the next refresh tries again.
            </div>
          )}
          {safety && safety.unverified > 0 && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#ff9f0a" }}>
              ⚠ {safety.unverified} of {safety.total} coins could not be live-checked right now (DexScreener busy) — they are NOT confirmed safe.
            </div>
          )}
        </div>

        <div data-tab-content className="radar-tab-content" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
          {renderContent()}
        </div>
      </div>
    </ElitePageWrapper>
  );
}
