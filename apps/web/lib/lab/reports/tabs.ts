/**
 * Do the Radar tabs add anything? Each time a coin was listed on a tab, the lab finds its snapshot closest in time and reads
 * what the next 72 hours held, then compares the tab's coins with the lab's other coins at the same age. A tab only "beats"
 * the rest when the difference is bigger than chance, which with the few coins listed so far it rarely is yet.
 */

import type { LabCoin } from "../builder";
import type { Queryable } from "../builder";
import { fisherExact, mean } from "../stats";
import { evOf, group, rate, rowsFor, type Group, type Rate, type Row } from "./common";

export interface TabRow {
  tab: string;
  listed: number;
  matched: number;
  tab_: Group;
  /** the lab's other coins at the same ages (so a tab that lists old coins is not compared with new ones) */
  baseline: { go2: number | null; collapse24: number | null; ev: number | null };
  pGo2: number | null;
  verdict: "better" | "worse" | "same" | "thin";
}

export interface TabsReport {
  tabs: TabRow[];
  note: string;
}

export async function buildTabs(db: Queryable, coins: LabCoin[]): Promise<TabsReport> {
  const { rows } = await db
    .query(`SELECT tab_name, mint, EXTRACT(EPOCH FROM qualified_at)::float8 AS t FROM coin_qualifications`)
    .catch(() => ({ rows: [] as Array<{ tab_name: string; mint: string; t: number }> }));
  const byMint = new Map(coins.map((c) => [c.mint, c]));
  const universe = new Map<number, Row[]>();
  for (const tau of [0, 1, 3, 6, 12, 24]) universe.set(tau, rowsFor(coins, tau));
  const tabs = new Map<string, { listed: number; rows: Row[] }>();
  for (const q of rows) {
    const e = tabs.get(q.tab_name) ?? { listed: 0, rows: [] };
    e.listed++;
    const coin = byMint.get(q.mint);
    if (coin) {
      let best: { s: (typeof coin.snaps)[number]; d: number } | null = null;
      for (const s of coin.snaps) {
        const d = Math.abs(s.ts - q.t);
        if (s.y && d <= 3 * 3600 && (!best || d < best.d)) best = { s, d };
      }
      if (best) e.rows.push({ coin, tau: best.s.tau, t0: coin.firstSeenAt, f: best.s.f, y: best.s.y! });
    }
    tabs.set(q.tab_name, e);
  }
  const out: TabRow[] = [];
  for (const [tab, e] of tabs) {
    const g = group(e.rows);
    // baseline: every other lab coin's snapshot at the same moments, weighted by how often the tab sampled each moment
    const taus = e.rows.map((r) => r.tau);
    const pick = (f: (r: Row) => number | null) => {
      const vals: number[] = [];
      for (const tau of taus) {
        const u = (universe.get(tau) ?? []).map(f).filter((x): x is number => x != null);
        if (u.length) vals.push(mean(u));
      }
      return vals.length ? mean(vals) : null;
    };
    const baseGo2 = pick((r) => (r.y.go2 == null ? null : r.y.go2 ? 1 : 0));
    const baseCol = pick((r) => (r.y.collapse24 == null ? null : r.y.collapse24 ? 1 : 0));
    const baseEv = pick((r) => r.y.ev);
    const pGo2: number | null =
      g.go2.n >= 15 && baseGo2 != null ? fisherExact(g.go2.k, g.go2.n - g.go2.k, Math.round(baseGo2 * 1000), Math.round((1 - baseGo2) * 1000)) : null;
    let verdict: TabRow["verdict"] = "thin";
    if (g.go2.n >= 25) verdict = pGo2 != null && pGo2 < 0.05 ? (g.go2.p > (baseGo2 ?? 0) ? "better" : "worse") : "same";
    out.push({ tab, listed: e.listed, matched: e.rows.length, tab_: g, baseline: { go2: baseGo2, collapse24: baseCol, ev: baseEv }, pGo2, verdict });
  }
  out.sort((a, b) => b.listed - a.listed);
  return {
    tabs: out,
    note: "A coin is matched to the lab's snapshot closest in time to when the tab listed it (within 3 hours), so what is measured is what happened AFTER the listing, not before it.",
  };
}

export { evOf, rate };
export type { Rate };
