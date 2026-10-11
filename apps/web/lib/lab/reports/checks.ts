/**
 * The user's Check presses, graded: "do your doubts hold?"
 *
 * On a Radar card the user can press Check on a coin that looks dead or out of place (lib/coinCheck.ts). The site answers at once from fresh numbers, and
 * keeps the check. This asks the harder question later: of the coins the user doubted, how many really went on to lose half within a day, against the lab's
 * other coins of the same age (the same labels and the same test as the tabs and "Your own entries")? If the doubts predict nothing, this says so.
 *
 * Counts and rates only: no coin, address or dollar amount is stored, because the report is served to the public site.
 */

import type { LabCoin, Queryable } from "../builder";
import { gradeListings, universeOf, type Graded } from "./tabs";

export interface ChecksReport {
  /** checks inside this window (days back from now) */
  days: number;
  checks: number;
  coins: number;
  /** what the site concluded at the time */
  agree: number;
  disagree: number;
  unclear: number;
  /** checked coins the same tab listed again afterwards (a new row in coin_qualifications) */
  returned: number;
  /** the checked coins the lab could match to a decided 72-hour window, graded like a tab; null when none could be */
  graded: Omit<Graded, "rows"> | null;
  note: string;
}

export async function buildChecks(db: Queryable, radar: LabCoin[], opts: { days?: number } = {}): Promise<ChecksReport | null> {
  const days = opts.days ?? 60;
  const { rows } = await db
    .query(
      `SELECT c.mint, c.verdict, EXTRACT(EPOCH FROM c.created_at)::float8 AS t,
              EXISTS (SELECT 1 FROM coin_qualifications q WHERE q.mint = c.mint AND q.tab_name = c.tab AND q.qualified_at > c.created_at) AS returned
         FROM coin_checks c WHERE c.created_at > now() - make_interval(days => $1::int)`,
      [days],
    )
    .catch(() => ({ rows: [] as Array<{ mint: string; verdict: string; t: number; returned: boolean }> }));
  if (!rows.length) return null;
  const list = rows as Array<{ mint: string; verdict: string; t: number; returned: boolean }>;
  // a coin pressed twice counts once (its first press), so one doubtful coin cannot weigh twice
  const first = new Map<string, { mint: string; t: number }>();
  for (const r of [...list].sort((a, b) => a.t - b.t)) if (!first.has(r.mint)) first.set(r.mint, { mint: r.mint, t: r.t });
  let graded: ChecksReport["graded"] = null;
  if (radar.length) {
    const { rows: _matched, ...g } = gradeListings(radar, [...first.values()], universeOf(radar));
    void _matched;
    graded = g.matched > 0 ? g : null;
  }
  return {
    days,
    checks: list.length,
    coins: first.size,
    agree: list.filter((r) => r.verdict === "agree").length,
    disagree: list.filter((r) => r.verdict === "disagree").length,
    unclear: list.filter((r) => r.verdict === "unclear").length,
    returned: new Set(list.filter((r) => r.returned).map((r) => r.mint)).size,
    graded,
    note: "Each checked coin is matched to the lab's snapshot closest in time to its first Check (within 3 hours, with a decided 72 h window) and compared with the lab's other coins of the same ages. Only coins the Radar admitted can be matched. Your doubt is a hypothesis: it counts as right only if such coins really lose more often.",
  };
}
