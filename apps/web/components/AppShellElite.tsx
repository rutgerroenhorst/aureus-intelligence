"use client";
import React, { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePolling, msSinceTouch, DEFAULT_DEEP_IDLE_AFTER_MS, SCAN_DONE_EVENT } from "@/lib/usePolling";

interface AppShellEliteProps {
  children: ReactNode;
}

// Each instance needs its own gradient id: a gradient defined inside a display:none SVG (the sidebar on
// phones) cannot be referenced from another SVG, which made the top-bar logo disappear.
const AureusLogo = ({ id = "aGrad" }: { id?: string }) => (
  <svg viewBox="0 0 40 40" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2585FF" />
        <stop offset="100%" stopColor="#35DCFF" />
      </linearGradient>
    </defs>
    <path d="M 8 32 L 20 8 L 32 32 M 14 24 L 26 24" stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke={`url(#${id})`} strokeWidth="1" opacity="0.3"/>
  </svg>
);

const NavIcon = ({ type }: { type: string }) => {
  const iconProps = { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "radar":
      return <svg {...iconProps}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/></svg>;
    case "elite":
      return <svg {...iconProps}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
    case "tier1":
      return <svg {...iconProps}><path d="M12 2L2 7L2 17C2 20.3137 6.47715 23 12 23C17.5228 23 22 20.3137 22 17L22 7L12 2Z" fill="none"/><path d="M12 2L22 7L22 17" stroke="currentColor" strokeWidth="2"/></svg>;
    case "stream":
      return <svg {...iconProps}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "signals":
      return <svg {...iconProps}><polyline points="12 2 15 10 23 13 16 18 18 26 12 21 6 26 8 18 1 13 9 10 12 2" /></svg>;
    case "results":
      return <svg {...iconProps}><path d="M 4 14 L 8 8 L 12 11 L 16 6 L 20 10 L 20 20 L 4 20 Z"/></svg>;
    case "learning":
      return <svg {...iconProps}><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm0-12c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"/></svg>;
    case "forensics":
      return <svg {...iconProps}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
    case "wallets":
      return <svg {...iconProps}><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>;
    case "watchlist":
      return <svg {...iconProps}><polygon points="12 2 15.09 10.26 23.77 11.27 17.88 17.14 19.54 25.88 12 21.77 4.46 25.88 6.12 17.14 0.23 11.27 8.91 10.26"/></svg>;
    case "ops":
      return <svg {...iconProps}><circle cx="6" cy="6" r="1"/><circle cx="18" cy="6" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="18" cy="18" r="1"/></svg>;
    case "more":
      return <svg {...iconProps}><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>;
    default:
      return null;
  }
};

type HealthLevel = "unknown" | "ok" | "scanning" | "stale" | "down";
interface Health {
  level: HealthLevel;
  label: string;
}

const HEALTH_COLOR: Record<HealthLevel, string> = {
  unknown: "#8a8a8e",
  ok: "#34c759",
  scanning: "#30b0c0",
  stale: "#ff9f0a",
  down: "#ff3b30",
};

const formatAge = (min: number) => (min < 90 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);

interface JobInfo { running: boolean; due: boolean }
interface Telemetry {
  lastWorkerCycleAt?: string | null;
  scan?: { lastScanAt: string | null; scan: JobInfo; learning: JobInfo; storage?: { full: boolean } } | null;
}

// "Live" must mean the market was actually scanned recently, not that a worker ran once at some point.
// The age shown is the age of the last SCAN. The Radar's own "Refreshed" time is only when the screen last
// asked for data, which is a different clock; the two used to be mixed up.
function describeHealth(t: Telemetry, scanning: boolean): Health {
  if (scanning) return { level: "scanning", label: "Scanning…" };
  if (t.scan?.storage?.full) return { level: "down", label: "Scan paused: storage full" };
  const last = t.lastWorkerCycleAt ? new Date(t.lastWorkerCycleAt).getTime() : NaN;
  if (Number.isNaN(last)) return { level: "down", label: "No scan yet" };
  const min = Math.max(0, Math.round((Date.now() - last) / 60_000));
  if (min <= 20) return { level: "ok", label: min < 1 ? "Live · just scanned" : `Live · scan ${formatAge(min)} ago` };
  if (min <= 90) return { level: "stale", label: `Scan ${formatAge(min)} ago` };
  return { level: "down", label: `Last scan ${formatAge(min)} ago` };
}

const primaryNav = [
  { label: "Radar", href: "/radar", type: "radar" },
  { label: "Elite", href: "/elite", type: "elite" },
  { label: "Results", href: "/results", type: "results" },
  { label: "Signals", href: "/signals", type: "signals" },
];

const moreNav = [
  { label: "Stream", href: "/stream", type: "stream" },
  { label: "Learning", href: "/learning", type: "learning" },
  { label: "Forensics", href: "/forensics", type: "forensics" },
  { label: "Wallets", href: "/wallets", type: "wallets" },
  { label: "Watchlist", href: "/watchlist", type: "watchlist" },
  { label: "Ops", href: "/ops", type: "ops" },
];

export default function AppShellElite({ children }: AppShellEliteProps) {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health>({ level: "unknown", label: "" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const wasScanning = useRef(false);
  const askedAt = useRef(0);

  // Once a minute, and only while the screen is visible (was every 10 s, always). While a scan is running it
  // checks every few seconds so the dot flips to "Live" as soon as the new data is in.
  usePolling(
    async () => {
      try {
        const res = await fetch("/api/telemetry", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const t: Telemetry = await res.json();
        let busy = Boolean(t.scan?.scan.running);
        // The site scans the market itself, but only while someone has it open: when the data is due, ask for a
        // tick. The server decides (lease) whether anything really starts, so asking from every device is safe.
        // Not for a screen that has been on but untouched for 15 minutes (an iPad on a stand): it would keep the market
        // scanned for nobody, and scanning is what spends the free CPU. Touching the screen brings it back at once.
        const attended = msSinceTouch() < DEFAULT_DEEP_IDLE_AFTER_MS;
        if (attended && t.scan && !busy && (t.scan.scan.due || t.scan.learning.due) && Date.now() - askedAt.current > 30_000) {
          askedAt.current = Date.now();
          try {
            const r = await fetch("/api/scan", { method: "POST" });
            const started: string[] = r.ok ? (await r.json()).started ?? [] : [];
            busy = started.includes("scan");
          } catch {
            /* the next minute tries again */
          }
        }
        if (wasScanning.current && !busy) window.dispatchEvent(new Event(SCAN_DONE_EVENT));
        wasScanning.current = busy;
        setScanning(busy);
        setHealth(describeHealth(t, busy));
      } catch {
        setHealth({ level: "down", label: "Offline" });
      }
    },
    scanning ? 6_000 : 60_000,
    scanning ? { idleIntervalMs: 6_000 } : {},
  );

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const mainNav = [
    { label: "Radar", href: "/radar", type: "radar", group: "Core" },
    { label: "Elite", href: "/elite", type: "elite", group: "Core" },
    { label: "Results", href: "/results", type: "results", group: "Core" },
    { label: "Stream", href: "/stream", type: "stream", group: "Data" },
    { label: "Signals", href: "/signals", type: "signals", group: "Data" },
    { label: "Learning", href: "/learning", type: "learning", group: "Data" },
    { label: "Forensics", href: "/forensics", type: "forensics", group: "Analysis" },
    { label: "Wallets", href: "/wallets", type: "wallets", group: "Analysis" },
    { label: "Watchlist", href: "/watchlist", type: "watchlist", group: "Tracking" },
    { label: "Ops", href: "/ops", type: "ops", group: "Tracking" },
  ];

  const isActive = (href: string) => pathname === href;
  const groups = Array.from(new Set(mainNav.map(n => n.group)));
  const healthColor = HEALTH_COLOR[health.level];
  const moreActive = moreNav.some((n) => isActive(n.href));

  return (
    <div className="ae-root" style={{ display: "flex", height: "100vh", background: "#0a0908", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* PREMIUM SIDEBAR (desktop / tablet landscape) */}
      <aside className="ae-aside" style={{
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
        {health.level !== "unknown" && (
          <div style={{
            paddingLeft: "16px",
            paddingRight: "16px",
            paddingBottom: "12px",
            fontSize: "11px",
            color: healthColor,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}>
            <div style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: healthColor,
              animation: health.level === "ok" || health.level === "scanning" ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ fontWeight: 500 }}>{health.label}</span>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <main className="ae-main" style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0a0908",
        color: "#e5e5e7",
        overflow: "hidden",
      }}>
        {/* TOP BAR */}
        <div className="ae-topbar" style={{
          height: "56px",
          borderBottom: "1px solid #1a1a1f",
          display: "flex",
          alignItems: "center",
          paddingLeft: "32px",
          paddingRight: "32px",
          background: "linear-gradient(90deg, #0f1116 0%, #0a0908 100%)",
        }}>
          <div className="ae-top-logo">
            <AureusLogo id="aGradTop" />
            <span>AUREUS</span>
          </div>
          <div style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginLeft: "auto",
            fontSize: "12px",
            color: "#8a8a8e",
          }}>
            <span className="ae-top-solana">🌐 Solana</span>
            <span className="ae-top-sep" style={{ width: "1px", height: "16px", background: "#1a1a1f" }} />
            {health.level !== "unknown" && (
              <span style={{ color: healthColor }}>● {health.label}</span>
            )}
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="ae-content" style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0",
        }}>
          {children}
        </div>
      </main>

      {/* MOBILE: bottom tab bar + "More" sheet (hidden on wide screens by mobile.css) */}
      {moreOpen && <div className="ae-sheet-backdrop" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="ae-sheet" role="dialog" aria-label="More pages">
          {moreNav.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>
              <NavIcon type={item.type} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      )}
      <nav className="ae-bottomnav" aria-label="Main">
        {primaryNav.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>
            <NavIcon type={item.type} />
            <span>{item.label}</span>
          </Link>
        ))}
        <button type="button" className={moreActive || moreOpen ? "active" : ""} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
          <NavIcon type="more" />
          <span>More</span>
        </button>
      </nav>

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
