/**
 * What happened to a coin, and what happened after a given moment in its life. Pure functions on cleaned readings.
 *
 * Outcome classes (a coin gets exactly one; a coin that held 1.5x is never demoted by what came later):
 *   MOONSHOT  held 10x or more           RUNNER  held 3x to 10x         BOUNCE  held 1.5x to 3x
 *   RUG       liquidity pulled and the price collapsed, without ever holding 1.5x
 *   DUMP      fell to half within 6 hours, without ever holding 1.5x
 *   BLEED     lost half over the first day without a single sharp fall
 *   ZOMBIE    still alive after a day, between half and 1.5x: nothing happens
 *   OPEN      too young to call, or not followed long enough (see `censored`)
 */

import { DEFAULT_LADDER, heldPeak, indexAtOrBefore, ladderNet, medianGap, firstHeldIndex, type HoldRule, type LadderOpts, type Obs } from "./paths";

export type OutcomeClass = "MOONSHOT" | "RUNNER" | "BOUNCE" | "RUG" | "DUMP" | "BLEED" | "ZOMBIE" | "DEAD" | "OPEN";

export const CLASS_ORDER: OutcomeClass[] = ["MOONSHOT", "RUNNER", "BOUNCE", "ZOMBIE", "BLEED", "DUMP", "RUG", "DEAD", "OPEN"];

export const H = 3600;

export interface Outcome {
  cls: OutcomeClass;
  /** hours between the first and the last reading */
  ageH: number;
  p0: number;
  /** highest level held ~30 min, as a multiple of the first price; 0 when no level was ever held */
  peakHeld: { all: number; h1: number; h6: number; h24: number; h72: number };
  /** lowest reading inside the window, as a multiple of the first price */
  minMult: { h1: number; h6: number; h24: number; h72: number };
  /** price at the end of the window as a multiple of the first price; null when the coin was not followed that long */
  finalMult: { h6: number | null; h24: number | null; h72: number | null };
  /** hours until the price first held 1.5x, 2x, 3x, 5x, 10x */
  tTo: { x15: number | null; x2: number | null; x3: number | null; x5: number | null; x10: number | null };
  /** deepest fall from a running high, as a fraction (0.7 = fell 70% from a high) */
  maxDd: number;
  liqFirst: number | null;
  liqLast: number | null;
  /** lowest liquidity seen divided by the first liquidity */
  liqMinRatio: number | null;
  gapS: number;
  /** clean readings the labels are based on */
  readings: number;
  /** the scanner stopped following this coin before its windows matured; labels that need more data stay empty */
  censored: boolean;
  /** the coin stopped being listed (its pool was drained or delisted): that is how it ended, every window is decided */
  deadEnd?: boolean;
  lastT: number;
  /** the coin as it stands at its last reading, for coins still being followed (feeds the live view) */
  now?: { ts: number; ageH: number; f: Record<string, number | null> };
}

export interface OutcomeCtx {
  /** epoch seconds "now" (or the end of the data) */
  now: number;
  /** the scanner no longer follows this coin (rejected, expired, dormant) */
  trackingEnded: boolean;
}

const CENSOR_AFTER_S = 6 * H;

export function buildOutcome(clean: Obs[], ctx: OutcomeCtx): Outcome | null {
  if (clean.length < 1) return null;
  const t0 = clean[0]!.t;
  const p0 = clean[0]!.p;
  if (!(p0 > 0)) return null;
  const lastT = clean[clean.length - 1]!.t;
  const gapS = medianGap(clean);
  const rule = "auto" as const;
  const rel = (lvl: number | undefined) => (lvl == null ? 0 : lvl / p0);
  const peak = (hours: number) => rel(heldPeak(clean, rule, 0, t0 + hours * H)?.level);
  const minWithin = (hours: number) => {
    let m = Infinity;
    for (const o of clean) {
      if (o.t - t0 > hours * H) break;
      if (o.p < m) m = o.p;
    }
    return m / p0;
  };
  const finalAt = (hours: number): number | null => {
    if (lastT - t0 < hours * H * 0.95) return null;
    const i = indexAtOrBefore(clean, t0 + hours * H);
    return i >= 0 ? clean[i]!.p / p0 : null;
  };
  const tTo = (x: number): number | null => {
    const i = firstHeldIndex(clean, p0 * x, rule);
    return i == null ? null : (clean[i]!.t - t0) / H;
  };
  let runMax = p0;
  let maxDd = 0;
  for (const o of clean) {
    if (o.p > runMax) runMax = o.p;
    const dd = 1 - o.p / runMax;
    if (dd > maxDd) maxDd = dd;
  }
  const liqs = clean.map((o) => o.liq).filter((x): x is number => x != null && x > 0);
  const liqFirst = liqs.length ? liqs[0]! : null;
  const liqLast = clean[clean.length - 1]!.liq ?? (liqs.length ? liqs[liqs.length - 1]! : null);
  const liqMin = liqs.length ? Math.min(...liqs) : null;
  const ageH = (lastT - t0) / H;

  const o: Outcome = {
    cls: "OPEN",
    ageH,
    p0,
    peakHeld: { all: peak(1e9), h1: peak(1), h6: peak(6), h24: peak(24), h72: peak(72) },
    minMult: { h1: minWithin(1), h6: minWithin(6), h24: minWithin(24), h72: minWithin(72) },
    finalMult: { h6: finalAt(6), h24: finalAt(24), h72: finalAt(72) },
    tTo: { x15: tTo(1.5), x2: tTo(2), x3: tTo(3), x5: tTo(5), x10: tTo(10) },
    maxDd,
    liqFirst,
    liqLast,
    liqMinRatio: liqFirst && liqMin != null ? liqMin / liqFirst : null,
    gapS: Number.isFinite(gapS) ? gapS : 0,
    readings: clean.length,
    censored: ctx.trackingEnded && ctx.now - lastT > CENSOR_AFTER_S,
    deadEnd: clean[clean.length - 1]!.dead === true,
    lastT,
  };
  o.cls = classify(o);
  return o;
}

/** A level can only be called "held" when there are enough readings around it to tell a real move from a glitch. */
export const MIN_READINGS_FOR_PEAK = 8;

export function classify(o: Outcome): OutcomeClass {
  const drained = (o.liqLast != null && o.liqLast < 1_000) || (o.liqMinRatio != null && o.liqMinRatio <= 0.1);
  if (o.readings < MIN_READINGS_FOR_PEAK) return drained && o.minMult.h24 <= 0.3 ? "RUG" : "OPEN";
  if (o.peakHeld.all >= 10) return "MOONSHOT";
  if (o.peakHeld.all >= 3) return "RUNNER";
  if (o.peakHeld.all >= 1.5) return "BOUNCE";
  if (drained && o.minMult.h24 <= 0.3) return "RUG";
  if (o.minMult.h6 <= 0.5) return "DUMP";
  if (o.ageH >= 24) {
    const f = o.finalMult.h24;
    if (f != null) return f <= 0.5 ? "BLEED" : "ZOMBIE";
  }
  return "OPEN";
}

/** The number a "winner" is judged by in the old Self-Optimizer, for comparison: 2x held. */
export const isGo = (o: Outcome, x: number) => o.peakHeld.all >= x;

// ── what happened after a given moment ───────────────────────────────────────────────────────────────────────

export interface Fwd {
  /** held 1.5x / 2x / 3x / 5x of the price at that moment within the next 72 hours; null = not decidable yet */
  go15: boolean | null;
  go2: boolean | null;
  go3: boolean | null;
  go5: boolean | null;
  /** fell to half of the price at that moment within the next 6 / 24 hours */
  collapse6: boolean | null;
  collapse24: boolean | null;
  /** price after 24 / 72 hours as a multiple of the price at that moment */
  fwd24: number | null;
  fwd72: number | null;
  /** highest level held within 72 hours, as a multiple */
  peak72: number;
  /** net result of the exit ladder over the next 72 hours (1.0 = break even); null until it resolved */
  ev: number | null;
}

export interface FwdCtx {
  rule: HoldRule | "auto";
  ladder?: Partial<LadderOpts>;
}

/**
 * What the following 72 hours held, from the reading at index i. A label is only filled in once the whole window has been
 * seen: deciding "yes" early while "no" must wait would leave the decided coins full of winners and inflate every rate.
 */
export function forwardLabels(clean: Obs[], i: number, ctx: FwdCtx): Fwd | null {
  if (i < 0 || i >= clean.length) return null;
  const pi = clean[i]!.p;
  const ti = clean[i]!.t;
  if (!(pi > 0)) return null;
  const lastT = clean[clean.length - 1]!.t;
  const cover = lastT - ti;
  // a coin that stopped being listed has no further price: what it could still do within the window is nothing, so the window is decided
  const dead = clean[clean.length - 1]!.dead === true;
  const done = (hours: number) => dead || cover >= hours * H * 0.95;

  const hp = heldPeak(clean, ctx.rule, i, ti + 72 * H);
  const peak72 = hp ? hp.level / pi : 0;

  let min6 = Infinity;
  let min24 = Infinity;
  for (let k = i; k < clean.length; k++) {
    const dt = clean[k]!.t - ti;
    if (dt > 24 * H) break;
    const m = clean[k]!.p / pi;
    if (dt <= 6 * H && m < min6) min6 = m;
    if (m < min24) min24 = m;
  }
  const at = (hours: number): number | null => {
    if (!done(hours)) return null;
    const k = indexAtOrBefore(clean, ti + hours * H);
    return k >= i ? clean[k]!.p / pi : null;
  };
  const lad = done(72) ? ladderNet(clean, i, { ...DEFAULT_LADDER, ...ctx.ladder }) : null;
  return {
    go15: done(72) ? peak72 >= 1.5 : null,
    go2: done(72) ? peak72 >= 2 : null,
    go3: done(72) ? peak72 >= 3 : null,
    go5: done(72) ? peak72 >= 5 : null,
    collapse6: done(6) ? min6 <= 0.5 : null,
    collapse24: done(24) ? min24 <= 0.5 : null,
    fwd24: at(24),
    fwd72: at(72),
    peak72,
    ev: lad,
  };
}
