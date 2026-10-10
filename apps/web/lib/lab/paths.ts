/**
 * Price-path maths for the Learning Lab: glitch removal, "held" peaks, time to a multiple, and the exit ladder.
 * Pure functions on the readings the scanner stores (time in epoch seconds, price in USD, pool liquidity in USD).
 *
 * Two lessons from the first research round are built in:
 *  - A reading is NOT a price you could have sold at when the pool's liquidity jumps 20x for a few scans and then
 *    falls back (a data glitch that once produced a "1194x coin"). Those readings are left out.
 *  - A spike that lasts one scan is not a peak either. A level only counts when the price held it for about half an hour.
 */

export interface Obs {
  /** epoch seconds */
  t: number;
  /** price in USD */
  p: number;
  /** pool liquidity in USD at that moment, when known */
  liq: number | null;
  mcap?: number | null;
  /** the coin stopped being listed (pool drained or delisted): a terminal reading that stands for "nothing more can happen" */
  dead?: boolean;
}

const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Flag phantom readings: liquidity more than 20x the median of the previous 8 readings AND price more than 5x their
 * median, for as long as the liquidity stays above 10x that median, and only when it then falls back (median of the next
 * 8 below 3x). A coin that really re-rated stays 20x higher and is therefore never flagged.
 */
export function flagPhantoms(obs: Obs[]): boolean[] {
  const n = obs.length;
  const flagged = new Array<boolean>(n).fill(false);
  let i = 0;
  while (i < n) {
    const prevLiq = obs.slice(Math.max(0, i - 8), i).map((o) => o.liq).filter((x): x is number => x != null && x > 0);
    if (prevLiq.length >= 3 && obs[i]!.liq != null && obs[i]!.liq! > 0) {
      const base = med(prevLiq);
      const prevP = obs.slice(Math.max(0, i - 8), i).map((o) => o.p);
      if (obs[i]!.liq! > 20 * base && obs[i]!.p > 5 * med(prevP)) {
        let j = i;
        while (j < n && obs[j]!.liq != null && obs[j]!.liq! > 10 * base) j++;
        const after = obs.slice(j, j + 8).map((o) => o.liq).filter((x): x is number => x != null && x > 0);
        if (j < n && after.length >= 1 && med(after) < 3 * base) {
          for (let k = i; k < j; k++) flagged[k] = true;
          i = j;
          continue;
        }
      }
    }
    i++;
  }
  return flagged;
}

export function cleanObs(obs: Obs[]): { clean: Obs[]; phantoms: number } {
  const f = flagPhantoms(obs);
  const clean = obs.filter((_, i) => !f[i]);
  return { clean, phantoms: obs.length - clean.length };
}

/** Median seconds between readings. */
export function medianGap(obs: Obs[]): number {
  if (obs.length < 2) return Infinity;
  const gaps: number[] = [];
  for (let i = 1; i < obs.length; i++) gaps.push(obs[i]!.t - obs[i - 1]!.t);
  return med(gaps);
}

export interface HoldRule {
  /** the price has to stay at the level for this long ... */
  windowS: number;
  /** ... and be seen at least this many times meanwhile */
  minObs: number;
}

/** Half an hour and three readings; coins scanned less often than every 15 minutes get two readings and a wider window. */
export function holdRule(gapS: number): HoldRule {
  return gapS <= 900 ? { windowS: 1800, minObs: 3 } : { windowS: Math.max(1800, 2 * (Number.isFinite(gapS) ? gapS : 1800)), minObs: 2 };
}

/**
 * The rule that applies around reading i when the spacing of readings changes along the path: scanner readings are minutes
 * apart, the hourly candles that extend a coin the scanner stopped following are an hour apart. "auto" looks at the next few
 * gaps and picks the matching rule, so a held level means the same thing (about half an hour, several looks) wherever it is.
 */
export function ruleAt(obs: Obs[], i: number): HoldRule {
  const j = Math.min(obs.length - 1, i + 4);
  if (j <= i) return holdRule(900);
  return holdRule((obs[j]!.t - obs[i]!.t) / (j - i));
}

/**
 * The highest level the price held (lowest reading inside a window of readings that starts at index i) over windows
 * that start at or after `fromIdx` and no later than `tMax`. Absolute price, or null when nothing was held.
 */
export function heldPeak(obs: Obs[], rule: HoldRule | "auto", fromIdx = 0, tMax = Infinity): { level: number; t: number } | null {
  const n = obs.length;
  let best: { level: number; t: number } | null = null;
  for (let i = fromIdx; i < n; i++) {
    if (obs[i]!.t > tMax) break;
    const r = rule === "auto" ? ruleAt(obs, i) : rule;
    let k = i;
    while (k + 1 < n && obs[k + 1]!.t - obs[i]!.t <= r.windowS) k++;
    if (k - i + 1 >= r.minObs) {
      let lvl = Infinity;
      for (let q = i; q <= k; q++) if (obs[q]!.p < lvl) lvl = obs[q]!.p;
      if (!best || lvl > best.level) best = { level: lvl, t: obs[i]!.t };
    }
  }
  return best;
}

/**
 * Index of the first reading at or above `level` that is then held (the next readings within the window stay above 80% of
 * the level). null when the level was never held.
 */
export function firstHeldIndex(obs: Obs[], level: number, rule: HoldRule | "auto", fromIdx = 0): number | null {
  const n = obs.length;
  for (let i = fromIdx; i < n; i++) {
    if (obs[i]!.p < level) continue;
    const r = rule === "auto" ? ruleAt(obs, i) : rule;
    let k = i;
    let ok = true;
    while (k + 1 < n && obs[k + 1]!.t - obs[i]!.t <= r.windowS) {
      k++;
      if (obs[k]!.p < level * 0.8) {
        ok = false;
        break;
      }
    }
    if (ok && (k > i || obs[n - 1]!.t - obs[i]!.t < r.windowS)) return i;
  }
  return null;
}

export interface LadderOpts {
  /** a stop on the whole position until the first target fills, as a fraction of the entry (0.5 = sell at -50%) */
  stop: number;
  /** [multiple, share of the position] resting sells; they fill AT their level */
  ladder: Array<[number, number]>;
  /** trailing stop on what is left, once a target has filled (0.4 = sell at 40% below the highest price since) */
  trail: number;
  /** cost on every sale: fees, slippage, failed fills */
  cost: number;
  horizonS: number;
}

export const DEFAULT_LADDER: LadderOpts = { stop: 0.5, ladder: [[2, 0.25], [5, 0.25], [10, 0.25]], trail: 0.4, cost: 0.05, horizonS: 72 * 3600 };

/**
 * Net result of entering at obs[start] and managing the position with the ladder: multiple of the stake after costs
 * (1.0 = break even). Stops and trailing stops sell at the price actually seen, which flatters a rug that falls
 * between two readings; resting sells fill at their level.
 */
export function ladderNet(obs: Obs[], start: number, opts: Partial<LadderOpts> = {}): number | null {
  const o = { ...DEFAULT_LADDER, ...opts };
  if (start < 0 || start >= obs.length) return null;
  const tk = obs[start]!.t;
  const pk = obs[start]!.p;
  if (!(pk > 0)) return null;
  let rem = 1;
  let proceeds = 0;
  let peak = pk;
  let armed = false;
  const filled = o.ladder.map(() => false);
  let last = pk;
  for (let i = start + 1; i < obs.length; i++) {
    if (obs[i]!.t - tk > o.horizonS) break;
    const p = obs[i]!.p;
    last = p;
    const m = p / pk;
    if (p > peak) peak = p;
    for (let q = 0; q < o.ladder.length; q++) {
      const [tm, fr] = o.ladder[q]!;
      if (!filled[q] && rem > 1e-9 && m >= tm) {
        const take = Math.min(fr, rem);
        proceeds += take * tm;
        rem -= take;
        filled[q] = true;
        armed = true;
      }
    }
    if (rem > 1e-9) {
      if (armed && p <= peak * (1 - o.trail)) {
        proceeds += rem * m;
        rem = 0;
        break;
      }
      if (!armed && m <= o.stop) {
        proceeds += rem * m;
        rem = 0;
        break;
      }
    }
    if (rem <= 1e-9) break;
  }
  if (rem > 1e-9) proceeds += rem * (last / pk);
  return proceeds * (1 - o.cost);
}

/** Index of the last reading at or before time t (or -1). */
export function indexAtOrBefore(obs: Obs[], t: number): number {
  let lo = 0;
  let hi = obs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid]!.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Index of the reading closest in time to t. */
export function nearestIndex(obs: Obs[], t: number): number {
  if (!obs.length) return -1;
  const i = indexAtOrBefore(obs, t);
  if (i < 0) return 0;
  if (i === obs.length - 1) return i;
  return Math.abs(obs[i + 1]!.t - t) < Math.abs(obs[i]!.t - t) ? i + 1 : i;
}
