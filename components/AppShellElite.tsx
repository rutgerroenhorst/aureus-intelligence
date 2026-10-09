"use client";
import React, { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppShellEliteProps {
  children: ReactNode;
}

const AureusLogo = () => (
  <svg viewBox="0 0 40 40" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="aGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2585FF" />
        <stop offset="100%" stopColor="#35DCFF" />
      </linearGradient>
    </defs>
    <path d="M 8 32 L 20 8 L 32 32 M 14 24 L 26 24" stroke="url(#aGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke="url(#aGrad)" strokeWidth="1" opacity="0.3"/>
  </svg>
);

const NavIcon = ({ type }: { type: string }) => {
  const iconProps = { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "radar":
      return <svg {...iconProps}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/></svg>;
    case "stream":
      return <svg {...iconProps}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "signals":
      return <svg {...iconProps}><polyline points="12 2 15 10 23 13 16 18 18 26 12 21 6 26 8 18 1 13 9 10 12 2" /></svg>;
    case "results":
      return <svg {...iconProps}><path d="M 4 14 L 8 8 L 12 11 L 16 6 L 20 10 L 20 20 L 4 20 Z"/></svg>;
    case "forensics":
      return <svg {...iconProps}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
    case "wallets":
      return <svg {...iconProps}><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>;
    case "watchlist":
      return <svg {...iconProps}><polygon points="12 2 15.09 10.26 23.77 11.27 17.88 17.14 19.54 25.88 12 21.77 4.46 25.88 6.12 17.14 0.23 11.27 8.91 10.26"/></svg>;
    case "ops":
      return <svg {...iconProps}><circle cx="6" cy="6" r="1"/><circle cx="18" cy="6" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="18" cy="18" r="1"/></svg>;
    default:
      return null;
  }
};

export default function AppShellElite({ children }: AppShellEliteProps) {
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

  const mainNav = [
    { label: "Radar", href: "/radar", type: "radar", group: "Core" },
    { label: "Results", href: "/results", type: "results", group: "Core" },
    { label: "Stream", href: "/stream", type: "stream", group: "Data" },
    { label: "Signals", href: "/signals", type: "signals", group: "Data" },
    { label: "Forensics", href: "/forensics", type: "forensics", group: "Analysis" },
    { label: "Wallets", href: "/wallets", type: "wallets", group: "Analysis" },
    { label: "Watchlist", href: "/watchlist", type: "watchlist", group: "Tracking" },
    { label: "Ops", href: "/ops", type: "ops", group: "Tracking" },
  ];

  const isActive = (href: string) => pathname === href;
  const groups = Array.from(new Set(mainNav.map(n => n.group)));

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0a0908", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* PREMIUM SIDEBAR */}
      <aside style={{
        width: "220px",
        background: "linear-gradient(180deg, #0f1116 0%, #0a0908 100%)",
        borderRight: "1px solid #1a1a1f",
        display: "flex",
        flexDirection: "column",
        padding: "20px 0",
        overflowY: "auto",
        color: "#e5e5e7",
      }}>
        {/* LOGO AREA */}
        <div style={{ paddingLeft: "16px", paddingRight: "16px", marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <AureusLogo />
            <span style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.5px", color: "#fff" }}>AUREUS</span>
          </div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "#8a8a8e", letterSpacing: "0.4px", textTransform: "uppercase" }}>
            Elite Intelligence
          </div>
        </div>

        {/* NAVIGATION SECTIONS */}
        <nav style={{ flex: 1 }}>
          {groups.map((group) => {
            const items = mainNav.filter(n => n.group === group);
            return (
              <div key={group} style={{ marginBottom: "20px" }}>
                <div style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#6f6f73",
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                  paddingLeft: "16px",
                  paddingRight: "16px",
                  marginBottom: "8px",
                }}>
                  {group}
                </div>
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "8px 16px",
                        margin: "2px 10px",
                        borderRadius: "6px",
                        color: active ? "#35DCFF" : "#a1a1a6",
                        textDecoration: "none",
                        fontSize: "12px",
                        fontWeight: active ? 600 : 500,
                        background: active ? "rgba(53, 220, 255, 0.12)" : "transparent",
                        borderLeft: `2px solid ${active ? "#35DCFF" : "transparent"}`,
                        transition: "all 150ms ease",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.color = "#d1d1d6";
                          (e.currentTarget as HTMLElement).style.background = "rgba(255, 255, 255, 0.05)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.color = "#a1a1a6";
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }
                      }}
                    >
                      <span style={{ color: "inherit", opacity: 0.7 }}>
                        <NavIcon type={item.type} />
                      </span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* STATUS INDICATOR */}
        {!loading && (
          <div style={{
            paddingLeft: "16px",
            paddingRight: "16px",
            paddingBottom: "12px",
            fontSize: "11px",
            color: backendOnline ? "#34c759" : "#ff3b30",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}>
            <div style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: backendOnline ? "#34c759" : "#ff3b30",
              animation: backendOnline ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ fontWeight: 500 }}>
              {backendOnline ? "Live" : "Offline"}
            </span>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0a0908",
        color: "#e5e5e7",
        overflow: "hidden",
      }}>
        {/* TOP BAR */}
        <div style={{
          height: "56px",
          borderBottom: "1px solid #1a1a1f",
          display: "flex",
          alignItems: "center",
          paddingLeft: "32px",
          paddingRight: "32px",
          background: "linear-gradient(90deg, #0f1116 0%, #0a0908 100%)",
        }}>
          <div style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginLeft: "auto",
            fontSize: "12px",
            color: "#8a8a8e",
          }}>
            <span>🌐 Solana</span>
            <span style={{ width: "1px", height: "16px", background: "#1a1a1f" }} />
            <span>● Live</span>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0",
        }}>
          {children}
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        aside::-webkit-scrollbar { width: 6px; }
        aside::-webkit-scrollbar-track { background: transparent; }
        aside::-webkit-scrollbar-thumb { background: #2a2a2f; border-radius: 3px; }
        aside::-webkit-scrollbar-thumb:hover { background: #3a3a3f; }
      `}</style>
    </div>
  );
}
