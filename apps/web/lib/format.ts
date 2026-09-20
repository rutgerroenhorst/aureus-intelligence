export function shortMint(mint: string | null | undefined): string {
  if (!mint) return "—";
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

export function usd(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export function num(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

/** Relative age from an ISO/Date to now, compact. */
export function ago(when: string | Date | null | undefined, now: number = Date.now()): string {
  if (!when) return "—";
  const t = typeof when === "string" ? Date.parse(when) : when.getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Freshness band for coloring: fresh < 2m, aging < 15m, else stale. */
export function freshnessBand(when: string | Date | null | undefined, now: number = Date.now()): "fresh" | "aging" | "stale" | "none" {
  if (!when) return "none";
  const t = typeof when === "string" ? Date.parse(when) : when.getTime();
  if (!Number.isFinite(t)) return "none";
  const s = (now - t) / 1000;
  if (s < 120) return "fresh";
  if (s < 900) return "aging";
  return "stale";
}

/** Return fraction (0.34 → "+34%"), signed. */
export function pctRet(v: number | null | undefined, dp = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(dp)}%`;
}

/** Plain percentage (0.8 → "80%"). */
export function pct(v: number | null | undefined, dp = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

export function dexUrl(mint: string, pool?: string | null): string {
  return pool ? `https://dexscreener.com/solana/${pool}` : `https://dexscreener.com/solana/${mint}`;
}
