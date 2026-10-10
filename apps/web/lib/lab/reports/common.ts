import type { LabCoin } from "../builder";
import type { Features } from "../features";
import type { Fwd } from "../outcomes";
import { mean, wilson } from "../stats";

/** One decision moment of one coin: what it looked like, and (once decidable) what the next 72 hours held. */
export interface Row {
  coin: LabCoin;
  tau: number;
  t0: number;
  f: Features;
  y: Fwd;
}

/** Hours after the first look at which the lab freezes a coin's state. */
export const DECISION_TAUS = [0, 1, 3, 6, 12, 24] as const;
/** The moments the insights, rules and models are fitted at (the first look is analysed on its own). */
export const ANALYSIS_TAUS = [0, 1, 3, 6, 12, 24];

/**
 * A coin that has not already fallen apart: still above half of its first price and within 65% of its own high. Coins that
 * already collapsed can hardly collapse again, so mixing them in makes "what predicts a crash" look far better than it is.
 */
export const isStanding = (f: Features): boolean => (f.mult == null || f.mult >= 0.5) && (f.dd == null || f.dd >= 0.35);

export function rowsFor(coins: LabCoin[], tau: number, opts: { standing?: boolean } = {}): Row[] {
  const out: Row[] = [];
  for (const coin of coins) {
    for (const s of coin.snaps) {
      if (s.tau !== tau || !s.y) continue;
      if (opts.standing && !isStanding(s.f)) continue;
      out.push({ coin, tau, t0: coin.firstSeenAt, f: s.f, y: s.y });
    }
  }
  return out;
}

export type Target = "go15" | "go2" | "go3" | "go5" | "collapse6" | "collapse24";

export const targetOf = (r: Row, t: Target): boolean | null => r.y[t];

/** Earlier coins first, then split by count: the model is judged on coins that appeared after the ones it learned from. */
export function splitTime<T extends { t0: number }>(rows: T[], frac = 0.6): [T[], T[]] {
  const s = [...rows].sort((a, b) => a.t0 - b.t0);
  const k = Math.floor(s.length * frac);
  return [s.slice(0, k), s.slice(k)];
}

export interface Rate {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

export function rate(k: number, n: number): Rate {
  const w = wilson(k, n);
  return { k, n, p: w.p, lo: w.lo, hi: w.hi };
}

export function rateOf(rows: Row[], t: Target): Rate {
  let k = 0;
  let n = 0;
  for (const r of rows) {
    const v = r.y[t];
    if (v == null) continue;
    n++;
    if (v) k++;
  }
  return rate(k, n);
}

export const evOf = (rows: Row[]): number[] => rows.map((r) => r.y.ev).filter((x): x is number => x != null);

/**
 * Followed for the whole 72 hours with enough readings to judge, or ended for good (the pool was drained or delisted: nothing more can
 * happen to it, so leaving it out would make the survivors look like everybody).
 */
export const followedFully = (o: { readings: number; ageH: number; deadEnd?: boolean }): boolean => (o.deadEnd === true && o.readings >= 3) || (o.readings >= 8 && o.ageH >= 72 * 0.95);

export const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export function isoDay(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

/** Outcomes of a set of decision moments: how often the coins doubled / lost half, and what the exit ladder earned. */
export interface Group {
  n: number;
  go2: Rate;
  go3: Rate;
  collapse24: Rate;
  ev: { mean: number | null; n: number };
}

export function group(rows: Row[]): Group {
  const ev = evOf(rows);
  return { n: rows.length, go2: rateOf(rows, "go2"), go3: rateOf(rows, "go3"), collapse24: rateOf(rows, "collapse24"), ev: { mean: ev.length ? mean(ev) : null, n: ev.length } };
}
