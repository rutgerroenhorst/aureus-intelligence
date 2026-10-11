/**
 * The user's own entries, graded like a Radar tab.
 *
 * "Do the Radar tabs add anything?" asks that of each list the Radar makes. This asks it of the one list that matters most: the coins the
 * user really bought (the followed wallet's first buy of each coin). Each entry is matched to the lab's snapshot of the coin closest in time
 * to the buy (within 3 hours, with a decided 72 h window) and what the following days held is compared with the lab's other coins at the
 * same ages: the same labels and the same test as the tabs, so the answer is comparable. It also says what the lab had of each coin at the
 * moment of the buy, and where the entries sit among the other coins at that age: a busy coin that is already rising crashes more often
 * (measured on the lab's coins, held on later ones), so a habit of buying those shows up here before it shows up in the money.
 *
 * Counts and rates only: no coin, address or dollar amount is stored, because the report is served to the public site.
 */

import type { LabCoin, Queryable } from "../builder";
import { median } from "../stats";
import { rate, type Rate } from "./common";
import { gradeListings, universeOf, type Graded } from "./tabs";

/** The features that say how hot a coin was at the moment (label for the page). */
const SITS: Array<{ key: string; label: string }> = [
  { key: "trades_h1", label: "Trades in the last hour" },
  { key: "vol_h1", label: "Volume in the last hour" },
  { key: "pc_h6", label: "Price change over 6 hours" },
  { key: "pair_age_h", label: "Age of the pool" },
  { key: "liq", label: "Pool liquidity" },
  { key: "mcap", label: "Market cap" },
];

export interface OwnReport {
  /** entries are the coins first bought inside this window (days back from now), after the lab started following coins */
  days: number;
  entries: number;
  /** what the lab had of the coin at the moment of the first buy */
  knowledge: {
    /** on the Radar's own list (the door had let it in) */
    radarBefore: number;
    /** followed on one of the lab's other lanes (turned away at the door, or on Jupiter's lists) */
    otherLaneBefore: number;
    /** first seen only after the buy */
    after: number;
    /** never seen */
    never: number;
  };
  graded: Omit<Graded, "rows"> | null;
  /** where the matched entries sit among the lab's other coins of the same age (percentile 0-100, 50 = the middle) */
  sits: Array<{ key: string; label: string; n: number; median: number; above: Rate }>;
  note: string;
}

/** Share of the values that lie below `x` (ties count half), 0-100. */
export function percentileOf(values: number[], x: number): number | null {
  if (!values.length) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return (100 * (below + equal / 2)) / values.length;
}

export async function buildOwn(db: Queryable, all: LabCoin[], radar: LabCoin[], opts: { days?: number } = {}): Promise<OwnReport | null> {
  const days = opts.days ?? 60;
  const { rows } = await db
    .query(
      `SELECT mint, EXTRACT(EPOCH FROM min(t) FILTER (WHERE side = 'buy'))::float8 AS t
         FROM wallet_fills GROUP BY mint
       HAVING count(*) FILTER (WHERE side = 'buy') > 0 AND min(t) FILTER (WHERE side = 'buy') > now() - make_interval(days => $1::int)`,
      [days],
    )
    .catch(() => ({ rows: [] as Array<{ mint: string; t: number }> }));
  if (!rows.length || !all.length) return null;
  // before the lab existed "never seen" would only mean "not recorded yet"
  const start = Math.min(...all.map((c) => c.firstSeenAt));
  const entries = (rows as Array<{ mint: string; t: number }>).filter((r) => r.t >= start);
  if (!entries.length) return null;

  const byMint = new Map(all.map((c) => [c.mint, c]));
  const knowledge = { radarBefore: 0, otherLaneBefore: 0, after: 0, never: 0 };
  for (const e of entries) {
    const c = byMint.get(e.mint);
    if (!c) knowledge.never++;
    else if (c.firstSeenAt > e.t) knowledge.after++;
    else if (c.lane === "fresh") knowledge.radarBefore++;
    else knowledge.otherLaneBefore++;
  }

  const universe = universeOf(radar);
  const { rows: matched, ...graded } = gradeListings(radar, entries, universe);
  const sits: OwnReport["sits"] = [];
  for (const { key, label } of SITS) {
    const ps: number[] = [];
    for (const m of matched) {
      const v = m.f[key];
      if (v == null || !Number.isFinite(v)) continue;
      const u = (universe.get(m.tau) ?? []).map((r) => r.f[key]).filter((x): x is number => x != null && Number.isFinite(x));
      const q = percentileOf(u, v);
      if (q != null) ps.push(q);
    }
    if (ps.length >= 10) sits.push({ key, label, n: ps.length, median: median(ps), above: rate(ps.filter((q) => q > 50).length, ps.length) });
  }
  return {
    days,
    entries: entries.length,
    knowledge,
    graded,
    sits,
    note: "Entries are matched to the lab's snapshot closest in time to the buy, so what is measured is what followed the buy. Only coins the Radar admitted can be matched; the others are counted under what the lab knew. Percentile 50 means a typical coin of that age.",
  };
}
