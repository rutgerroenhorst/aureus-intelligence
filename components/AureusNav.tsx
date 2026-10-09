"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AureusNav() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="nav" style={{ borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
      <div className="nav-inner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}>
        <Link className="brand" href="/radar" style={{ textDecoration: "none", color: "var(--text)", fontWeight: 700, fontSize: "14px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            Aureus
            <small style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
              Intelligence · private alpha
            </small>
          </span>
        </Link>

        <div style={{ display: "flex", gap: "0", flex: 1, marginLeft: "32px" }}>
          {/* DISCOVER */}
          <div style={{ display: "flex", gap: "0" }}>
            <Link 
              href="/radar" 
              className="link"
              aria-current={isActive("/radar") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/radar") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/radar") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Radar
            </Link>
            <Link 
              href="/stream" 
              className="link"
              aria-current={isActive("/stream") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/stream") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/stream") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Stream
            </Link>
          </div>

          {/* INTELLIGENCE */}
          <div style={{ display: "flex", gap: "0", marginLeft: "24px", paddingLeft: "16px", borderLeft: "1px solid var(--border)" }}>
            <Link 
              href="/wallets" 
              className="link"
              aria-current={isActive("/wallets") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/wallets") ? "var(--violet)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/wallets") ? "2px solid var(--violet)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Wallets
            </Link>
            <Link 
              href="/signals" 
              className="link"
              aria-current={isActive("/signals") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/signals") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/signals") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Signals
            </Link>
            <Link 
              href="/forensics" 
              className="link"
              aria-current={isActive("/forensics") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/forensics") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/forensics") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Forensics
            </Link>
          </div>

          {/* PERSONAL */}
          <div style={{ display: "flex", gap: "0", marginLeft: "24px", paddingLeft: "16px", borderLeft: "1px solid var(--border)" }}>
            <Link 
              href="/watchlist" 
              className="link"
              aria-current={isActive("/watchlist") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/watchlist") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/watchlist") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Watchlist
            </Link>
          </div>

          {/* SYSTEM */}
          <div style={{ display: "flex", gap: "0", marginLeft: "24px", paddingLeft: "16px", borderLeft: "1px solid var(--border)" }}>
            <Link 
              href="/ops" 
              className="link"
              aria-current={isActive("/ops") ? "page" : undefined}
              style={{
                padding: "16px 12px",
                color: isActive("/ops") ? "var(--cyan)" : "var(--muted)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 500,
                borderBottom: isActive("/ops") ? "2px solid var(--cyan)" : "2px solid transparent",
                transition: "all 150ms ease",
                cursor: "pointer"
              }}
            >
              Ops
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
