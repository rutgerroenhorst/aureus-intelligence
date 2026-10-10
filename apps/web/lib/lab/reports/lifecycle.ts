/**
 * The life of a coin from A to Z: what kinds of ending there are, when the good things happen, how many coins are still
 * alive after a day, and whether what a coin is called or where it was launched says anything about how it ends.
 * Everything is measured on coins followed for the full 72 hours, so a young coin is never counted as a failure.
 */

import type { LabCoin } from "../builder";
import { CLASS_ORDER, type OutcomeClass } from "../outcomes";
import { primaryTag } from "../narrative";
import { fisherExact, median, quantile } from "../stats";
import { rate, type Rate, followedFully } from "./common";
import { CLASS_TEXT } from "./overview";

export interface ClassRow {
  cls: OutcomeClass;
  label: string;
  n: number;
  share: number;
  /** median hours from the first look to the first 2x held (coins that got there) */
  hoursTo2x: number | null;
  /** median price after 24 h as a multiple of the first price */
  final24: number | null;
  examples: string[];
}

export interface HazardRow {
  from: number;
  to: number;
  /** coins followed through the whole window that had not held 2x at its start, plus those that did during it */
  atRisk: number;
  firstHeld2x: Rate;
}

export interface SplitRow {
  key: string;
  label: string;
  n: number;
  held2: Rate;
  held3: Rate;
  held10: Rate;
}

export interface LifecycleReport {
  basis: number;
  classes: ClassRow[];
  hazard: HazardRow[];
  timeTo2x: { n: number; p25: number; p50: number; p75: number; p90: number } | null;
  survival: Array<{ tau: number; alive: Rate }>;
  hours: SplitRow[];
  narrative: SplitRow[];
  product: {
    inGroup: SplitRow;
    outGroup: SplitRow;
    pHeld3: number | null;
    pHeld10: number | null;
    early: { inGroup: Rate; outGroup: Rate } | null;
    late: { inGroup: Rate; outGroup: Rate } | null;
  } | null;
  ecosystems: SplitRow[];
  venues: SplitRow[];
}

const FULL_H = 72 * 0.95;
const eligible = (c: LabCoin) => followedFully(c.outcome);

function split(key: string, label: string, cs: LabCoin[]): SplitRow {
  const h = (x: number) => rate(cs.filter((c) => c.outcome.peakHeld.h72 >= x).length, cs.length);
  return { key, label, n: cs.length, held2: h(2), held3: h(3), held10: h(10) };
}

export function buildLifecycle(coins: LabCoin[]): LifecycleReport {
  const full = coins.filter(eligible);
  const classes: ClassRow[] = CLASS_ORDER.map((cls) => {
    const cs = coins.filter((c) => c.outcome.cls === cls);
    const win = ["MOONSHOT", "RUNNER", "BOUNCE"].includes(cls);
    const t2 = cs.map((c) => c.outcome.tTo.x2).filter((x): x is number => x != null);
    const f24 = cs.map((c) => c.outcome.finalMult.h24).filter((x): x is number => x != null);
    const ex = [...cs].sort((a, b) => (win ? b.outcome.peakHeld.all - a.outcome.peakHeld.all : b.lastSeenAt - a.lastSeenAt)).slice(0, 3).map((c) => c.symbol ?? "?");
    return { cls, label: CLASS_TEXT[cls].label, n: cs.length, share: cs.length / Math.max(1, coins.length), hoursTo2x: t2.length ? median(t2) : null, final24: f24.length ? median(f24) : null, examples: ex };
  }).filter((r) => r.n > 0);

  const bins: Array<[number, number]> = [[0, 1], [1, 3], [3, 6], [6, 12], [12, 24], [24, 48], [48, 96]];
  const readable = coins.filter((c) => c.outcome.readings >= 8);
  const hazard: HazardRow[] = bins.map(([from, to]) => {
    let events = 0;
    let stay = 0;
    for (const c of readable) {
      const t2 = c.outcome.tTo.x2;
      if (t2 != null && t2 < from) continue; // already there
      if (c.outcome.ageH < from) continue;
      if (t2 != null && t2 < to) events++;
      else if (c.outcome.ageH >= to) stay++;
    }
    return { from, to, atRisk: events + stay, firstHeld2x: rate(events, events + stay) };
  });

  const t2s = coins.map((c) => c.outcome.tTo.x2).filter((x): x is number => x != null);
  const timeTo2x = t2s.length >= 10 ? { n: t2s.length, p25: quantile(t2s, 0.25), p50: quantile(t2s, 0.5), p75: quantile(t2s, 0.75), p90: quantile(t2s, 0.9) } : null;

  const survival = [1, 3, 6, 12, 24].map((tau) => {
    const snaps = coins.flatMap((c) => c.snaps.filter((s) => s.tau === tau));
    const known = snaps.filter((s) => s.f.liq != null);
    return { tau, alive: rate(known.filter((s) => (s.f.liq as number) >= 2000).length, known.length) };
  });

  const bandOf = (c: LabCoin) => {
    const h = new Date(c.firstSeenAt * 1000).getUTCHours();
    return h < 8 ? "00-08 UTC" : h < 16 ? "08-16 UTC" : "16-24 UTC";
  };
  const hours = ["00-08 UTC", "08-16 UTC", "16-24 UTC"].map((b) => split(b, b, full.filter((c) => bandOf(c) === b)));

  const prim = new Map<string, LabCoin[]>();
  for (const c of full) prim.set(primaryTag(c.tags), [...(prim.get(primaryTag(c.tags)) ?? []), c]);
  const labels: Record<string, string> = { ai_agent: "AI / agent / bot name", tool: "Tool / app / finance name", animal: "Animal name", person: "Person / celebrity name", other: "No keyword" };
  const narrative = ["ai_agent", "tool", "animal", "person", "other"].filter((k) => prim.has(k)).map((k) => split(k, labels[k]!, prim.get(k)!));

  const prod = full.filter((c) => c.tags.includes("product"));
  const rest = full.filter((c) => !c.tags.includes("product"));
  let product: LifecycleReport["product"] = null;
  if (prod.length >= 15 && rest.length >= 15) {
    const a = split("product", "AI or tool name", prod);
    const b = split("other", "Everything else", rest);
    const sorted = [...full].sort((x, y) => x.firstSeenAt - y.firstSeenAt);
    const mid = Math.floor(sorted.length / 2);
    const half = (cs: LabCoin[]) => {
      const p = cs.filter((c) => c.tags.includes("product"));
      const o = cs.filter((c) => !c.tags.includes("product"));
      return { inGroup: rate(p.filter((c) => c.outcome.peakHeld.h72 >= 3).length, p.length), outGroup: rate(o.filter((c) => c.outcome.peakHeld.h72 >= 3).length, o.length) };
    };
    product = {
      inGroup: a, outGroup: b,
      pHeld3: fisherExact(a.held3.k, a.held3.n - a.held3.k, b.held3.k, b.held3.n - b.held3.k),
      pHeld10: fisherExact(a.held10.k, a.held10.n - a.held10.k, b.held10.k, b.held10.n - b.held10.k),
      early: half(sorted.slice(0, mid)),
      late: half(sorted.slice(mid)),
    };
  }

  const eco = new Map<string, LabCoin[]>();
  for (const c of full) for (const t of c.tags) if (t.startsWith("eco:")) eco.set(t, [...(eco.get(t) ?? []), c]);
  const ecosystems = [...eco.entries()].filter(([, cs]) => cs.length >= 8).map(([k, cs]) => split(k, k.slice(4), cs)).sort((a, b) => b.n - a.n);

  const firstSnap = (c: LabCoin) => c.snaps.find((s) => s.tau === 0);
  const venueOf = (pred: (f: Record<string, number | null>) => boolean | null) => (c: LabCoin) => {
    const s = firstSnap(c);
    return s ? pred(s.f) : null;
  };
  const venues: SplitRow[] = [];
  const pump = venueOf((f) => (f.dex_pumpswap == null ? null : f.dex_pumpswap === 1));
  const sol = venueOf((f) => (f.quote_sol == null ? null : f.quote_sol === 1));
  const add = (label: string, fn: (c: LabCoin) => boolean | null, want: boolean) => {
    const cs = full.filter((c) => fn(c) === want);
    if (cs.length >= 15) venues.push(split(label, label, cs));
  };
  add("Main pool on PumpSwap", pump, true);
  add("Main pool elsewhere", pump, false);
  add("Priced in SOL", sol, true);
  add("Priced in another token", sol, false);

  return { basis: full.length, classes, hazard, timeTo2x, survival, hours, narrative, product, ecosystems, venues };
}
