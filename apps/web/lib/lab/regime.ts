/**
 * The market around the coins: is Solana trading heating up or cooling off? A coin's odds are not the same on a day when volume
 * doubles as on a day when it halves, so the lab records the backdrop and lets the analyses test it like any other feature.
 *
 * Free and keyless: DefiLlama (SOL price history, Solana DEX volume per day, pump.fun's volume), Jupiter (SOL price and its 24 h
 * change), alternative.me (fear and greed) and DexScreener's trending narratives ("metas": AI, dog, cat, x402, ...).
 *
 *   regime_hist  once a day: SOL price every 2 hours and Solana DEX volume per day for the last 40 days (history for the features)
 *   regime       every round at most hourly: today's numbers, the page's "market now" strip
 */

import type { Queryable } from "./builder";
import { fin, getJson, insertRows } from "./collectors";

export interface RegimeHist {
  /** [epoch s, USD] */
  sol: Array<[number, number]>;
  /** [epoch s of the day's start (UTC), USD volume] */
  dex: Array<[number, number]>;
  at: number;
}

export interface RegimeMeta {
  name: string;
  slug: string;
  mcap: number | null;
  volume: number | null;
  tokens: number | null;
  /** market cap change, percent */
  h1: number | null;
  h6: number | null;
  h24: number | null;
}

export interface RegimeNow {
  at: number;
  solUsd: number | null;
  sol24h: number | null;
  dex24h: number | null;
  dexChange1d: number | null;
  dexChange7d: number | null;
  pump24h: number | null;
  pumpChange1d: number | null;
  fng: number | null;
  fngLabel: string | null;
  metas: RegimeMeta[];
}

const DAY = 86_400;

export async function fetchHist(nowS: number): Promise<RegimeHist | null> {
  const [sol, dex] = await Promise.all([
    getJson(`https://coins.llama.fi/chart/coingecko:solana?start=${nowS - 40 * DAY}&span=480&period=2h`, {}, 25_000, 2),
    getJson("https://api.llama.fi/overview/dexs/solana?excludeTotalDataChartBreakdown=true", {}, 30_000, 2),
  ]);
  const solPts = ((sol?.coins?.["coingecko:solana"]?.prices ?? []) as Array<{ timestamp: number; price: number }>).filter((p) => p.price > 0).map((p) => [p.timestamp, p.price] as [number, number]);
  const dexPts = ((dex?.totalDataChart ?? []) as Array<[number, number]>).slice(-60).filter((d) => d[1] > 0);
  if (!solPts.length && !dexPts.length) return null;
  return { sol: solPts, dex: dexPts, at: nowS };
}

export async function fetchNow(nowS: number): Promise<RegimeNow> {
  const [dex, pump, price, fng, metas] = await Promise.all([
    getJson("https://api.llama.fi/overview/dexs/solana?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true", {}, 30_000, 2),
    getJson("https://api.llama.fi/summary/dexs/pump?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true", {}, 30_000, 2),
    getJson("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", {}, 15_000, 2),
    getJson("https://api.alternative.me/fng/?limit=1", {}, 15_000, 1),
    getJson("https://api.dexscreener.com/metas/trending/v1", {}, 15_000, 2),
  ]);
  const sol = price?.So11111111111111111111111111111111111111112;
  return {
    at: nowS,
    solUsd: fin(sol?.usdPrice),
    sol24h: fin(sol?.priceChange24h),
    dex24h: fin(dex?.total24h),
    dexChange1d: fin(dex?.change_1d),
    dexChange7d: fin(dex?.change_7d),
    pump24h: fin(pump?.total24h),
    pumpChange1d: fin(pump?.change_1d),
    fng: fin(Number(fng?.data?.[0]?.value)),
    fngLabel: fng?.data?.[0]?.value_classification ?? null,
    metas: Array.isArray(metas)
      ? (metas as any[]).slice(0, 18).map((m) => ({ name: String(m.name), slug: String(m.slug), mcap: fin(m.marketCap), volume: fin(m.volume), tokens: fin(m.tokenCount), h1: fin(m.marketCapChange?.h1), h6: fin(m.marketCapChange?.h6), h24: fin(m.marketCapChange?.h24) }))
      : [],
  };
}

/**
 * Collect at most hourly (the history part once a day). Returns what was done; a failed source is simply tried next round.
 */
export async function collectRegime(db: Queryable, opts: { force?: boolean } = {}): Promise<{ now?: boolean; hist?: boolean; skipped?: string }> {
  const { rows } = await db.query(
    `SELECT source, EXTRACT(EPOCH FROM (now() - max(taken_at)))::float8 AS age_s FROM lab_signals_ts WHERE source IN ('regime', 'regime_hist') GROUP BY source`,
  );
  const age = (src: string): number => rows.find((r) => r.source === src)?.age_s ?? Infinity;
  const nowS = Date.now() / 1000;
  const out: { now?: boolean; hist?: boolean; skipped?: string } = {};
  if (opts.force || age("regime") > 50 * 60) {
    const n = await fetchNow(nowS);
    if (n.solUsd != null || n.dex24h != null || n.metas.length) {
      await insertRows(db, [{ mint: "_market_", source: "regime", payload: n }]);
      out.now = true;
    }
  }
  if (opts.force || age("regime_hist") > 20 * 3600) {
    const h = await fetchHist(nowS);
    if (h) {
      await insertRows(db, [{ mint: "_market_", source: "regime_hist", payload: h }]);
      // one history row is enough: older ones are dropped
      await db.query(`DELETE FROM lab_signals_ts WHERE source = 'regime_hist' AND taken_at < now() - interval '40 hours'`);
      out.hist = true;
    }
  }
  if (!out.now && !out.hist) out.skipped = "fresh enough";
  return out;
}

const nearest = (pts: Array<[number, number]>, t: number): [number, number] | null => {
  if (!pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]![0] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[Math.max(0, lo - 1)]!;
  return Math.abs(a[0] - t) <= Math.abs(b[0] - t) ? a : b;
};

export interface RegimeFeatures {
  regime_sol_24h: number | null;
  regime_dex_vol: number | null;
}

/** The backdrop at epoch second `t`: SOL's change over the 24 hours before, and the previous full day's Solana DEX volume against the average of the 7 days before it. */
export function regimeAt(hist: RegimeHist | null | undefined, t: number): RegimeFeatures {
  if (!hist) return { regime_sol_24h: null, regime_dex_vol: null };
  let sol: number | null = null;
  const a = nearest(hist.sol, t);
  const b = nearest(hist.sol, t - DAY);
  // both ends must really be inside the history (within 3 hours), or the number would be a guess
  if (a && b && Math.abs(a[0] - t) <= 3 * 3600 && Math.abs(b[0] - (t - DAY)) <= 3 * 3600 && b[1] > 0) sol = (a[1] / b[1] - 1) * 100;
  let dexRatio: number | null = null;
  const lastDay = Math.floor(t / DAY) * DAY - DAY;
  const byDay = new Map(hist.dex.map((d) => [d[0], d[1]]));
  const prev = Array.from({ length: 7 }, (_, k) => byDay.get(lastDay - (k + 1) * DAY)).filter((v): v is number => v != null && v > 0);
  const vol = byDay.get(lastDay);
  if (vol != null && prev.length >= 5) dexRatio = vol / (prev.reduce((s, v) => s + v, 0) / prev.length);
  return { regime_sol_24h: sol, regime_dex_vol: dexRatio };
}
