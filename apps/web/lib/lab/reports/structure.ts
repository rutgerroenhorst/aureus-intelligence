/**
 * Where a coin trades says a lot about how it ends, and nobody had to pick a threshold to see it: coins on PumpSwap (the pool a pump.fun
 * graduate lands in) against coins on Raydium and elsewhere, at the first look, for the Radar's own coins.
 *
 * The comparison is made inside age bands too (1-6 h, 6-24 h, 1-7 d), so that "PumpSwap coins are simply younger" cannot explain it.
 * A finding is only raised when the difference is large, clearly beyond chance, and points the same way in every age band that has
 * enough coins. Descriptive: it says nothing about why, and nothing about what a coin that is not in these lists would do.
 */

import type { LabCoin } from "../builder";
import { fisherExact } from "../stats";
import { rate, type Rate } from "./common";

export interface VenueGroup {
  id: "pumpswap" | "raydium" | "other";
  label: string;
  /** coins with a first look in this group */
  n: number;
  held2: Rate;
  held5: Rate;
  /** coins whose price peaked at 10x or more of the first look within 72 hours (held for about half an hour) */
  peak10: Rate;
  lostHalf: Rate;
  /** mean result of the example exit plan (1.0 = break even) over the coins where it was decided */
  ev: number | null;
}

export interface VenueBand {
  band: string;
  pump: { lostHalf: Rate; held2: Rate };
  ray: { lostHalf: Rate; held2: Rate };
}

export interface VenueFinding {
  diff: number;
  p: number;
  text: string;
}

export interface StructureReport {
  venue: { groups: VenueGroup[]; bands: VenueBand[]; finding: VenueFinding | null };
  note: string;
}

const BANDS: Array<[string, number, number]> = [
  ["1 to 6 hours old", 1, 6],
  ["6 to 24 hours old", 6, 24],
  ["1 to 7 days old", 24, 168],
];

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

function venueOf(coin: LabCoin): VenueGroup["id"] | null {
  const f = coin.snaps.find((s) => s.tau === 0)?.f;
  if (!f || f.dex_pumpswap == null) return null;
  if (f.dex_pumpswap === 1) return "pumpswap";
  if (f.dex_raydium === 1) return "raydium";
  return "other";
}

function tally(coins: LabCoin[]) {
  let k2 = 0, n2 = 0, k5 = 0, n5 = 0, kc = 0, nc = 0, k10 = 0, evSum = 0, evN = 0;
  for (const c of coins) {
    const y = c.snaps.find((s) => s.tau === 0)?.y;
    if (!y) continue;
    if (y.go2 != null) { n2++; if (y.go2) k2++; if (y.peak72 >= 10) k10++; }
    if (y.go5 != null) { n5++; if (y.go5) k5++; }
    if (y.collapse24 != null) { nc++; if (y.collapse24) kc++; }
    if (y.ev != null) { evN++; evSum += y.ev; }
  }
  return { held2: rate(k2, n2), held5: rate(k5, n5), peak10: rate(k10, n2), lostHalf: rate(kc, nc), ev: evN ? evSum / evN : null };
}

export function buildStructure(coins: LabCoin[]): StructureReport {
  const by: Record<VenueGroup["id"], LabCoin[]> = { pumpswap: [], raydium: [], other: [] };
  for (const c of coins) {
    const v = venueOf(c);
    if (v) by[v].push(c);
  }
  const labels: Record<VenueGroup["id"], string> = { pumpswap: "PumpSwap (pump.fun graduates)", raydium: "Raydium", other: "Other exchanges" };
  const groups: VenueGroup[] = (["pumpswap", "raydium", "other"] as const).map((id) => ({ id, label: labels[id], n: by[id].length, ...tally(by[id]) }));

  const ageOf = (c: LabCoin) => c.snaps.find((s) => s.tau === 0)?.f.pair_age_h ?? null;
  const bands: VenueBand[] = BANDS.map(([band, lo, hi]) => {
    const inBand = (c: LabCoin) => {
      const a = ageOf(c);
      return a != null && a >= lo && a < hi;
    };
    const p = tally(by.pumpswap.filter(inBand));
    const r = tally(by.raydium.filter(inBand));
    return { band, pump: { lostHalf: p.lostHalf, held2: p.held2 }, ray: { lostHalf: r.lostHalf, held2: r.held2 } };
  });

  const P = groups[0]!;
  const R = groups[1]!;
  let finding: VenueFinding | null = null;
  if (P.lostHalf.n >= 100 && R.lostHalf.n >= 100) {
    const diff = P.lostHalf.p - R.lostHalf.p;
    const p = fisherExact(P.lostHalf.k, P.lostHalf.n - P.lostHalf.k, R.lostHalf.k, R.lostHalf.n - R.lostHalf.k);
    const usable = bands.filter((b) => b.pump.lostHalf.n >= 30 && b.ray.lostHalf.n >= 30);
    const sameWay = usable.length >= 2 && usable.every((b) => b.pump.lostHalf.p > b.ray.lostHalf.p);
    if (diff >= 0.15 && p < 0.01 && sameWay) {
      finding = {
        diff,
        p,
        text: `On PumpSwap ${pct(P.lostHalf.p)} of coins lost half within a day, against ${pct(R.lostHalf.p)} on Raydium (${P.lostHalf.n} and ${R.lostHalf.n} coins). Per coin, the chance of a 5x is about the same (${pct(P.held5.p, 1)} against ${pct(R.held5.p, 1)}), and PumpSwap supplied ${P.peak10.k} of the ${groups.reduce((a, g) => a + g.peak10.k, 0)} coins that peaked at 10x or more. It holds in every age band with enough coins. It is a description of the coins on each venue, not a verdict on the venue.`,
      };
    }
  }
  return { venue: { groups, bands, finding }, note: "Coins the Radar listed, compared at their first look. The age bands keep a younger average age on one side from explaining the gap. It is a description of what happened, not a rule." };
}
