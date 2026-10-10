import type { Rate } from "@/lib/lab/reports/common";

export const pct = (p: number | null | undefined, d = 0): string => (p == null || !Number.isFinite(p) ? "–" : `${(p * 100).toFixed(d)}%`);
/** One decimal below 10%, none above: 3.4% but 18%. */
export const pctS = (p: number | null | undefined): string => (p == null || !Number.isFinite(p) ? "–" : pct(p, p < 0.1 ? 1 : 0));
export const range = (r: Rate | null | undefined): string => (r && r.n > 0 ? `${pct(r.lo)} to ${pct(r.hi)}` : "–");

/** A result as a multiple of the stake (1.0 = break even) written as a signed percentage. */
export const evText = (m: number | null | undefined): string => {
  if (m == null || !Number.isFinite(m)) return "–";
  const v = (m - 1) * 100;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
};
export const evTone = (m: number | null | undefined): string => (m == null ? "dim" : m >= 1 ? "good" : "bad");

export const tauText = (tau: number): string => (tau === 0 ? "First look" : `+${tau} h`);

export const ago = (iso: string | null | undefined): string => {
  if (!iso) return "never";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "just now" : min < 90 ? `${min} min ago` : min < 2880 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

export const usd = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${v.toFixed(0)}`;
};

export const hours = (h: number | null | undefined): string => (h == null ? "–" : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);
