/**
 * A prior for the runner lane, from history that already exists: what did the Radar's own coins do after they crossed
 * $300K with real liquidity? The runner lane itself needs three days per coin before it can say anything; this answers the
 * same question now, from the coins the scanner followed over the past weeks.
 *
 * An event is the FIRST clean reading of a coin with market cap >= $300K, liquidity >= $40K, and at least three hours of pair
 * age. From that reading the next 72 hours are labelled exactly like the lessons are (held 2x/3x, lost half within a day, the
 * fixed exit plan), and only events whose whole window was seen are counted. It knows nothing about holders or organic score,
 * so it is a floor for the Jupiter-list runners, which also have to look healthy; it is not a copy of them.
 */

import { forwardLabels } from "../outcomes";
import { cleanObs, type Obs } from "../paths";
import { median } from "../stats";
import { rate, type Rate } from "./common";

export const PRIOR = { minMcap: 300_000, minLiq: 40_000, minPairAgeH: 3 };

export interface PriorEvent {
  mint: string;
  t: number;
  mcap: number;
  liq: number | null;
  pairAgeH: number | null;
  /** price at the event relative to the coin's first reading */
  sinceFirst: number;
  go2: boolean | null;
  go3: boolean | null;
  go5: boolean | null;
  collapse24: boolean | null;
  ev: number | null;
}

/** Index of the first reading that qualifies, or -1. `pairCreatedS` is epoch seconds of the pair's creation, when known. */
export function crossingIndex(clean: Obs[], pairCreatedS: number | null): number {
  for (let i = 0; i < clean.length; i++) {
    const o = clean[i]!;
    const mcap = o.mcap ?? null;
    if (mcap == null || mcap < PRIOR.minMcap || o.liq == null || o.liq < PRIOR.minLiq) continue;
    if (pairCreatedS != null && (o.t - pairCreatedS) / 3600 < PRIOR.minPairAgeH) continue;
    return i;
  }
  return -1;
}

export function eventOf(mint: string, raw: Obs[], pairCreatedS: number | null): PriorEvent | null {
  const { clean } = cleanObs(raw);
  const i = crossingIndex(clean, pairCreatedS);
  if (i < 0) return null;
  const f = forwardLabels(clean, i, { rule: "auto" });
  if (!f) return null;
  const o = clean[i]!;
  return {
    mint, t: o.t, mcap: o.mcap!, liq: o.liq, pairAgeH: pairCreatedS != null ? (o.t - pairCreatedS) / 3600 : null, sinceFirst: o.p / clean[0]!.p,
    go2: f.go2, go3: f.go3, go5: f.go5, collapse24: f.collapse24, ev: f.ev,
  };
}

export interface PriorGroup {
  id: string;
  label: string;
  /** events found / events whose whole 72 hours were seen */
  n: number;
  decided: number;
  go2: Rate;
  go3: Rate;
  go5: Rate;
  collapse24: Rate;
  /** average result of the fixed exit plan (1.0 = break even) */
  ev: number | null;
  medianMcap: number | null;
}

export interface PriorReport {
  rule: string;
  groups: PriorGroup[];
  note: string;
}

const GROUPS: Array<{ id: string; label: string; pick: (e: PriorEvent) => boolean }> = [
  { id: "all", label: "Every coin that crossed", pick: () => true },
  { id: "young", label: "Under a day old when it crossed", pick: (e) => e.pairAgeH != null && e.pairAgeH < 24 },
  { id: "week", label: "One to seven days old", pick: (e) => e.pairAgeH != null && e.pairAgeH >= 24 && e.pairAgeH < 168 },
  { id: "old", label: "More than a week old", pick: (e) => e.pairAgeH != null && e.pairAgeH >= 168 },
  { id: "big", label: "Already worth $1M or more", pick: (e) => e.mcap >= 1_000_000 },
  { id: "run", label: "Already up 5x since the lab first saw it", pick: (e) => e.sinceFirst >= 5 },
];

export function buildPrior(events: PriorEvent[]): PriorReport {
  const k = (xs: PriorEvent[], f: (e: PriorEvent) => boolean | null): Rate => {
    const d = xs.filter((e) => f(e) != null);
    return rate(d.filter((e) => f(e)).length, d.length);
  };
  const groups: PriorGroup[] = GROUPS.map((g) => {
    const xs = events.filter(g.pick);
    const decided = xs.filter((e) => e.go2 != null);
    const ev = xs.map((e) => e.ev).filter((x): x is number => x != null);
    return {
      id: g.id, label: g.label, n: xs.length, decided: decided.length,
      go2: k(xs, (e) => e.go2), go3: k(xs, (e) => e.go3), go5: k(xs, (e) => e.go5), collapse24: k(xs, (e) => e.collapse24),
      ev: ev.length >= 8 ? ev.reduce((a, b) => a + b, 0) / ev.length : null,
      medianMcap: xs.length >= 3 ? median(xs.map((e) => e.mcap)) : null,
    };
  });
  return {
    rule: `The first reading of a coin worth at least $${PRIOR.minMcap / 1000}K with at least $${PRIOR.minLiq / 1000}K of liquidity and a pair at least ${PRIOR.minPairAgeH} hours old.`,
    groups,
    note: "Measured from that reading over the next 72 hours: held for about half an hour, so a one-reading spike does not count. Only events whose whole window was seen are counted. It knows nothing about holders or organic trading, so for the Jupiter-list runners (which also have to look healthy) it is a floor, not a forecast.",
  };
}
