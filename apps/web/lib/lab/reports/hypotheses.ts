/**
 * Hypotheses written down BEFORE they are tested. Finding a pattern in coins you have already seen proves very little: with
 * enough features something always lines up. So each idea is registered with a date, and the only evidence that counts is what
 * happens to coins first seen AFTER that date. The earlier coins are shown too, marked as the place the idea came from.
 */

import type { LabCoin } from "../builder";
import type { Features } from "../features";
import { bootDiffCi, fisherExact, mean } from "../stats";
import { num, rate, type Rate } from "./common";

type Side = "in" | "out" | null;

export interface HypothesisDef {
  id: string;
  title: string;
  statement: string;
  /** honest account of where the idea came from */
  basis: string;
  unit: "coin" | "moment";
  tau?: number;
  side: (coin: LabCoin, f: Features | null) => Side;
  outcome: "held2" | "held3" | "go2" | "ev";
  /** what the "in" group is claimed to do compared with the "out" group */
  claim: "higher" | "lower" | "not_lower";
  minPerGroup: number;
}

const snapAt = (c: LabCoin, tau: number) => c.snaps.find((s) => s.tau === tau);
const anySignal = (c: LabCoin, key: string): number | null => {
  for (const s of c.snaps) {
    const v = s.f[key];
    if (num(v)) return v;
  }
  return null;
};

export const HYPOTHESES: HypothesisDef[] = [
  {
    id: "H1-product-names", title: "AI, agent and tool names beat plain memes",
    statement: "Coins whose name points at AI, agents, bots, tools, apps or finance hold 3x more often than other coins.",
    basis: "Seen after the fact in the first four weeks: 10% of coins carried such a name, 8 of the 21 biggest winners did, and the gap only showed in the second half of the period. Registered now so that only coins first seen from today count.",
    unit: "coin", side: (c) => (c.tags.includes("product") ? "in" : "out"), outcome: "held3", claim: "higher", minPerGroup: 25,
  },
  {
    id: "H2-top-entries", title: "Buying at a fresh high is worse than buying a dip",
    statement: "Three hours after the first look, a coin standing at its own high gives a worse exit-ladder result than one standing 30% or more below it.",
    basis: "Found in the first four weeks (-31% at a fresh high against -13% for coins 30-50% below), stable in both halves of that period.",
    unit: "moment", tau: 3, side: (_c, f) => (!f || !num(f.dd) ? null : f.dd >= 0.99 ? "in" : f.dd <= 0.7 ? "out" : null), outcome: "ev", claim: "lower", minPerGroup: 25,
  },
  {
    id: "H3-volume-dead", title: "Dried-up volume means the coin is not going anywhere",
    statement: "Three hours after the first look, a coin whose last-hour volume is below 5% of its 6-hour average doubles less than half as often as the rest.",
    basis: "Seen in the first four weeks (4% doubled against 11-19% in the other groups), never tested on later coins.",
    unit: "moment", tau: 3, side: (_c, f) => (!f || !num(f.vol_decay) ? null : f.vol_decay < 0.05 ? "in" : "out"), outcome: "go2", claim: "lower", minPerGroup: 25,
  },
  {
    id: "H4-one-wallet", title: "The one-wallet 20% rule does not protect",
    statement: "Coins where one wallet holds 20% or more hold 2x at least as often as other coins.",
    basis: "Today the rule rejects such coins at their first look and stops following them. Among those rejected, 3.4% are now 5x or more against 1.1% of the rest (p = 0.009, one of about 14 groups looked at). The lab now follows rejected coins with its own tail tracker, so this can be tested properly.",
    unit: "coin", side: (c) => { const s = snapAt(c, 0); const v = s?.f.top1; return !num(v) ? null : v >= 0.2 ? "in" : "out"; }, outcome: "held2", claim: "not_lower", minPerGroup: 25,
  },
  {
    id: "H5-organic", title: "Organic buyers and a flat holder base mark the winners",
    statement: "Coins with a Jupiter organic score of 60 or more hold 3x more often than coins below it.",
    basis: "Not testable on history: the score exists only as a snapshot from today. The lab collects it every round from now on, so coins first seen from today carry the score they had.",
    unit: "coin", side: (c) => { const v = anySignal(c, "organic_score"); return v == null ? null : v >= 60 ? "in" : "out"; }, outcome: "held3", claim: "higher", minPerGroup: 20,
  },
];

export type HypothesisStatus = "supported" | "contradicted" | "open" | "collecting";

export interface HypothesisResult {
  id: string;
  title: string;
  statement: string;
  basis: string;
  registeredAt: number;
  claim: HypothesisDef["claim"];
  outcome: HypothesisDef["outcome"];
  inSample: Test;
  forward: Test;
  status: HypothesisStatus;
  need: number;
}

export interface Test {
  inGroup: { n: number; rate: Rate | null; ev: number | null };
  outGroup: { n: number; rate: Rate | null; ev: number | null };
  p: number | null;
}

interface Item { side: Side; t0: number; hit: boolean | null; ev: number | null }

function itemsOf(def: HypothesisDef, coins: LabCoin[]): Item[] {
  const out: Item[] = [];
  for (const c of coins) {
    if (def.unit === "coin") {
      if (c.outcome.readings < 8 || c.outcome.ageH < 72 * 0.95) continue;
      const side = def.side(c, snapAt(c, 0)?.f ?? null);
      if (!side) continue;
      const hit = def.outcome === "held3" ? c.outcome.peakHeld.h72 >= 3 : def.outcome === "held2" ? c.outcome.peakHeld.h72 >= 2 : null;
      out.push({ side, t0: c.firstSeenAt, hit, ev: null });
    } else {
      const s = snapAt(c, def.tau!);
      if (!s?.y) continue;
      const side = def.side(c, s.f);
      if (!side) continue;
      out.push({ side, t0: c.firstSeenAt, hit: def.outcome === "go2" ? s.y.go2 : null, ev: def.outcome === "ev" ? s.y.ev : null });
    }
  }
  return out;
}

function test(def: HypothesisDef, items: Item[]): Test {
  const part = (side: Side) => {
    const xs = items.filter((i) => i.side === side);
    if (def.outcome === "ev") {
      const ev = xs.map((i) => i.ev).filter((v): v is number => v != null);
      return { n: ev.length, rate: null, ev: ev.length ? mean(ev) : null, raw: ev, k: 0, m: 0 };
    }
    const dec = xs.filter((i) => i.hit != null);
    const k = dec.filter((i) => i.hit).length;
    return { n: dec.length, rate: dec.length ? rate(k, dec.length) : null, ev: null, raw: [] as number[], k, m: dec.length };
  };
  const a = part("in");
  const b = part("out");
  let p: number | null = null;
  if (def.outcome === "ev") {
    if (a.raw.length >= 15 && b.raw.length >= 15) {
      const d = bootDiffCi(a.raw, b.raw, 300, 41);
      p = d.lo > 0 || d.hi < 0 ? 0.04 : 0.5; // a 90% interval that excludes 0: read as significant at about 0.1/0.05 level
    }
  } else if (a.m >= 10 && b.m >= 10) p = fisherExact(a.k, a.m - a.k, b.k, b.m - b.k);
  return { inGroup: { n: a.n, rate: a.rate, ev: a.ev }, outGroup: { n: b.n, rate: b.rate, ev: b.ev }, p };
}

export function buildHypotheses(coins: LabCoin[], registered: Map<string, number>, nowS: number): HypothesisResult[] {
  return HYPOTHESES.map((def) => {
    const reg = registered.get(def.id) ?? nowS;
    const items = itemsOf(def, coins);
    const before = items.filter((i) => i.t0 < reg);
    const after = items.filter((i) => i.t0 >= reg);
    const inSample = test(def, before);
    const forward = test(def, after);
    const value = (g: Test["inGroup"]) => (def.outcome === "ev" ? g.ev : g.rate?.p ?? null);
    const need = def.minPerGroup;
    let status: HypothesisStatus = "collecting";
    if (forward.inGroup.n >= need && forward.outGroup.n >= need) {
      const vi = value(forward.inGroup);
      const vo = value(forward.outGroup);
      const sig = forward.p != null && forward.p < 0.05;
      if (vi != null && vo != null) {
        if (def.claim === "higher") status = sig && vi > vo ? "supported" : sig && vi < vo ? "contradicted" : "open";
        else if (def.claim === "lower") status = sig && vi < vo ? "supported" : sig && vi > vo ? "contradicted" : "open";
        else status = sig && vi < vo ? "contradicted" : vi >= vo ? "supported" : "open";
      } else status = "open";
    }
    return { id: def.id, title: def.title, statement: def.statement, basis: def.basis, registeredAt: reg, claim: def.claim, outcome: def.outcome, inSample, forward, status, need };
  });
}
