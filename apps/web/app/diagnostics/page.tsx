"use client";
import { useEffect, useState } from "react";

export default function Diagnostics() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const test = async () => {
      const res = await fetch("https://api.dexscreener.com/latest/dex/tokens/solana");
      const json = await res.json();
      setData({
        isArray: Array.isArray(json),
        length: json?.length || 0,
        type: typeof json,
        keys: Object.keys(json || {}).slice(0, 10),
        first: json?.[0] || json?.pairs?.[0] || null,
      });
    };
    test();
  }, []);

  return (
    <div style={{ padding: "24px", background: "#0f1116", color: "#fff", minHeight: "100vh", fontFamily: "monospace", fontSize: "12px" }}>
      <h1>🔍 DexScreener API Test</h1>
      {data ? (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <div>Loading...</div>
      )}
    </div>
  );
}
