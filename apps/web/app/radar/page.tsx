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

type Tab = "signals" | "positions" | "trends" | "momentum" | "performance" | "elite-s" | "early" | "entry" | "qualified" | "stats";

export default function RadarPageElite() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eliteCandidates, setEliteCandidates] = useState<any[]>([]);
  const [ultraEarlyCandidates, setUltraEarlyCandidates] = useState<any[]>([]);
  const [incubationCandidates, setIncubationCandidates] = useState<any[]>([]);
  const [buySignals, setBuySignals] = useState<any[]>([]);
  const [sellSignals, setSellSignals] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [momentum, setMomentum] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("signals");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const formatMcap = (mcap: number | null | undefined) => {
    if (!mcap || mcap === 0) return "$0";
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}m`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(0)}k`;
    return `$${mcap.toFixed(0)}`;
  };

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setIsRefreshing(true);
        const [candRes, eliteRes, ultRes, incRes, signalsRes, posRes, trendsRes, momRes, perfRes, netRes] = await Promise.all([
          fetch("/api/candidates"),
          fetch("/api/elite-validator"),
          fetch("/api/ultra-early"),
          fetch("/api/incubation"),
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
        if (incRes.ok) setIncubationCandidates(await incRes.json().then(d => d.candidates || []));
        if (signalsRes.ok) {
          const sig = await signalsRes.json();
          setBuySignals(sig.buy_signals || []);
          setSellSignals(sig.sell_signals || []);
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
    const poll = setInterval(fetchAll, 5_000);
    return () => clearInterval(poll);
  }, []);

  const isRugged = (c: Candidate) => !c.marketCapUsd || c.marketCapUsd < 5000;
  const qualified = candidates.filter((c) => (c.marketCapUsd || 0) >= 10000).sort((a, b) => new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime());
  const earlyEntry = qualified.filter((c) => {
    const ageHours = (Date.now() - new Date(c.discovered_at).getTime()) / (1000 * 60 * 60);
    return ageHours < 6 && !isRugged(c);
  }).slice(0, 50);

  const TabButton = ({ tab, label, count }: { tab: Tab; label: string; count?: number }) => (
    <button
      onClick={() => setActiveTab(tab)}
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

  const CoinRow = ({ c, color }: { c: any; color: string }) => {
    const mcap = Number(c.market_cap_usd || 0);
    const conf = Number(c.confidence || c.buy_ratio || 0);
    return (
    <div
      style={{
        background: "#0f1116",
        border: `2px solid ${color}`,
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{c.symbol}</div>
          <div style={{ fontSize: "10px", color: color, marginTop: "2px" }}>
            {c.minutes_old || 0}m old • {conf.toFixed(0)}% {c.signal || c.strength || c.phase || ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `https://solscan.io/token/${c.mint}`;
            }}
            style={{
              padding: "4px 8px",
              fontSize: "10px",
              background: "#1a1a1f",
              border: "1px solid #2a2a2f",
              borderRadius: "4px",
              color: "#34c759",
              cursor: "pointer",
            }}
          >
            Solscan
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `https://dexscreener.com/solana/${c.mint}`;
            }}
            style={{
              padding: "4px 8px",
              fontSize: "10px",
              background: "#1a1a1f",
              border: "1px solid #2a2a2f",
              borderRadius: "4px",
              color: "#34c759",
              cursor: "pointer",
            }}
          >
            Dex
          </button>
          <div style={{ textAlign: "right", marginLeft: "12px", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: color }}>{formatMcap(mcap)}</div>
          </div>
        </div>
      </div>
    </div>
    );
  };

  return (
    <ElitePageWrapper title="Radar" subtitle="Elite intelligence system">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#0f1116", borderRadius: "6px", marginBottom: "16px", border: "1px solid #1a1a1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34c759" }} />
          <span style={{ color: "#8a8a8e" }}>{isRefreshing ? "Scanning..." : "Live"}</span>
          {lastUpdate && <span style={{ color: "#6f6f73", fontSize: "11px" }}>{Math.round((Date.now() - lastUpdate.getTime()) / 1000)}s ago</span>}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {networks.slice(0, 5).map((net: any) => (
            <button
              key={net.chain}
              onClick={() => setSelectedChain(selectedChain === net.chain ? null : net.chain)}
              style={{
                padding: "6px 12px",
                fontSize: "11px",
                background: selectedChain === net.chain ? net.status === "FIRE" ? "#ff0000" : net.status === "HOT" ? "#ff6b00" : "#666" : "#1a1a1f",
                border: `1px solid ${net.status === "FIRE" ? "#ff0000" : net.status === "HOT" ? "#ff6b00" : net.status === "WARM" ? "#ffa500" : "#2a2a2f"}`,
                borderRadius: "4px",
                color: net.status === "FIRE" ? "#ff0000" : net.status === "HOT" ? "#ff6b00" : net.status === "WARM" ? "#ffa500" : "#8a8a8e",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {net.chain} {net.status === "FIRE" ? "🔥" : net.status === "HOT" ? "🔥" : ""}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <TabButton tab="signals" label="🎯 SIGNALS" count={buySignals.length} />
        <TabButton tab="trends" label="📈 TRENDS" count={trends.length} />
        <TabButton tab="momentum" label="⚡ MOMENTUM" count={momentum.length} />
        <TabButton tab="positions" label="💰 POSITIONS" count={positions.length} />
        <TabButton tab="performance" label="🎖️ PERFORMANCE" />
        <TabButton tab="elite-s" label="💎 ELITE S" count={eliteCandidates.length} />
        <TabButton tab="early" label="🚀 EARLY" count={ultraEarlyCandidates.length + incubationCandidates.length} />
        <TabButton tab="entry" label="🔥 ENTRY" count={earlyEntry.length} />
        <TabButton tab="qualified" label="✓ QUALIFIED" count={qualified.length} />
        <TabButton tab="stats" label="📊 STATS" />
      </div>

      {activeTab === "signals" && (
        <div>
          {buySignals.length > 0 ? (
            buySignals.map((s: any) => (
              <CoinRow key={s.id} c={s} color="#34c759" />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No active buy signals</div>
          )}
        </div>
      )}

      {activeTab === "trends" && (
        <div>
          {trends.length > 0 ? (
            trends.slice(0, 20).map((t: any) => (
              <CoinRow key={t.id} c={t} color={t.signal === "STRONG_REVERSAL" ? "#ff00ff" : t.signal === "BULLISH" ? "#34c759" : "#ff9500"} />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No trend data</div>
          )}
        </div>
      )}

      {activeTab === "momentum" && (
        <div>
          {momentum.length > 0 ? (
            momentum.slice(0, 20).map((m: any) => (
              <CoinRow key={m.id} c={m} color={m.strength === "elite" ? "#00ff00" : m.strength === "strong" ? "#34c759" : "#ff9500"} />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No momentum data</div>
          )}
        </div>
      )}

      {activeTab === "positions" && (
        <div>
          {positions.length > 0 ? (
            <div style={{ color: "#34c759", fontSize: "12px" }}>💰 OPEN POSITIONS: {positions.length}</div>
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No open positions</div>
          )}
        </div>
      )}

      {activeTab === "performance" && performance && (
        <div style={{ fontSize: "11px", color: "#8a8a8e", padding: "16px", background: "#0f1116", borderRadius: "6px" }}>
          <div>💰 Total P&L: ${performance.total_pnl || 0}</div>
          <div>📈 Realized: ${performance.realized_pnl || 0}</div>
          <div>📊 Win Rate: {performance.win_rate || 0}%</div>
          <div>📋 Profit Factor: {performance.profit_factor || 0}</div>
          <div style={{ marginTop: "8px" }}>🏆 Largest Winner: {performance.largest_winner?.symbol || "N/A"}</div>
          <div>💣 Largest Loser: {performance.largest_loser?.symbol || "N/A"}</div>
        </div>
      )}

      {activeTab === "elite-s" && (
        <div>
          {eliteCandidates.length > 0 ? (
            eliteCandidates.map((c: any) => (
              <CoinRow key={c.id} c={c} color="#34c759" />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No S-grade elite coins</div>
          )}
        </div>

      const filterByChain = (coins: any[]) => {
        if (!selectedChain) return coins;
        return coins.filter((c: any) => c.chain === selectedChain);
      };
      )}

      {activeTab === "early" && (
        <div>
          {ultraEarlyCandidates.length > 0 || incubationCandidates.length > 0 ? (
            <div>
              {filterByChain(ultraEarlyCandidates).map((c: any) => (
                <CoinRow key={c.id} c={c} color="#ff9500" />
              ))}
              {filterByChain(incubationCandidates).map((c: any) => (
                <CoinRow key={c.id} c={c} color="#ff00ff" />
              ))}
            </div>
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No early opportunities</div>
          )}
        </div>
      )}

      {activeTab === "entry" && (
        <div>
          {earlyEntry.length > 0 ? (
            earlyEntry.map((coin: any) => (
              <div key={coin.id} style={{ background: "#0f1116", border: "1px solid #1a1a1f", borderRadius: "8px", padding: "12px", marginBottom: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{coin.symbol || coin.mint.slice(0, 8)}</div>
                    <div style={{ fontSize: "10px", color: "#8a8a8e", marginTop: "2px" }}>
                      MCap: ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={(e) => { e.stopPropagation(); window.open(`https://solscan.io/token/${coin.mint}`, "_blank"); }} style={{ padding: "4px 8px", fontSize: "10px", background: "#1a1a1f", border: "1px solid #2a2a2f", borderRadius: "4px", color: "#34c759", cursor: "pointer" }}>Solscan</button>
                    <button onClick={(e) => { e.stopPropagation(); window.open(`https://dexscreener.com/solana/${coin.mint}`, "_blank"); }} style={{ padding: "4px 8px", fontSize: "10px", background: "#1a1a1f", border: "1px solid #2a2a2f", borderRadius: "4px", color: "#34c759", cursor: "pointer" }}>Dex</button>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap", marginLeft: "12px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                        ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No early entry candidates</div>
          )}
        </div>
      )}

      {activeTab === "qualified" && (
        <div>
          {qualified.length > 0 ? (
            qualified.slice(0, 50).map((coin: any) => (
              <div key={coin.id} style={{ background: "#0f1116", border: "1px solid #1a1a1f", borderRadius: "8px", padding: "12px", marginBottom: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{coin.symbol || coin.mint.slice(0, 8)}</div>
                    <div style={{ fontSize: "10px", color: "#8a8a8e", marginTop: "2px" }}>
                      MCap: ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={(e) => { e.stopPropagation(); window.open(`https://solscan.io/token/${coin.mint}`, "_blank"); }} style={{ padding: "4px 8px", fontSize: "10px", background: "#1a1a1f", border: "1px solid #2a2a2f", borderRadius: "4px", color: "#34c759", cursor: "pointer" }}>Solscan</button>
                    <button onClick={(e) => { e.stopPropagation(); window.open(`https://dexscreener.com/solana/${coin.mint}`, "_blank"); }} style={{ padding: "4px 8px", fontSize: "10px", background: "#1a1a1f", border: "1px solid #2a2a2f", borderRadius: "4px", color: "#34c759", cursor: "pointer" }}>Dex</button>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap", marginLeft: "12px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                        ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No qualified candidates</div>
          )}
        </div>
      )}

      {activeTab === "stats" && (
        <div style={{ fontSize: "12px", color: "#8a8a8e", padding: "16px", background: "#0f1116", borderRadius: "6px" }}>
          <div style={{ marginBottom: "8px" }}>🎯 Signals: {buySignals.length}</div>
          <div style={{ marginBottom: "8px" }}>📈 Trends: {trends.length}</div>
          <div style={{ marginBottom: "8px" }}>⚡ Momentum: {momentum.length}</div>
          <div style={{ marginBottom: "8px" }}>💰 Positions: {positions.length}</div>
          <div style={{ marginBottom: "8px" }}>💎 Elite S: {eliteCandidates.length}</div>
          <div style={{ marginBottom: "8px" }}>🚀 Early: {ultraEarlyCandidates.length + incubationCandidates.length}</div>
          <div style={{ marginBottom: "8px" }}>🔥 Entry: {earlyEntry.length}</div>
          <div>✓ Qualified: {qualified.length}</div>
        </div>
      )}
    </ElitePageWrapper>
  );
}
