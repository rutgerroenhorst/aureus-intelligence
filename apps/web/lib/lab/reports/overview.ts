import type { LabCoin } from "../builder";
import { CLASS_ORDER, type OutcomeClass } from "../outcomes";
import { median } from "../stats";
import { rate, type Rate } from "./common";

export const CLASS_TEXT: Record<OutcomeClass, { label: string; definition: string }> = {
  MOONSHOT: { label: "Moonshot", definition: "Held 10x or more (the price stayed there about half an hour)." },
  RUNNER: { label: "Runner", definition: "Held 3x to 10x." },
  BOUNCE: { label: "Bounce", definition: "Held 1.5x to 3x." },
  ZOMBIE: { label: "Zombie", definition: "Still trading after a day, between half and 1.5x of its first price. Nothing happens." },
  BLEED: { label: "Slow bleed", definition: "Lost half of its value over the first day without a sharp fall." },
  DUMP: { label: "Dump", definition: "Fell to half within 6 hours and never held 1.5x." },
  RUG: { label: "Rug", definition: "The pool was drained and the price collapsed." },
  DEAD: { label: "Dead", definition: "No pool left." },
  OPEN: { label: "Too early or too few readings", definition: "Not followed long enough, or fewer than 8 clean readings, to call." },
};

export interface OverviewReport {
  coins: { total: number; open: number; final: number; censored: number; thin: number; withPhantoms: number; phantomReadings: number };
  byClass: Array<{ cls: OutcomeClass; label: string; definition: string; n: number; share: number }>;
  firstSeen: { from: number; to: number; days: number; perDay: number } | null;
  /** coins followed for the full 72 hours: how many held 1.5x, 2x, 3x, 5x, 10x of their first price */
  held: { basis: number; x15: Rate; x2: Rate; x3: Rate; x5: Rate; x10: Rate };
  /** decision moments: how many coins have a snapshot, and how many of those have a decided 72 h outcome */
  moments: Array<{ tau: number; snaps: number; decided: number }>;
  lanes: Record<string, number>;
  medianReadings: number;
}

export function buildOverview(coins: LabCoin[]): OverviewReport {
  const byCls = new Map<OutcomeClass, number>();
  for (const c of coins) byCls.set(c.outcome.cls, (byCls.get(c.outcome.cls) ?? 0) + 1);
  const full = coins.filter((c) => c.outcome.readings >= 8 && c.outcome.ageH >= 72 * 0.95);
  const held = (x: number) => rate(full.filter((c) => c.outcome.peakHeld.h72 >= x).length, full.length);
  const firsts = coins.map((c) => c.firstSeenAt);
  const from = firsts.length ? Math.min(...firsts) : 0;
  const to = firsts.length ? Math.max(...firsts) : 0;
  const days = Math.max(1, (to - from) / 86400);
  const taus = [0, 1, 3, 6, 12, 24];
  const lanes: Record<string, number> = {};
  for (const c of coins) lanes[c.lane] = (lanes[c.lane] ?? 0) + 1;
  return {
    coins: {
      total: coins.length,
      open: coins.filter((c) => c.status === "open").length,
      final: coins.filter((c) => c.status === "final").length,
      censored: coins.filter((c) => c.outcome.censored).length,
      thin: coins.filter((c) => c.outcome.readings < 8).length,
      withPhantoms: coins.filter((c) => c.phantoms > 0).length,
      phantomReadings: coins.reduce((s, c) => s + c.phantoms, 0),
    },
    byClass: CLASS_ORDER.filter((cls) => byCls.has(cls)).map((cls) => ({ cls, ...CLASS_TEXT[cls], n: byCls.get(cls)!, share: byCls.get(cls)! / Math.max(1, coins.length) })),
    firstSeen: firsts.length ? { from, to, days, perDay: coins.length / days } : null,
    held: { basis: full.length, x15: held(1.5), x2: held(2), x3: held(3), x5: held(5), x10: held(10) },
    moments: taus.map((tau) => {
      const snaps = coins.flatMap((c) => c.snaps.filter((s) => s.tau === tau));
      return { tau, snaps: snaps.length, decided: snaps.filter((s) => s.y && s.y.go2 != null).length };
    }),
    lanes,
    medianReadings: coins.length ? median(coins.map((c) => c.outcome.readings)) : 0,
  };
}
