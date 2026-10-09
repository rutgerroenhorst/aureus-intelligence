"use client";
import React, { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppShellProps {
  children: ReactNode;
}

const AureusLogo = () => (
  <svg viewBox="0 0 40 40" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="aGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--blue-electric)" />
        <stop offset="100%" stopColor="var(--cyan-ice)" />
      </linearGradient>
    </defs>
    <path d="M 8 32 L 20 8 L 32 32 M 14 24 L 26 24" stroke="url(#aGrad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke="url(#aGrad)" strokeWidth="0.8" opacity="0.3"/>
  </svg>
);

const NavIcon = ({ type }: { type: string }) => {
  const iconProps = { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "radar":
      return <svg {...iconProps}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="0"/></svg>;
    case "stream":
      return <svg {...iconProps}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "signals":
      return <svg {...iconProps}><path d="M 4 14 L 8 8 L 12 11 L 16 6 L 20 10 L 20 20 L 4 20 Z"/></svg>;
    case "results":
      return <svg {...iconProps}><polyline points="12 2 19 14 5 14 12 2"/><line x1="12" y1="14" x2="12" y2="22"/></svg>;
    case "forensics":
      return <svg {...iconProps}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
    case "wallets":
      return <svg {...iconProps}><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>;
    case "watchlist":
      return <svg {...iconProps}><polygon points="12 2 15.09 10.26 23.77 11.27 17.88 17.14 19.54 25.88 12 21.77 4.46 25.88 6.12 17.14 0.23 11.27 8.91 10.26"/></svg>;
    case "ops":
      return <svg {...iconProps}><circle cx="6" cy="6" r="1"/><circle cx="18" cy="6" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="18" cy="18" r="1"/><line x1="6" y1="7" x2="6" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/><line x1="5" y1="6" x2="19" y2="6"/><line x1="5" y1="18" x2="19" y2="18"/></svg>;
    default:
      return null;
  }
};

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [backendOnline, setBackendOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch("/api/telemetry", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setBackendOnline(data.status !== "OFFLINE" && data.lastWorkerCycleAt);
        } else {
          setBackendOnline(false);
        }
      } catch {
        setBackendOnline(false);
      } finally {
        setLoading(false);
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { label: "Radar", href: "/radar", type: "radar" },
    { label: "Stream", href: "/stream", type: "stream" },
    { label: "Signals", href: "/signals", type: "signals" },
    { label: "Results", href: "/results", type: "results" },
    { label: "Forensics", href: "/forensics", type: "forensics" },
    { label: "Wallets", href: "/wallets", type: "wallets" },
    { label: "Watchlist", href: "/watchlist", type: "watchlist" },
    { label: "Ops", href: "/ops", type: "ops" },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-base)" }}>
      <aside
        style={{
          width: "200px",
          background: "linear-gradient(180deg, var(--bg-sidebar) 0%, #030d1a 100%)",
          borderRight: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          padding: "24px 0",
          overflowY: "auto",
          color: "var(--text-primary)",
          position: "relative",
        }}
      >
        <div style={{ paddingLeft: "16px", paddingRight: "16px", marginBottom: "40px", position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
            <AureusLogo />
            <div>
              <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "1.4px", lineHeight: 1 }}>
                AUREUS
              </div>
              <div style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.6px", color: "var(--text-muted)", marginTop: "2px" }}>
                INTELLIGENCE
              </div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, position: "relative", zIndex: 2 }}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "11px",
                  padding: "10px 14px",
                  marginLeft: "6px",
                  marginRight: "6px",
                  marginBottom: "6px",
                  borderRadius: "8px",
                  color: active ? "var(--cyan-ice)" : "var(--text-muted)",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: active ? 700 : 500,
                  background: active ? "linear-gradient(90deg, rgba(37, 133, 255, 0.15) 0%, rgba(53, 220, 255, 0.08) 100%)" : "transparent",
                  borderLeft: `3px solid ${active ? "var(--cyan-ice)" : "transparent"}`,
                  transition: "all 160ms ease",
                  cursor: "pointer",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(53, 220, 255, 0.06)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
              >
                <span style={{ display: "flex", color: "inherit", opacity: 0.85 }}>
                  <NavIcon type={item.type} />
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: "14px 16px", marginTop: "auto", borderTop: "1px solid var(--border-color)", position: "relative", zIndex: 2 }}>
          <div style={{ fontSize: "8px", fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.5px", marginBottom: "10px" }}>
            System
          </div>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "3px" }}>
            v0.1.0
          </div>
          <div style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.7 }}>
            Solana Intelligence
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: "56px",
            borderBottom: "1px solid var(--border-color)",
            background: "linear-gradient(90deg, var(--bg-surface) 0%, rgba(8, 32, 58, 0.5) 100%)",
            display: "flex",
            alignItems: "center",
            paddingLeft: "28px",
            paddingRight: "28px",
            justifyContent: "space-between",
            gap: "32px",
          }}
        >
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                maxWidth: "480px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "9px 12px",
                background: "linear-gradient(90deg, var(--bg-raised) 0%, rgba(8, 32, 58, 0.7) 100%)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color-highlight)";
                (e.currentTarget as HTMLElement).style.background = "linear-gradient(90deg, var(--bg-interactive) 0%, rgba(12, 49, 88, 0.8) 100%)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(37, 133, 255, 0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                (e.currentTarget as HTMLElement).style.background = "linear-gradient(90deg, var(--bg-raised) 0%, rgba(8, 32, 58, 0.7) 100%)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--text-muted)", width: "15px", height: "15px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input
                type="text"
                placeholder="Search tokens..."
                style={{
                  flex: 1,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            {!loading && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                <div
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: backendOnline ? "var(--emerald)" : "#FF546A",
                    boxShadow: backendOnline ? "0 0 0 3px rgba(32, 231, 163, 0.15)" : "0 0 0 3px rgba(255, 84, 104, 0.15)",
                    animation: backendOnline ? "pulse 2.2s ease-in-out infinite" : "none",
                  }}
                />
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                  {backendOnline ? "Live" : "Offline"}
                </span>
              </div>
            )}

            <div style={{ paddingLeft: "16px", borderLeft: "1px solid var(--border-color)", fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
              Solana
            </div>
          </div>
        </header>

        <main style={{ flex: 1, overflow: "auto", background: "var(--bg-base)" }}>
          {children}
        </main>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 3px rgba(32, 231, 163, 0.15); }
          50% { opacity: 0.6; box-shadow: 0 0 0 7px rgba(32, 231, 163, 0.03); }
        }
      `}</style>
    </div>
  );
}
