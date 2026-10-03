"use client";
import { PageHeader, EmptyState } from "@/components/PremiumUI";

const WatchlistGraphic = () => (
  <svg style={{ position: "absolute", right: "-100px", bottom: "-100px", opacity: 0.07, width: "500px", height: "500px" }} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="watchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#20E7A3" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#2585FF" stopOpacity="0.2" />
      </linearGradient>
    </defs>
    <path d="M200 50 L350 150 L300 300 L100 300 L50 150 Z" fill="none" stroke="url(#watchGrad)" strokeWidth="2" opacity="0.6" />
    <circle cx="200" cy="180" r="60" fill="none" stroke="#20E7A3" strokeWidth="1.5" opacity="0.4" />
    <path d="M200 120 L200 240" stroke="#2585FF" strokeWidth="1" opacity="0.3" />
    <path d="M140 180 L260 180" stroke="#2585FF" strokeWidth="1" opacity="0.3" />
  </svg>
);

export default function WatchlistPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-base)", position: "relative", overflow: "hidden" }}>
      <WatchlistGraphic />
      <div style={{ position: "relative", zIndex: 1, padding: "40px 32px", borderBottom: "1px solid var(--border-color)" }}>
        <PageHeader
          title="Token Watchlist"
          subtitle="Tokens you're monitoring. Saved for easy access and tracking."
        />
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 32px" }}>
        <EmptyState
          title="Watchlist is empty"
          description="Add tokens from Radar to track them here and monitor price movements and wallet activity."
        />
      </div>
    </div>
  );
}
