/**
 * "Why coins go, and why they do not": for every moment after the first look (1, 3, 6, 12, 24 h and the first look itself),
 * which of the coin's features separate the ones that went on to double from the rest, and the ones that lost half within a day
 * from the rest.
 *
 * Every claim carries its own caution: an interval on the AUC, a q-value that pays for the number of things tried, and a
 * check that the effect points the same way in the earlier and the later half of the coins. Only effects that pass all three
 * are called "strong".
 */

import type { LabCoin } from "../builder";
import { FEATURES, fmtValue, type FeatureMeta } from "../features";
import { aucTest, bhFdr, binOf, mean, quantileEdges } from "../stats";
import { ANALYSIS_TAUS, evOf, isStanding, num, rate, rateOf, rowsFor, splitTime, type Rate, type Row, type Target } from "./common";

export type Tier = "strong" | "suggestive" | "weak";

export interface AucOut {
  auc: number;
  lo: number;
  hi: number;
  p: number;
  q: number;
  n1: number;
  n0: number;
}

export interface BinOut {
  label: string;
  lo: number | null;
  hi: number | null;
  n: number;
  go2: Rate;
  go3: Rate;
  collapse24: Rate;
  ev: number | null;
  evN: number;
}

export interface FeatureInsight {
  key: string;
  label: string;
  group: string;
  fmt: string;
  about: string;
  nonNull: number;
  go2: AucOut | null;
  collapse24: AucOut | null;
  /** AUC in the earlier and the later half of the coins (null when a half is too small) */
  halves: { go2: [number | null, number | null]; collapse24: [number | null, number | null] };
  bins: BinOut[];
  tier: { go2: Tier; collapse24: Tier };
  sentence: { go2: string | null; collapse24: string | null };
}

export interface TauInsights {
  tau: number;
  /** coins that still stand (have not already fallen apart) with a decided outcome; all numbers below are about them */
  n: number;
  base: { go2: Rate; go3: Rate; collapse24: Rate; ev: { mean: number | null; n: number } };
  /** the coins that had already fallen apart at that moment, for contrast */
  fallen: { n: number; go2: Rate; collapse24: Rate };
  /** the features that separate most, with full detail */
  features: FeatureInsight[];
  /** every other feature that was tested, in one line each */
  others: Array<{ key: string; label: string; group: string; go2: number | null; collapse24: number | null }>;
}

export interface Headline {
  tau: number;
  key: string;
  label: string;
  target: "go2" | "collapse24";
  /** "higher" = coins with higher values do this more often */
  direction: "higher" | "lower";
  auc: number;
  lo: number;
  hi: number;
  q: number;
  tier: Tier;
  sentence: string;
}

export interface InsightsReport {
  taus: TauInsights[];
  headlines: Headline[];
  tests: number;
}

const pct = (r: Rate) => `${(r.p * 100).toFixed(r.p < 0.1 ? 1 : 0)}%`;

function binsFor(meta: FeatureMeta, rows: Row[]): { bins: BinOut[]; edges: number[] | null } {
  const vals = rows.map((r) => r.f[meta.key]).filter(num);
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  const mk = (label: string, lo: number | null, hi: number | null, sel: Row[]): BinOut => {
    const ev = evOf(sel);
    return {
      label, lo, hi, n: sel.length,
      go2: rateOf(sel, "go2"), go3: rateOf(sel, "go3"), collapse24: rateOf(sel, "collapse24"),
      ev: ev.length ? mean(ev) : null, evN: ev.length,
    };
  };
  if (meta.fmt === "bool" || uniq.length <= 2) {
    const out: BinOut[] = [];
    for (const v of uniq) out.push(mk(meta.fmt === "bool" ? (v >= 0.5 ? "yes" : "no") : fmtValue(meta.fmt, v), v, v, rows.filter((r) => r.f[meta.key] === v)));
    return { bins: out, edges: null };
  }
  const edges = quantileEdges(vals, 4);
  const bins: BinOut[] = [];
  for (let b = 0; b <= edges.length; b++) {
    const lo = b === 0 ? null : edges[b - 1]!;
    const hi = b === edges.length ? null : edges[b]!;
    const sel = rows.filter((r) => {
      const v = r.f[meta.key];
      return num(v) && binOf(v, edges) === b;
    });
    const label = lo == null ? `under ${fmtValue(meta.fmt as never, hi)}` : hi == null ? `${fmtValue(meta.fmt as never, lo)} and up` : `${fmtValue(meta.fmt as never, lo)} to ${fmtValue(meta.fmt as never, hi)}`;
    bins.push(mk(label, lo, hi, sel));
  }
  return { bins, edges };
}

function aucOf(rows: Row[], key: string, target: Target, minSide: number): ReturnType<typeof aucTest> {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const r of rows) {
    const v = r.f[key];
    const t = r.y[target];
    if (!num(v) || t == null) continue;
    (t ? pos : neg).push(v);
  }
  return aucTest(pos, neg, minSide);
}

function sentenceFor(meta: FeatureMeta, bins: BinOut[], target: "go2" | "collapse24"): string | null {
  const usable = bins.filter((b) => b[target].n >= 15);
  if (usable.length < 2) return null;
  const lowB = usable[0]!;
  const highB = usable[usable.length - 1]!;
  if (meta.fmt === "bool") return `${pct(highB[target])} with it, ${pct(lowB[target])} without (${highB[target].n} and ${lowB[target].n} coins)`;
  return `${pct(lowB[target])} when ${meta.label.toLowerCase()} is ${lowB.label}, ${pct(highB[target])} when ${highB.label} (${lowB[target].n} and ${highB[target].n} coins)`;
}

export function buildInsights(coins: LabCoin[]): InsightsReport {
  const taus: TauInsights[] = [];
  const pending: Array<{ out: AucOut }> = [];
  for (const tau of ANALYSIS_TAUS) {
    const all = rowsFor(coins, tau);
    const rows = rowsFor(coins, tau, { standing: true });
    if (rows.length < 60) continue;
    const fallenRows = all.filter((r) => !isStanding(r.f));
    const [early, late] = splitTime(rows, 0.5);
    const ev = evOf(rows);
    const features: FeatureInsight[] = [];
    for (const meta of FEATURES) {
      const nonNull = rows.filter((r) => num(r.f[meta.key])).length;
      if (nonNull < 60) continue;
      if (new Set(rows.map((r) => r.f[meta.key]).filter(num)).size < 2) continue;
      const { bins } = binsFor(meta, rows);
      const mkAuc = (target: "go2" | "collapse24"): AucOut | null => {
        const a = aucOf(rows, meta.key, target, 8);
        if (!a) return null;
        const out: AucOut = { auc: a.auc, lo: a.lo, hi: a.hi, p: a.p, q: 1, n1: a.n1, n0: a.n0 };
        pending.push({ out });
        return out;
      };
      const half = (rs: Row[], target: "go2" | "collapse24") => aucOf(rs, meta.key, target, 5)?.auc ?? null;
      const g2 = mkAuc("go2");
      const c24 = mkAuc("collapse24");
      features.push({
        key: meta.key, label: meta.label, group: meta.group, fmt: meta.fmt, about: meta.about, nonNull,
        go2: g2, collapse24: c24,
        halves: { go2: [half(early, "go2"), half(late, "go2")], collapse24: [half(early, "collapse24"), half(late, "collapse24")] },
        bins, tier: { go2: "weak", collapse24: "weak" },
        sentence: { go2: sentenceFor(meta, bins, "go2"), collapse24: sentenceFor(meta, bins, "collapse24") },
      });
    }
    taus.push({
      tau, n: rows.length,
      base: { go2: rateOf(rows, "go2"), go3: rateOf(rows, "go3"), collapse24: rateOf(rows, "collapse24"), ev: { mean: ev.length ? mean(ev) : null, n: ev.length } },
      fallen: { n: fallenRows.length, go2: rateOf(fallenRows, "go2"), collapse24: rateOf(fallenRows, "collapse24") },
      features,
      others: [],
    });
  }

  // Pay for the number of things looked at, then grade each effect.
  const q = bhFdr(pending.map((x) => x.out.p));
  pending.forEach((x, i) => (x.out.q = q[i]!));
  const tierOf = (a: AucOut | null, h: [number | null, number | null]): Tier => {
    if (!a) return "weak";
    const dev = Math.abs(a.auc - 0.5);
    const sameSide = h[0] == null || h[1] == null ? true : (h[0] - 0.5) * (h[1] - 0.5) > 0 && (h[0] - 0.5) * (a.auc - 0.5) > 0;
    const inBoth = h[0] != null && h[1] != null && Math.abs(h[0] - 0.5) >= 0.03 && Math.abs(h[1] - 0.5) >= 0.03;
    if (a.q < 0.05 && dev >= 0.07 && sameSide && inBoth) return "strong";
    if (a.q < 0.2 && dev >= 0.05 && sameSide) return "suggestive";
    return "weak";
  };
  const headlines: Headline[] = [];
  for (const t of taus) {
    for (const f of t.features) {
      f.tier.go2 = tierOf(f.go2, f.halves.go2);
      f.tier.collapse24 = tierOf(f.collapse24, f.halves.collapse24);
      for (const target of ["go2", "collapse24"] as const) {
        const a = f[target];
        if (!a || f.tier[target] === "weak" || !f.sentence[target]) continue;
        headlines.push({
          tau: t.tau, key: f.key, label: f.label, target, direction: a.auc > 0.5 ? "higher" : "lower",
          auc: a.auc, lo: a.lo, hi: a.hi, q: a.q, tier: f.tier[target], sentence: f.sentence[target]!,
        });
      }
    }
  }
  // Keep full detail for the features that separate most; the rest become one line each.
  const spread = (f: FeatureInsight) => Math.max(Math.abs((f.go2?.auc ?? 0.5) - 0.5), Math.abs((f.collapse24?.auc ?? 0.5) - 0.5));
  for (const t of taus) {
    const sorted = [...t.features].sort((a, b) => spread(b) - spread(a));
    const keep = new Set(sorted.slice(0, 14).map((f) => f.key));
    t.others = sorted.filter((f) => !keep.has(f.key)).map((f) => ({ key: f.key, label: f.label, group: f.group, go2: f.go2 ? f.go2.auc : null, collapse24: f.collapse24 ? f.collapse24.auc : null }));
    t.features = sorted.filter((f) => keep.has(f.key));
  }
  // Best moment per feature and target, strongest first.
  const best = new Map<string, Headline>();
  for (const h of headlines) {
    const k = `${h.key}|${h.target}`;
    const cur = best.get(k);
    const score = (x: Headline) => (x.tier === "strong" ? 1 : 0) * 10 + Math.abs(x.auc - 0.5);
    if (!cur || score(h) > score(cur)) best.set(k, h);
  }
  const ranked = [...best.values()].sort((a, b) => (b.tier === "strong" ? 1 : 0) - (a.tier === "strong" ? 1 : 0) || Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5));
  return { taus, headlines: ranked.slice(0, 24), tests: pending.length };
}

/** Shorthand used by other reports: the rate of a boolean target among rows where a predicate holds. */
export function groupRate(rows: Row[], pred: (r: Row) => boolean, target: Target): Rate {
  const sel = rows.filter(pred);
  return rate(sel.filter((r) => r.y[target] === true).length, sel.filter((r) => r.y[target] != null).length);
}
