/**
 * How pump.fun graduations end, read from the lab's own price readings (no waiting for the 72-hour lessons).
 *
 * Three kinds of "graduation" turned out to be very different things once the first hours of the event stream were read:
 *
 *   born      the creator bought the whole bonding curve (about 85 SOL) in the creating transaction, so the coin graduated within minutes.
 *             The pool opens with real money (tens of thousands of dollars), the price often climbs for a while, and then the creator
 *             sells into it: the pool is emptied (the liquidity tokens are burned, so it is not a classic liquidity pull; the pool is simply
 *             sold dry).
 *   mayhem    launched in Mayhem Mode (an AI agent trades it for 24 hours). Their "graduation" leaves a pool holding a few dollars.
 *   organic   a launch that graduated after real buyers filled the curve.
 *
 * Everything here is descriptive: the share of each kind that ended in a drained pool, measured on what the lab saw. The pre-registered
 * hypotheses (H7-H9) are judged separately, on the 72-hour lessons, only on coins first seen after they were written down.
 */

import { median } from "./stats";

export type GradKind = "born" | "mayhem" | "organic" | "unknown";

export interface GradFacts {
  createToMigrateMin: number | null;
  devBuySol: number | null;
  mayhem: boolean | null;
}

/** One price reading of the watch list (USD price, USD liquidity, USD market cap). */
export interface Reading {
  /** seconds since the epoch */
  t: number;
  p: number | null;
  liq: number | null;
  mcap: number | null;
}

/** A pool that never held real money, and one that held some and was emptied. */
export const EMPTY_LIQ = 1_000;
export const REAL_LIQ = 10_000;
export const DRAINED_BELOW = 5_000;
export const DRAINED_SHARE = 0.1;
/** The one-hour judgement reads the first reading taken between these minutes after graduation. */
export const JUDGE_FROM_MIN = 55;
export const JUDGE_TO_MIN = 100;

export function gradKind(g: GradFacts): GradKind {
  if (g.mayhem === true) return "mayhem";
  if (g.createToMigrateMin == null) return "unknown";
  if (g.createToMigrateMin < 2 && (g.devBuySol ?? 0) >= 50) return "born";
  return "organic";
}

export interface GradFate {
  reads: number;
  firstLiq: number | null;
  lastLiq: number | null;
  maxLiq: number | null;
  firstP: number | null;
  lastP: number | null;
  /** highest price reading over the first reading (the run-up a buyer at the first reading could have seen) */
  peakMultiple: number | null;
  /** the pool never held real money: first liquidity reading under $1,000 */
  empty: boolean;
  /** the pool held at least $10K at some reading and later fell under 10% of that peak and under $5K */
  drained: boolean;
  /** minutes after graduation of the first reading that showed it drained */
  drainedAfterMin: number | null;
  /** the state at about one hour after graduation; null when no reading exists in that window (too young, or not read then) */
  at1h: null | { liq: number | null; p: number | null; drained: boolean; halved: boolean; above: boolean };
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** `migratedAt` and the readings' times are in seconds. Readings need not be sorted. */
export function gradFate(migratedAt: number, readings: Reading[]): GradFate {
  const rs = readings.filter((r) => fin(r.t)).sort((a, b) => a.t - b.t);
  const withLiq = rs.filter((r) => fin(r.liq));
  const withP = rs.filter((r) => fin(r.p) && (r.p as number) > 0);
  const firstLiq = withLiq[0]?.liq ?? null;
  const lastLiq = withLiq.length ? (withLiq[withLiq.length - 1].liq as number) : null;
  const firstP = withP[0]?.p ?? null;
  const lastP = withP.length ? (withP[withP.length - 1].p as number) : null;
  let peak = 0;
  let drainedAt: number | null = null;
  const drainedBy: boolean[] = []; // per liquidity reading: already drained at or before it
  for (const r of withLiq) {
    peak = Math.max(peak, r.liq as number);
    if (drainedAt == null && peak >= REAL_LIQ && (r.liq as number) < DRAINED_SHARE * peak && (r.liq as number) < DRAINED_BELOW) drainedAt = r.t;
    drainedBy.push(drainedAt != null);
  }
  const maxLiq = withLiq.length ? peak : null;
  const maxP = withP.length ? Math.max(...withP.map((r) => r.p as number)) : null;
  let at1h: GradFate["at1h"] = null;
  const j = rs.find((r) => r.t - migratedAt >= JUDGE_FROM_MIN * 60 && r.t - migratedAt <= JUDGE_TO_MIN * 60 && (fin(r.p) || fin(r.liq)));
  if (j) {
    const drained = drainedAt != null && drainedAt <= j.t;
    const p =fin(j.p) && (j.p as number) > 0 ? (j.p as number) : null;
    at1h = { liq: fin(j.liq) ? j.liq : null, p, drained, halved: p != null && firstP != null && p <= 0.5 * firstP, above: p != null && firstP != null && p >= firstP };
  }
  return {
    reads: rs.length,
    firstLiq,
    lastLiq,
    maxLiq,
    firstP,
    lastP,
    peakMultiple: maxP != null && firstP != null ? maxP / firstP : null,
    empty: firstLiq != null && firstLiq < EMPTY_LIQ,
    drained: drainedAt != null,
    drainedAfterMin: drainedAt != null ? (drainedAt - migratedAt) / 60 : null,
    at1h,
  };
}

export interface KindSummary {
  kind: GradKind;
  /** graduations with at least one reading */
  n: number;
  /** pools that never held real money (first liquidity under $1,000) */
  empty: number;
  /** pools that held at least $10K at some reading: the base of the "drained" figures */
  realPools: number;
  /** of those, how many were emptied by the time of the last reading */
  drained: number;
  /** judged at about one hour (a reading exists 55-100 minutes after graduation), among pools that were real */
  judged1h: number;
  drained1h: number;
  halved1h: number;
  above1h: number;
  /** median of the highest price seen over the first reading, among real pools */
  medianPeakMultiple: number | null;
  /** median minutes from graduation to the first reading that showed the pool drained */
  medianDrainMin: number | null;
}

export function summarizeFates(rows: Array<{ kind: GradKind; fate: GradFate }>): KindSummary[] {
  const kinds: GradKind[] = ["born", "mayhem", "organic", "unknown"];
  const out: KindSummary[] = [];
  for (const kind of kinds) {
    const mine = rows.filter((r) => r.kind === kind && r.fate.reads > 0);
    if (!mine.length) continue;
    const real = mine.filter((r) => !r.fate.empty && (r.fate.maxLiq ?? 0) >= REAL_LIQ);
    const judged = real.filter((r) => r.fate.at1h != null);
    const peaks = real.map((r) => r.fate.peakMultiple).filter((x): x is number => x != null);
    const drains = mine.map((r) => r.fate.drainedAfterMin).filter((x): x is number => x != null);
    out.push({
      kind,
      n: mine.length,
      empty: mine.filter((r) => r.fate.empty).length,
      realPools: real.length,
      drained: real.filter((r) => r.fate.drained).length,
      judged1h: judged.length,
      drained1h: judged.filter((r) => r.fate.at1h!.drained).length,
      halved1h: judged.filter((r) => r.fate.at1h!.halved).length,
      above1h: judged.filter((r) => r.fate.at1h!.above).length,
      medianPeakMultiple: peaks.length >= 3 ? median(peaks) : null,
      medianDrainMin: drains.length >= 3 ? median(drains) : null,
    });
  }
  return out;
}

/**
 * Plain-language flags for one graduation, strongest first. `fate` may be null for a coin without readings yet.
 * Kept free of numbers that need the summary: the page adds the measured rates next to them.
 */
export function gradFlags(kind: GradKind, fate: GradFate | null, extra: { creatorLaunches72h?: number | null; devBuySol?: number | null; gone?: boolean } = {}): string[] {
  const f: string[] = [];
  if (fate?.drained) f.push("pool drained");
  else if (fate?.empty) f.push("empty pool");
  if (kind === "born") f.push("born graduated: the creator bought the whole curve");
  if (kind === "mayhem") f.push("Mayhem Mode");
  if ((extra.creatorLaunches72h ?? 0) >= 5) f.push(`serial creator (${extra.creatorLaunches72h} launches in 72 h)`);
  if (kind !== "born" && (extra.devBuySol ?? 0) >= 5) f.push(`creator bought ${Math.round(extra.devBuySol ?? 0)} SOL at launch`);
  if (fate?.firstP && fate.lastP && fate.lastP / fate.firstP < 0.5 && !fate.drained) f.push("down more than half since first seen");
  if (extra.gone) f.push("no longer listed");
  return f;
}

/** A graduation worth showing by default: a real pool, still standing, not one of the kinds that are measured to end in a drain. */
export function isHealthy(kind: GradKind, fate: GradFate | null, liq: number | null): boolean {
  if (kind === "born" || kind === "mayhem") return false;
  if (!fate || fate.empty || fate.drained) return false;
  return (liq ?? fate.lastLiq ?? 0) >= REAL_LIQ / 2;
}
