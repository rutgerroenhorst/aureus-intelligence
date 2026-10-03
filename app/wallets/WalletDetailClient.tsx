"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export function WalletDetailClient() {
  const searchParams = useSearchParams();
  const address = searchParams.get("address") || "wallet";
  const displayAddress = address.length > 20 
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : address;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{
        padding: "24px",
        borderBottom: "1px solid var(--border)",
        background: "linear-gradient(to right, var(--panel) 0%, rgba(37, 45, 72, 0.3) 100%)"
      }}>
        <Link href="/wallets" style={{ color: "var(--muted)", fontSize: "12px", textDecoration: "none" }}>
          ← Back to Wallets
        </Link>
      </div>
      
      <div style={{ padding: "24px" }}>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: 600 }}>
          {displayAddress}
        </h1>
        <p style={{ margin: 0, color: "var(--muted-2)", fontSize: "12px" }}>
          Detailed performance and activity for this address
        </p>
      </div>
      
      <div style={{ flex: 1, padding: "24px", textAlign: "center", color: "var(--muted)" }}>
        <div style={{ fontSize: "14px" }}>Wallet details coming soon</div>
      </div>
    </div>
  );
}
