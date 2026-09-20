/**
 * Research paper-tracking measurement — pure analysis over the price/liquidity/
 * volume time-series already collected. No new signals or data sources.
 *
 * Anti-look-ahead: only points inside [anchor, min(now, target)] are used; points
 * after the horizon are never read. `windowComplete` is true only once `now` has
 * passed the horizon.
 */
export interface SeriesPoint {
  atMs: number;
  price: number;
  liquidityUsd?: number | null;
  volumeUsd?: number | null;
}

export const RESEARCH_HORIZONS: Array<{ key: string; ms: number }> = [
  { key: "m15", ms: 15 * 60_000 },
  { key: "m30", ms: 30 * 60_000 },
  { key: "h1", ms: 60 * 60_000 },
  { key: "h2", ms: 2 * 60 * 60_000 },
  { key: "h4", ms: 4 * 60 * 60_000 },
  { key: "h8", ms: 8 * 60 * 60_000 },
  { key: "h24", ms: 24 * 60 * 60_000 },
  { key: "d3", ms: 3 * 24 * 60 * 60_000 },
  { key: "d7", ms: 7 * 24 * 60 * 60_000 },
];

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface PaperPoint {
  horizon: string;
  anchorAtMs: number;
  targetAtMs: number;
  anchorPrice: number;
  price: number | null;
  returnPct: number | null;
  maxDrawdownPct: number | null;
  maxRunupPct: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  windowComplete: boolean;
}

function sortSeries(series: SeriesPoint[]): SeriesPoint[] {
  return [...series].filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.atMs - b.atMs);
}

export function computePaperTracking(seriesRaw: SeriesPoint[], discoveryAtMs: number, nowMs: number): PaperPoint[] {
  const series = sortSeries(seriesRaw);
  if (series.length === 0) return [];
  const anchor = series.find((p) => p.atMs >= discoveryAtMs) ?? series[0]!;
  const anchorAtMs = anchor.atMs;
  const anchorPrice = anchor.price;

  return RESEARCH_HORIZONS.map(({ key, ms }) => {
    const targetAtMs = anchorAtMs + ms;
    const windowEnd = Math.min(nowMs, targetAtMs);
    const inWin = series.filter((p) => p.atMs >= anchorAtMs && p.atMs <= windowEnd);
    const windowComplete = nowMs >= targetAtMs;
    if (inWin.length === 0) {
      return { horizon: key, anchorAtMs, targetAtMs, anchorPrice, price: null, returnPct: null, maxDrawdownPct: null, maxRunupPct: null, liquidityUsd: null, volumeUsd: null, windowComplete };
    }
    const prices = inWin.map((p) => p.price);
    const last = inWin[inWin.length - 1]!;
    const liq = inWin.map((p) => p.liquidityUsd).filter((v): v is number => v != null);
    const vol = inWin.map((p) => p.volumeUsd).filter((v): v is number => v != null);
    return {
      horizon: key, anchorAtMs, targetAtMs, anchorPrice,
      price: last.price,
      returnPct: round(last.price / anchorPrice - 1),
      maxDrawdownPct: round(Math.min(...prices) / anchorPrice - 1),
      maxRunupPct: round(Math.max(...prices) / anchorPrice - 1),
      liquidityUsd: last.liquidityUsd ?? null,
      volumeUsd: vol.length ? Math.max(...vol) : null,
      windowComplete,
      ...(liq.length ? {} : {}),
    };
  });
}

export interface ResearchSummary {
  discoveryPrice: number | null;
  discoveryLiquidityUsd: number | null;
  discoveryVolumeUsd: number | null;
  observations: number;
  finalReturnPct: number | null;
  return24hPct: number | null;
  window24hComplete: boolean;
  peakReturnPct: number | null;
  maxDrawdownPct: number | null;
  timeToPeakS: number | null;
  liquidityGrowthPct: number | null;
  volumeGrowthPct: number | null;
  lifespanS: number | null;
  isRug: boolean;
}

export function computeResearchSummary(seriesRaw: SeriesPoint[], discoveryAtMs: number, nowMs: number): ResearchSummary {
  const series = sortSeries(seriesRaw);
  const empty: ResearchSummary = {
    discoveryPrice: null, discoveryLiquidityUsd: null, discoveryVolumeUsd: null, observations: 0,
    finalReturnPct: null, return24hPct: null, window24hComplete: false, peakReturnPct: null,
    maxDrawdownPct: null, timeToPeakS: null, liquidityGrowthPct: null, volumeGrowthPct: null,
    lifespanS: null, isRug: false,
  };
  if (series.length === 0) return empty;

  const anchor = series.find((p) => p.atMs >= discoveryAtMs) ?? series[0]!;
  const anchorPrice = anchor.price;
  const anchorLiq = anchor.liquidityUsd ?? null;
  const anchorVol = anchor.volumeUsd ?? null;
  const inRange = series.filter((p) => p.atMs >= anchor.atMs);
  const last = inRange[inRange.length - 1]!;
  const prices = inRange.map((p) => p.price);
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const peakPoint = inRange.find((p) => p.price === maxP)!;
  const liqs = inRange.map((p) => p.liquidityUsd).filter((v): v is number => v != null);
  const vols = inRange.map((p) => p.volumeUsd).filter((v): v is number => v != null);

  // 24h return from paper tracking
  const h24 = computePaperTracking(series, discoveryAtMs, nowMs).find((p) => p.horizon === "h24")!;

  // Rug: liquidity collapsed to <10% of discovery liquidity.
  let isRug = false;
  let lifespanS: number | null = last.atMs - anchor.atMs > 0 ? Math.round((last.atMs - anchor.atMs) / 1000) : null;
  if (anchorLiq != null && anchorLiq > 0 && liqs.length) {
    const minLiq = Math.min(...liqs);
    if (minLiq < anchorLiq * 0.1) {
      isRug = true;
      const deathPoint = inRange.find((p) => p.liquidityUsd != null && p.liquidityUsd < anchorLiq * 0.1);
      if (deathPoint) lifespanS = Math.round((deathPoint.atMs - anchor.atMs) / 1000);
    }
  }

  return {
    discoveryPrice: anchorPrice,
    discoveryLiquidityUsd: anchorLiq,
    discoveryVolumeUsd: anchorVol,
    observations: inRange.length,
    finalReturnPct: round(last.price / anchorPrice - 1),
    return24hPct: h24.returnPct,
    window24hComplete: h24.windowComplete,
    peakReturnPct: round(maxP / anchorPrice - 1),
    maxDrawdownPct: round(minP / anchorPrice - 1),
    timeToPeakS: Math.round((peakPoint.atMs - anchor.atMs) / 1000),
    liquidityGrowthPct: anchorLiq && anchorLiq > 0 && liqs.length ? round(Math.max(...liqs) / anchorLiq - 1) : null,
    volumeGrowthPct: anchorVol && anchorVol > 0 && vols.length ? round(Math.max(...vols) / anchorVol - 1) : null,
    lifespanS,
    isRug,
  };
}
