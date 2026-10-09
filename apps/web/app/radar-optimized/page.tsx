"use client";

import { useState, useEffect } from "react";
import { useFetch } from "@/hooks/useFetch";
import { ErrorBoundary } from "@/components/ErrorBoundary";

type Tab = "stealth-moons" | "elite" | "cate" | "quick-flips";

const TABS: Record<Tab, { label: string; color: string; description: string }> = {
  "stealth-moons": {
    label: "🌙 STEALTH MOONS",
    color: "#a78bfa",
    description: "3-14d accumulation phase coins"
  },
  "elite": {
    label: "✨ ELITE",
    color: "#34c759",
    description: "Highest quality candidates"
  },
  "cate": {
    label: "🚀 CATE",
    color: "#ff9500",
    description: "Ultra-micro-cap pump signals"
  },
  "quick-flips": {
    label: "⚡ QUICK FLIPS",
    color: "#30b0c0",
    description: "Under 24h old, high momentum"
  }
};

interface CoinData {
  symbol: string;
  mint: string;
  stealthScore?: number;
  score?: number;
  dangerScore?: number;
  buyRatio?: number;
  holderTop10?: number;
  volumeVelocity?: number;
  minutesOld?: number;
  compositeScore?: number;
}

function CoinCard({ coin, color }: { coin: CoinData; color: string }) {
  const daysOld = (coin.minutesOld || 0) / (60 * 24);

  return (
    <div style={{
      background: "#0f1116",
      border: `2px solid ${color}`,
      borderRadius: "8px",
      padding: "12px",
      marginBottom: "8px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{coin.symbol}</div>
        <div style={{ fontSize: "11px", color, marginTop: "4px" }}>
          {daysOld.toFixed(1)}d • Composite: {((coin.compositeScore || 0) * 100).toFixed(0)}/100 • Quality: {coin.score}/150
        </div>
        <div style={{ fontSize: "10px", color: "#8a8a8e", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <span>💰 {((coin.buyRatio || 0) * 100).toFixed(0)}%</span>
          <span>👥 {(coin.holderTop10 || 0).toFixed(1)}%</span>
          <span>📊 {(coin.volumeVelocity || 1).toFixed(1)}x</span>
        </div>
        {(coin.dangerScore || 0) > 40 && (
          <div style={{ fontSize: "9px", color: "#ff3b30", marginTop: "4px", fontWeight: 600 }}>
            ⚠️ Risk: {Math.round(coin.dangerScore || 0)}/100
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginLeft: "12px" }}>
        <button
          onClick={() => window.open(`https://dexscreener.com/solana/${coin.mint}`, "_blank")}
          style={{
            padding: "6px 12px",
            background: color,
            color: "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "10px",
            whiteSpace: "nowrap"
          }}
        >
          DexScreener
        </button>
      </div>
    </div>
  );
}

function TabContent({ tab, coins, loading, error }: { tab: Tab; coins: CoinData[]; loading: boolean; error: Error | null }) {
  const [showMore, setShowMore] = useState(false);
  const displayed = showMore ? coins : coins.slice(0, 20);
  const hasMore = coins.length > 20;

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#8a8a8e" }}>
        ⏳ Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: "20px",
        background: "#1a1a1f",
        border: "2px solid #ff3b30",
        borderRadius: "8px",
        color: "#ff3b30",
        fontSize: "12px"
      }}>
        ⚠️ {error.message}
      </div>
    );
  }

  if (coins.length === 0) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#8a8a8e" }}>
        No coins detected yet
      </div>
    );
  }

  return (
    <div>
      {displayed.map((c) => (
        <CoinCard key={c.mint} coin={c} color={TABS[tab].color} />
      ))}
      {hasMore && !showMore && (
        <button
          onClick={() => setShowMore(true)}
          style={{
            width: "100%",
            padding: "12px",
            marginTop: "12px",
            background: "#1a1a1f",
            border: "1px solid #2a2a2f",
            borderRadius: "6px",
            color: "#8a8a8e",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600
          }}
        >
          Load {coins.length - 20} more coins
        </button>
      )}
    </div>
  );
}

export default function RadarOptimized() {
  const [activeTab, setActiveTab] = useState<Tab>("stealth-moons");

  // Fetch data for current tab only (lazy loading)
  const endpoints: Record<Tab, string> = {
    "stealth-moons": "/api/early-coins?limit=100",
    "elite": "/api/elite-validator?limit=100",
    "cate": "/api/cate-hunter?limit=100",
    "quick-flips": "/api/ultra-early?limit=100"
  };

  const { data, loading, error } = useFetch(endpoints[activeTab], {
    retries: 2,
    retryDelay: 500,
    timeout: 5000
  });

  const coins = data?.candidates || [];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0d",
      color: "#fff",
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid #2a2a2f",
        background: "#0f1116"
      }}>
        <h1 style={{ margin: "0 0 12px 0", fontSize: "24px", fontWeight: 700 }}>📡 Aureus Radar</h1>
        <div style={{ fontSize: "12px", color: "#8a8a8e" }}>
          Real-time early coin detection powered by velocity signals
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        padding: "12px 20px",
        display: "flex",
        gap: "8px",
        borderBottom: "1px solid #2a2a2f",
        flexWrap: "wrap"
      }}>
        {Object.entries(TABS).map(([tabKey, tabInfo]) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(tabKey as Tab)}
            style={{
              padding: "8px 16px",
              background: activeTab === tabKey ? tabInfo.color : "#1a1a1f",
              color: activeTab === tabKey ? "#000" : "#8a8a8e",
              border: `1px solid ${activeTab === tabKey ? tabInfo.color : "#2a2a2f"}`,
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 700,
              transition: "all 0.2s"
            }}
          >
            {tabInfo.label} ({coins.length})
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "20px" }}>
        <div style={{ fontSize: "12px", color: "#8a8a8e", marginBottom: "16px" }}>
          💡 {TABS[activeTab].description}
        </div>

        <ErrorBoundary name={`Tab-${activeTab}`}>
          <TabContent
            tab={activeTab}
            coins={coins}
            loading={loading}
            error={error}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
