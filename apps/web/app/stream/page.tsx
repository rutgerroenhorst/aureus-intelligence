"use client";
import { useEffect, useState } from "react";
import { PageHeader, EmptyState, StatusBadge } from "@/components/PremiumUI";

interface StreamEvent {
  id: string;
  symbol: string | null;
  status: string;
  timestamp: number;
  marketCapUsd: number | null;
  eventType: string;
}

const StreamOfflineState = () => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)", position: "relative", overflow: "hidden" }}>
    {/* Timeline graphic background */}
    <svg style={{ position: "absolute", left: "50%", top: 0, width: "2px", height: "100%", transform: "translateX(-50%)", opacity: 0.08 }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="timelineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--blue-electric)" />
          <stop offset="50%" stopColor="var(--cyan-ice)" />
          <stop offset="100%" stopColor="var(--blue-electric)" />
        </linearGradient>
      </defs>
      <line x1="1" y1="0" x2="1" y2="100%" stroke="url(#timelineGrad)" strokeWidth="2" />
    </svg>

    <div style={{ padding: "40px 32px 24px", borderBottom: "1px solid var(--border-color)", position: "relative", zIndex: 1 }}>
      <PageHeader
        title="Live Event Stream"
        subtitle="Real-time chronological discovery and structural evaluation events."
      />
    </div>

    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 32px", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", maxWidth: "520px" }}>
        <div style={{ fontSize: "40px", opacity: 0.12, marginBottom: "20px" }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--blue-electric)" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
            <polyline points="17 6 23 6 23 12"></polyline>
          </svg>
        </div>
        <h2 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "12px" }}>
          Live feed disconnected
        </h2>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "28px" }}>
          Waiting for Aureus backend connection. Token discoveries and evaluation events will appear here as they flow through the system.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 600 }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#FF546A" }} />
          Connection unavailable
        </div>
      </div>
    </div>
  </div>
);

export default function StreamPage() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const allEvents: StreamEvent[] = [];
          const seen = new Set<string>();
          const sections = Object.values(data.sections || {}) as any[];
          sections.forEach((section: any) => {
            if (Array.isArray(section)) {
              section.forEach((c: any) => {
                const symbol = c.symbol || c.mint;
                if (!seen.has(symbol)) {
                  seen.add(symbol);
                  allEvents.push({
                    id: c.id,
                    symbol: c.symbol,
                    status: c.v2StructuralStatus || "UNKNOWN",
                    timestamp: c.discoveredAt ? new Date(c.discoveredAt).getTime() : Date.now(),
                    marketCapUsd: c.marketCapUsd,
                    eventType: "Discovery",
                  });
                }
              });
            }
          });
          setEvents(allEvents.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100));
        }
      } catch (err) {
        console.error("Failed to fetch events:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
    const poll = setInterval(fetchEvents, 30_000);
    return () => clearInterval(poll);
  }, []);

  const getTimeAgo = (timestamp: number) => {
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (loading || events.length === 0) {
    return <StreamOfflineState />;
  }

  return (
    <>
      <div style={{ padding: "24px 32px", borderBottom: "1px solid #2a2a3e", marginBottom: "24px" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px 0", color: "#fff" }}>Live Event Stream</h2>
        <p style={{ fontSize: "14px", color: "#8a8a9e", margin: 0 }}>Real-time coin discovery events</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "900px", paddingLeft: "32px", paddingRight: "32px" }}>
        {events.map((event) => (
            <div
              key={event.id}
              style={{
                padding: "18px 20px",
                background: "linear-gradient(180deg, rgba(6, 23, 42, 0.8) 0%, var(--bg-raised) 100%)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                display: "grid",
                gridTemplateColumns: "100px 1fr auto",
                gap: "20px",
                alignItems: "center",
                transition: "all 160ms ease",
                position: "relative",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "linear-gradient(180deg, var(--bg-interactive) 0%, var(--bg-elevated) 100%)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color-highlight)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(37, 133, 255, 0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "linear-gradient(180deg, rgba(6, 23, 42, 0.8) 0%, var(--bg-raised) 100%)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  textAlign: "right",
                  fontWeight: 600,
                }}
              >
                {getTimeAgo(event.timestamp)}
              </div>

              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "4px",
                  }}
                >
                  {event.symbol || "Unknown"}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  {event.marketCapUsd ? `$${(event.marketCapUsd / 1e6).toFixed(2)}M` : "—"} mcap • {event.status}
                </div>
              </div>

              <StatusBadge status={event.status as any} />
            </div>
          ))}
      </div>
    </>
  );
}
