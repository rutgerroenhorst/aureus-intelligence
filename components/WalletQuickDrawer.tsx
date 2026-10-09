"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface WalletQuickDrawerProps {
  address: string | null;
  onClose: () => void;
}

export function WalletQuickDrawer({ address, onClose }: WalletQuickDrawerProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    // TODO: Fetch wallet data from API
    setLoading(false);
  }, [address]);

  if (!address) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 999,
        }}
      />

      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "400px",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Wallet Intelligence</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text)", fontSize: "20px", cursor: "pointer" }}>
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
          {!data ? (
            <div style={{ color: "var(--muted-2)", fontSize: "12px", lineHeight: "1.6" }}>
              <p style={{ margin: "0 0 8px 0" }}>
                <strong>Address:</strong>
              </p>
              <p style={{ margin: "0 0 12px 0", fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all" }}>
                {address}
              </p>
              <p style={{ margin: 0 }}>Data not available yet</p>
            </div>
          ) : null}
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
          <Link
            href={`/wallets/${encodeURIComponent(address)}`}
            style={{
              display: "block",
              textAlign: "center",
              background: "var(--cyan)",
              color: "var(--midnight)",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            View Full Profile
          </Link>
        </div>
      </div>
    </>
  );
}
