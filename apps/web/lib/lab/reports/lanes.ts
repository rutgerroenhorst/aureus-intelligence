/**
 * Lanes: who the lab follows besides the Radar's own coins, and how they did.
 *
 *   The Radar          coins the door admitted (pair at least 60 minutes old, at most $150K): every other analysis is about these
 *   Too young          coins the door turned away for being under 60 minutes old (watched from when the worker first saw them)
 *   Too big            coins the door turned away for being worth more than $150K
 *   Runners            coins found on Jupiter's organic-score / most-traded / trending lists that look like HOTBOT did
 *
 * Every lane is measured from the moment the lab first saw the coin, so a runner's "first look" is usually already after a big
 * move. The point is not to compare lanes as if they were entered at the same moment, but to learn what each kind of coin does
 * from the moment the system could first have known about it.
 */

import type { LabCoin } from "../builder";
import { aiNameWide } from "../narrative";
import { fisherExact, median } from "../stats";
import { rate, type Rate } from "./common";

export interface LaneGroup {
  id: string;
  label: string;
  about: string;
  n: number;
  /** coins followed for the whole 72 hours (with enough readings): the base of every rate below */
  basis: number;
  held2: Rate;
  held3: Rate;
  held5: Rate;
  held10: Rate;
  /** of the coins that held 1.5x at some point, the share that stood below their first price when the 72 hours were over (the fade) */
  faded: Rate;
  medianFirstMcap: number | null;
  medianFirstLiq: number | null;
  /** hours between the pair being created and the lab's first look */
  medianPairAgeH: number | null;
  watching: number;
  ai: { in: { n: number; held2: Rate }; out: { n: number; held2: Rate }; p: number | null } | null;
}

export interface LanesReport {
  groups: LaneGroup[];
  note: string;
}

const GROUPS: Array<{ id: string; label: string; about: string; pick: (c: LabCoin) => boolean }> = [
  { id: "fresh", label: "The Radar", about: "Coins the door admitted: a pair at least 60 minutes old and worth at most $150K.", pick: (c) => c.lane === "fresh" },
  { id: "young", label: "Turned away: too young", about: "Under 60 minutes old when the worker first saw them (graduations in their first hour). Watched from that moment.", pick: (c) => c.lane === "graduate" },
  { id: "big", label: "Turned away: too big", about: "Worth more than $150K when the worker first saw them, between one hour and two days old.", pick: (c) => c.lane === "runner" && c.tags.includes("via:too_big") },
  { id: "runners", label: "Runners from Jupiter's lists", about: "Found on the organic-score, most-traded or trending top lists: $0.3M to $150M, three hours to two months old, real liquidity and thousands of holders.", pick: (c) => c.lane === "runner" && c.tags.some((t) => t.startsWith("via:jupiter")) },
];

const full = (c: LabCoin) => c.outcome.readings >= 8 && c.outcome.ageH >= 72 * 0.95;

export function buildLanes(coins: LabCoin[], watching: Record<string, number> = {}): LanesReport {
  const groups: LaneGroup[] = GROUPS.map((g) => {
    const cs = coins.filter(g.pick);
    const base = cs.filter(full);
    const held = (x: number) => rate(base.filter((c) => c.outcome.peakHeld.h72 >= x).length, base.length);
    const firstSnap = cs.map((c) => c.snaps.find((s) => s.tau === 0)?.f).filter((f): f is NonNullable<typeof f> => !!f);
    const med = (key: string) => {
      const v = firstSnap.map((f) => f[key]).filter((x): x is number => x != null && Number.isFinite(x));
      return v.length >= 5 ? median(v) : null;
    };
    const ai = base.length >= 20 ? aiSplit(base) : null;
    return {
      id: g.id, label: g.label, about: g.about, n: cs.length, basis: base.length,
      held2: held(2), held3: held(3), held5: held(5), held10: held(10),
      faded: rate(base.filter((c) => c.outcome.peakHeld.h72 >= 1.5 && (c.outcome.finalMult.h72 ?? 1) < 1).length, base.filter((c) => c.outcome.peakHeld.h72 >= 1.5).length),
      medianFirstMcap: med("mcap"), medianFirstLiq: med("liq"), medianPairAgeH: med("pair_age_h"),
      watching: watching[g.id] ?? 0,
      ai,
    };
  });
  return {
    groups,
    note: "Rates are measured from the moment the lab first saw each coin, over the next 72 hours (held = the price stayed there for about half an hour). A lane with few coins followed for the full 72 hours says very little yet.",
  };
}

function aiSplit(base: LabCoin[]) {
  const a = base.filter((c) => aiNameWide(c.name, c.symbol));
  const o = base.filter((c) => !aiNameWide(c.name, c.symbol));
  const k = (cs: LabCoin[]) => cs.filter((c) => c.outcome.peakHeld.h72 >= 2).length;
  if (!a.length || !o.length) return { in: { n: a.length, held2: rate(k(a), a.length) }, out: { n: o.length, held2: rate(k(o), o.length) }, p: null };
  return { in: { n: a.length, held2: rate(k(a), a.length) }, out: { n: o.length, held2: rate(k(o), o.length) }, p: fisherExact(k(a), a.length - k(a), k(o), o.length - k(o)) };
}
