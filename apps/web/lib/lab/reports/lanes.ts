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
import { rate, type Rate, followedFully } from "./common";

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

export interface SplitRow {
  label: string;
  n: number;
  held2: Rate;
  held3: Rate;
  /** worth half or less at some point within the first day */
  halved24: Rate;
}

export interface LanesReport {
  groups: LaneGroup[];
  /** what separates pump.fun graduations that went on from those that did not (needs a few dozen followed graduations) */
  pumpAnatomy: SplitRow[];
  note: string;
}

const GROUPS: Array<{ id: string; label: string; about: string; pick: (c: LabCoin) => boolean }> = [
  { id: "fresh", label: "The Radar", about: "Coins the door admitted: a pair at least 60 minutes old and worth at most $150K.", pick: (c) => c.lane === "fresh" },
  { id: "young", label: "Turned away: too young", about: "Under 60 minutes old when the worker first saw them (graduations in their first hour). Watched from that moment.", pick: (c) => c.lane === "graduate" && !c.tags.includes("via:pump_migration") },
  { id: "pump", label: "pump.fun graduations from minute 0", about: "Every coin that graduates from pump.fun to PumpSwap, taken from pump.fun's own free event stream the moment it graduates (needs the laptop worker or lab daemon running).", pick: (c) => c.lane === "graduate" && c.tags.includes("via:pump_migration") },
  { id: "big", label: "Turned away: too big", about: "Worth more than $150K when the worker first saw them, between one hour and two days old.", pick: (c) => c.lane === "runner" && c.tags.includes("via:too_big") },
  { id: "runners", label: "Runners from Jupiter's lists", about: "Found on the organic-score, most-traded or trending top lists: $0.3M to $150M, three hours to two months old, real liquidity and thousands of holders.", pick: (c) => c.lane === "runner" && c.tags.some((t) => t.startsWith("via:jupiter")) },
];

const full = (c: LabCoin) => followedFully(c.outcome);

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
    pumpAnatomy: pumpAnatomy(coins.filter(GROUPS.find((g) => g.id === "pump")!.pick).filter(full)),
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

/**
 * Splits of the pump.fun graduations the lab saw live, by what pump.fun's event stream knew at the moment of graduation: how long the
 * coin took, how much its creator bought in the launch transaction, whether it was launched in Mayhem Mode, whether the creator is a
 * serial launcher. Only shown when each side has at least 8 coins, so a small split never reads like a finding.
 */
function pumpAnatomy(base: LabCoin[]): SplitRow[] {
  if (base.length < 30) return [];
  const f0 = (c: LabCoin) => c.snaps.find((x) => x.tau === 0)?.f;
  const row = (label: string, xs: LabCoin[]): SplitRow => ({
    label, n: xs.length,
    held2: rate(xs.filter((c) => c.outcome.peakHeld.h72 >= 2).length, xs.length),
    held3: rate(xs.filter((c) => c.outcome.peakHeld.h72 >= 3).length, xs.length),
    halved24: rate(xs.filter((c) => c.outcome.minMult.h24 <= 0.5).length, xs.length),
  });
  const splits: Array<[string, (f: Record<string, number | null>) => boolean | null]> = [
    ["Graduated within 2 minutes of launch (the creator bought the whole curve)", (f) => (f.grad_minutes == null ? null : f.grad_minutes < 2)],
    ["Took 2 minutes to 2 hours to graduate", (f) => (f.grad_minutes == null ? null : f.grad_minutes >= 2 && f.grad_minutes < 120)],
    ["Took more than 2 hours to graduate", (f) => (f.grad_minutes == null ? null : f.grad_minutes >= 120)],
    ["Launched in Mayhem Mode", (f) => (f.pump_mayhem == null ? null : f.pump_mayhem === 1)],
    ["Not Mayhem Mode", (f) => (f.pump_mayhem == null ? null : f.pump_mayhem === 0)],
    ["Creator launched 5 or more coins in the 72 h before", (f) => (f.creator_launches == null ? null : f.creator_launches >= 5)],
    ["Creator's first coin in 72 h", (f) => (f.creator_launches == null ? null : f.creator_launches <= 1)],
    ["Creator bought under 1 SOL at launch", (f) => (f.dev_buy_sol == null ? null : f.dev_buy_sol < 1)],
    ["Creator bought 1 to 50 SOL at launch", (f) => (f.dev_buy_sol == null ? null : f.dev_buy_sol >= 1 && f.dev_buy_sol < 50)],
    ["Creator bought 50 SOL or more at launch", (f) => (f.dev_buy_sol == null ? null : f.dev_buy_sol >= 50)],
  ];
  const out: SplitRow[] = [row("All pump.fun graduations followed", base)];
  for (const [label, test] of splits) {
    const xs = base.filter((c) => {
      const f = f0(c);
      return f ? test(f) === true : false;
    });
    if (xs.length >= 8) out.push(row(label, xs));
  }
  return out;
}
