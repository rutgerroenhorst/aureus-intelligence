"use client";
import { useEffect, useState } from "react";
import ElitePageWrapper from "@/components/ElitePageWrapper";

interface CandidateWithSignals {
  id: string;
  symbol: string;
  mint: string;
  minutes_old: number;
  price_usd: number;
  market_cap_usd: number;
  liquidity_usd: number;
  total_buys: number;
  total_sells: number;
  buys_5m: number;
  buy_ratio: string;
  score: number;
  tier?: "ELITE" | "HOT" | "WARM" | "COLD";
  mint_auth: boolean;
  freeze_auth: boolean;
  holder_top10_pct: number;
  time_to_act?: number;
  lp_stability?: string;
  red_flags?: string[];
  is_winner?: boolean;
  live_signals?: {
    holder_trend: string;
    new_holders_1m: number;
    avg_buy_size: string;
    lp_status: string;
  };
}

interface Candidate {
  id: string;
  symbol: string | null;
  mint: string;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  discovered_at: string;
}

type Tab = "signals" | "positions" | "elite-s" | "early-opportunities" | "early-entry" | "qualified" | "stats";

export default function RadarPageElite() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eliteCandidates, setEliteCandidates] = useState<any[]>([]);
  const [ultraEarlyCandidates, setUltraEarlyCandidates] = useState<CandidateWithSignals[]>([]);
  const [incubationCandidates, setIncubationCandidates] = useState<CandidateWithSignals[]>([]);
  const [buySignals, setBuySignals] = useState<any[]>([]);
  const [sellSignals, setSellSignals] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("signals");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCoinId, setExpandedCoinId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setIsRefreshing(true);
        const [candRes, eliteRes, winnersRes, ultRes, incRes, signalsRes, posRes] = await Promise.all([
          fetch("/api/candidates"),
          fetch("/api/elite-validator"),
          fetch("/api/winners-only"),
          fetch("/api/ultra-early"),
          fetch("/api/incubation"),
          fetch("/api/signals"),
          fetch("/api/positions"),
        ]);
        
        if (candRes.ok) {
          const cand = await candRes.json();
          setCandidates(cand.candidates || []);
        }

        if (eliteRes.ok) {
          const elite = await eliteRes.json();
          setEliteCandidates(elite.candidates || []);
        }

        if (ultRes.ok) {
          const ult = await ultRes.json();
          setUltraEarlyCandidates(ult.candidates || []);
        }
        
        if (incRes.ok) {
          const inc = await incRes.json();
          setIncubationCandidates(inc.candidates || []);
        }

        if (signalsRes.ok) {
          const sig = await signalsRes.json();
          setBuySignals(sig.buy_signals || []);
          setSellSignals(sig.sell_signals || []);
        }

        if (posRes.ok) {
          const pos = await posRes.json();
          setPositions(pos.positions || []);
        }
        
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

  const CandidateRow = ({ c, color }: { c: CandidateWithSignals; color: string }) => (
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
          <div style={{ fontSize: "10px", color: color }}>
            {c.minutes_old}m old • {c.buy_ratio}% buys
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://solscan.io/token/${c.mint}`, "_blank");
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
              window.open(`https://dexscreener.com/solana/${c.mint}`, "_blank");
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
          <div style={{ textAlign: "right", marginLeft: "12px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: color }}>{c.tier || 'SCAN'}</div>
            <div style={{ fontSize: "10px", color: "#aaa" }}>{Math.round(c.score)}pts</div>
          </div>
        </div>
      </div>
    </div>
  );

  const SimpleCoinRow = ({ coin }: { coin: Candidate }) => {
    if (!coin.marketCapUsd || coin.marketCapUsd < 5000) return null;
    return (
      <div
        style={{
          background: "#0f1116",
          border: "1px solid #1a1a1f",
          borderRadius: "8px",
          padding: "12px",
          marginBottom: "8px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{coin.symbol || coin.mint.slice(0, 8)}</div>
            <div style={{ fontSize: "10px", color: "#8a8a8e", marginTop: "2px" }}>
              MCap: ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k {coin.liquidityUsd && `• Liq: ${((coin.liquidityUsd || 0) / 1000).toFixed(1)}k`}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(`https://solscan.io/token/${coin.mint}`, "_blank");
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
                window.open(`https://dexscreener.com/solana/${coin.mint}`, "_blank");
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
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                ${((coin.marketCapUsd || 0) / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ElitePageWrapper title="Radar" subtitle="Winners-focused early-stage discovery">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#0f1116", borderRadius: "6px", marginBottom: "16px", border: "1px solid #1a1a1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34c759", animation: "pulse 2s infinite" }} />
          <span style={{ color: "#8a8a8e" }}>{isRefreshing ? "Scanning..." : "Live"}</span>
          {lastUpdate && <span style={{ color: "#6f6f73", fontSize: "11px" }}>{Math.round((Date.now() - lastUpdate.getTime()) / 1000)}s ago</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <TabButton tab="signals" label="🎯 SIGNALS" count={buySignals.length} />
        <TabButton tab="positions" label="💰 POSITIONS" count={positions.length} />
        <TabButton tab="elite-s" label="💎 ELITE S" count={eliteCandidates.length} />
        <TabButton tab="early-opportunities" label="🚀 EARLY" count={ultraEarlyCandidates.length + incubationCandidates.length} />
        <TabButton tab="early-entry" label="🔥 ENTRY" count={earlyEntry.length} />
        <TabButton tab="qualified" label="✓ QUALIFIED" count={qualified.length} />
        <TabButton tab="stats" label="📊 STATS" />
      </div>

      {activeTab === "signals" && (
        <div>
          {buySignals.length > 0 ? (
            <div style={{ color: "#34c759", fontSize: "10px" }}>🎯 BUY SIGNALS: {buySignals.length} active</div>
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No buy signals yet</div>
          )}
        </div>
      )}

      {activeTab === "positions" && (
        <div>
          {positions.length > 0 ? (
            <div style={{ color: "#34c759", fontSize: "10px" }}>💰 POSITIONS: {positions.length} open</div>
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No open positions</div>
          )}
        </div>
      )}

      {activeTab === "elite-s" && (
        <div>
          {eliteCandidates.length > 0 ? (
            eliteCandidates.map((c) => (
              <CandidateRow key={c.id} c={c} color="#34c759" />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No S-grade elite coins</div>
          )}
        </div>
      )}

      {activeTab === "early-opportunities" && (
        <div>
          {ultraEarlyCandidates.length > 0 || incubationCandidates.length > 0 ? (
            <div>
              {ultraEarlyCandidates.map((c) => (
                <CandidateRow key={c.id} c={c} color="#ff9500" />
              ))}
              {incubationCandidates.map((c) => (
                <CandidateRow key={c.id} c={c} color="#ff00ff" />
              ))}
            </div>
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No early opportunities</div>
          )}
        </div>
      )}

      {activeTab === "early-entry" && (
        <div>
          {earlyEntry.length > 0 ? (
            earlyEntry.map((coin) => (
              <SimpleCoinRow key={coin.id} coin={coin} />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No early entry candidates</div>
          )}
        </div>
      )}

      {activeTab === "qualified" && (
        <div>
          {qualified.length > 0 ? (
            qualified.slice(0, 50).map((coin) => (
              <SimpleCoinRow key={coin.id} coin={coin} />
            ))
          ) : (
            <div style={{ color: "#6f6f73", fontSize: "12px", padding: "20px" }}>No qualified candidates</div>
          )}
        </div>
      )}

      {activeTab === "stats" && (
        <div style={{ fontSize: "12px", color: "#8a8a8e", padding: "16px", background: "#0f1116", borderRadius: "6px" }}>
          <div style={{ marginBottom: "8px" }}>🎯 Signals: {buySignals.length}</div>
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
