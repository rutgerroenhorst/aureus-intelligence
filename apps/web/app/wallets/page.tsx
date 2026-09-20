"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PremiumUI";

interface Wallet {
  address: string;
  label?: string;
  role?: string;
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWallets = async () => {
      try {
        const res = await fetch("/api/wallets", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setWallets(data.wallets || []);
        }
      } catch (err) {
        console.error("Failed to fetch wallets:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchWallets();
  }, []);

  if (!loading && wallets.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-base)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "relative", zIndex: 1, padding: "40px 32px 24px", borderBottom: "1px solid var(--border-color)" }}>
          <PageHeader
            title="Wallets"
            subtitle="Verified intelligence wallets and tracking."
          />
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 32px", position: "relative", zIndex: 1 }}>
          <div style={{ textAlign: "center", maxWidth: "520px" }}>
            <div style={{ fontSize: "40px", opacity: 0.12, marginBottom: "20px" }}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--blue-electric)" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="9"></circle>
                <line x1="12" y1="7" x2="12" y2="17"></line>
                <line x1="7" y1="12" x2="17" y2="12"></line>
              </svg>
            </div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "12px" }}>
              No wallets tracked yet
            </h2>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6 }}>
              Wallets verified through Aureus intelligence analysis will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-base)" }}>
      <div style={{ padding: "40px 32px 24px", borderBottom: "1px solid var(--border-color)" }}>
        <PageHeader
          title="Wallets"
          subtitle="Verified intelligence wallets and tracking."
        />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "60px 40px" }}>Loading...</div>
        ) : (
          <div style={{ maxWidth: "900px" }}>
            {wallets.map((wallet) => (
              <div key={wallet.address} style={{ padding: "16px 20px", background: "linear-gradient(180deg, rgba(6, 23, 42, 0.8) 0%, var(--bg-raised) 100%)", border: "1px solid var(--border-color)", borderRadius: "12px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "16px", cursor: "pointer", transition: "all 160ms ease" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "linear-gradient(180deg, var(--bg-interactive) 0%, var(--bg-elevated) 100%)";
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color-highlight)";
                }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "linear-gradient(135deg, #866CFF 0%, #2585FF 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#020914" }}>W</span>
                </div>
                <div style={{ flex: 1, minWidth: "0" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "2px" }}>{wallet.label || "Wallet"}</div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "monospace", marginBottom: "4px" }}>{wallet.address.slice(0, 12)}...{wallet.address.slice(-8)}</div>
                  {wallet.role && <div style={{ fontSize: "10px", color: "#866CFF", fontWeight: 600 }}>{wallet.role}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
