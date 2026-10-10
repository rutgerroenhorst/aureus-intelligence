/**
 * One round of the lab, run by the learning tick (hosted) or on demand (laptop): collect what the scanner does not keep,
 * turn the coins that are due into lessons, and recompute the analyses about once an hour (or sooner when many lessons
 * changed). Bounded work per round: at most 25 lessons and a handful of requests, so it fits the free CPU budget.
 */

import { getPool } from "@aureus/db";
import { buildCoins, saveCoins, selectCandidates } from "./builder";
import { collectGeckoMulti, collectJupiter, collectPriceTail } from "./collectors";
import { computeReports, saveReports } from "./reports";

const REPORT_EVERY_MIN = 55;
const REPORT_AFTER_CHANGES = 12;
/** Collector rows are folded into the lessons within a few days; the hosted database is small, the laptop keeps them for rebuilds. */
const KEEP_SIGNALS_DAYS = process.env.VERCEL ? 6 : 60;

export async function runLab(opts: { force?: boolean; limit?: number } = {}): Promise<Record<string, unknown>> {
  const db = getPool();
  const out: Record<string, unknown> = {};
  const t0 = Date.now();
  const failure = (e: unknown) => ({ error: String((e as Error)?.message ?? e).slice(0, 160) });

  out.priceTail = await collectPriceTail(db, { limit: 150 }).catch(failure);
  out.geckoMulti = await collectGeckoMulti(db, { maxCalls: 3 }).catch(failure);
  out.jupiter = await collectJupiter(db, { maxCalls: 3 }).catch(failure);

  const now = Date.now() / 1000;
  const cands = await selectCandidates(db, { limit: opts.limit ?? 25 });
  const built = await buildCoins(db, cands, now);
  const saved = await saveCoins(db, built.coins, process.env.VERCEL ? "hosted" : "local");
  out.lessons = { due: cands.length, saved, skipped: built.skipped.length };

  const { rows } = await db.query(`SELECT EXTRACT(EPOCH FROM (now() - computed_at))::float8 AS age_s FROM lab_reports WHERE kind = 'meta'`).catch(() => ({ rows: [] as Array<{ age_s: number }> }));
  const ageMin = rows[0] ? rows[0].age_s / 60 : Infinity;
  const pending = Number(((await db.query(`SELECT count(*)::int AS n FROM lab_coins WHERE built_at > (SELECT COALESCE(max(computed_at), 'epoch') FROM lab_reports WHERE kind = 'meta')`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0));
  if (opts.force || ageMin >= REPORT_EVERY_MIN || pending >= REPORT_AFTER_CHANGES) {
    const reports = await computeReports(db);
    await saveReports(db, reports);
    out.reports = { computed: Object.keys(reports).length, coins: (reports.meta as { coins: number }).coins };
  } else out.reports = { skipped: true, ageMin: Math.round(ageMin), changed: pending };

  await db.query(`DELETE FROM lab_signals_ts WHERE taken_at < now() - make_interval(days => $1)`, [KEEP_SIGNALS_DAYS]).catch(() => undefined);
  out.ms = Date.now() - t0;
  return out;
}
