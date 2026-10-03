"use client";

import { useEffect, useState } from "react";

export default function RadarPage() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/coins");
        if (res.ok) {
          const data = await res.json();
          setCoins(data.coins);
        }
      } catch (err) {
        console.error("Error fetching coins:", err);
      }
      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>🚀 Aureus Intelligence Radar</h1>
      <p>Solana Trading Intelligence</p>

      {loading ? (
        <p>Loading coins...</p>
      ) : coins.length === 0 ? (
        <p>No coins found. Check API.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "15px" }}>
          {coins.map((coin) => (
            <div
              key={coin.mint}
              style={{
                border: "1px solid #333",
                borderRadius: "8px",
                padding: "15px",
                background: "#1a1a1a",
              }}
            >
              <h3 style={{ margin: "0 0 10px 0" }}>{coin.symbol}</h3>
              <p style={{ margin: "5px 0", fontSize: "12px", color: "#888" }}>
                {coin.mint.slice(0, 8)}...{coin.mint.slice(-8)}
              </p>
              <div style={{ fontSize: "14px" }}>
                <p style={{ margin: "5px 0" }}>
                  💰 Market Cap: <strong>${coin.marketCapUsd ? coin.marketCapUsd.toLocaleString() : "?"}</strong>
                </p>
                <p style={{ margin: "5px 0" }}>
                  💧 Liquidity: <strong>${coin.liquidityUsd ? coin.liquidityUsd.toLocaleString() : "?"}</strong>
                </p>
                <p style={{ margin: "5px 0" }}>
                  📊 Volume: <strong>${coin.volumeUsd ? coin.volumeUsd.toLocaleString() : "?"}</strong>
                </p>
                <p style={{ margin: "5px 0" }}>
                  ✅ Status: <strong style={{ color: coin.qualified ? "#0f0" : "#f88" }}>
                    {coin.qualified ? "QUALIFIED" : "MONITORING"}
                  </strong>
                </p>
              </div>
              <a
                href={`https://dexscreener.com/solana/${coin.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: "10px",
                  display: "inline-block",
                  padding: "8px 12px",
                  background: "#0f0",
                  color: "#000",
                  borderRadius: "4px",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                View on DexScreener ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
