/**
 * Statistics behind the Self-Optimizer. Pure functions, no I/O, so they can be tested.
 *
 * Coins on the Radar are 1-48 hours old, so age is bucketed in HOURS (the first version used days, which put
 * nearly every coin into one bucket and made "age-aware" learning a no-op).
 */

export interface AgeBucket { name: string; minH: number; maxH: number }

export const AGE_BUCKETS: AgeBucket[] = [
  { name: "<2h", minH: 0, maxH: 2 },
  { name: "2-6h", minH: 2, maxH: 6 },
  { name: "6-12h", minH: 6, maxH: 12 },
  { name: "12-24h", minH: 12, maxH: 24 },
  { name: "24-48h", minH: 24, maxH: 48 },
  { name: "48h+", minH: 48, maxH: 100_000 },
];

/** A SQL CASE expression that names the bucket of a column holding minutes. */
export function bucketCaseSql(minutesColumn: string): string {
  const arms = AGE_BUCKETS.slice(0, -1).map((b) => `WHEN ${minutesColumn} < ${b.maxH * 60} THEN '${b.name}'`);
  return `CASE ${arms.join(" ")} ELSE '${AGE_BUCKETS[AGE_BUCKETS.length - 1]!.name}' END`;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export type Direction = "higher" | "lower";

export interface Sample { value: number; win: boolean }

export interface Suggestion {
  /** the cut-off that works best */
  threshold: number;
  /** what the coins in this group let in today: the lowest (higher-is-better) or highest value seen */
  currentEdge: number;
  /** winners among ALL coins in the group, 0-100 */
  baseRate: number;
  /** winners among the coins that pass the cut-off, 0-100 */
  passRate: number;
  passers: number;
  total: number;
  /** 0-100; how unlikely this lift is by chance, after correcting for the number of cut-offs tried */
  confidence: number;
}

const MIN_TOTAL = 10;
const MIN_PER_SIDE = 5;
const MIN_LIFT = 0.1;
const MIN_CONFIDENCE = 50;
const QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * Find the single cut-off on one metric that most improves the win rate, or null when nothing credible exists.
 * The baseline is the win rate of the group itself (what you get with no extra filter). A cut-off must keep at
 * least half of the winners and at least 30% of the coins, so it cannot "win" by throwing almost everything away,
 * and its confidence is corrected for having tried nine cut-offs.
 */
export function bestThreshold(samples: Sample[], direction: Direction): Suggestion | null {
  const rows = samples.filter((s) => Number.isFinite(s.value));
  const total = rows.length;
  const winners = rows.filter((r) => r.win).length;
  if (total < MIN_TOTAL || winners < MIN_PER_SIDE || total - winners < MIN_PER_SIDE) return null;

  const base = winners / total;
  const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
  const cuts = [...new Set(QUANTILES.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!))];

  let best: Suggestion | null = null;
  for (const t of cuts) {
    const passing = rows.filter((r) => (direction === "higher" ? r.value >= t : r.value <= t));
    const passWinners = passing.filter((r) => r.win).length;
    if (passing.length < Math.max(MIN_PER_SIDE, Math.ceil(total * 0.3))) continue;
    if (passWinners < Math.ceil(winners * 0.5)) continue;
    const rate = passWinners / passing.length;
    const lift = rate - base;
    if (lift < MIN_LIFT) continue;
    const se = Math.sqrt((base * (1 - base)) / passing.length);
    const pValue = se > 0 ? 1 - normalCdf(lift / se) : 1;
    const confidence = (1 - Math.min(1, pValue * cuts.length)) * 100;
    if (confidence < MIN_CONFIDENCE) continue;
    if (!best || lift > best.passRate / 100 - best.baseRate / 100) {
      best = {
        threshold: t,
        currentEdge: direction === "higher" ? sorted[0]! : sorted[sorted.length - 1]!,
        baseRate: base * 100,
        passRate: rate * 100,
        passers: passing.length,
        total,
        confidence,
      };
    }
  }
  return best;
}
