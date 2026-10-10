/**
 * One round of the lab, run by the learning tick (hosted) or on demand (laptop): collect what the scanner does not keep,
 * turn the coins that are due into lessons, and recompute the analyses about once an hour (or sooner when many lessons
 * changed). Bounded work per round: at most 25 lessons and a handful of requests, so it fits the free CPU budget.
 */

import { getPool } from "@aureus/db";
import { buildCoins, saveCoins, selectCandidates, selectWatch } from "./builder";
import { collectGeckoMulti, collectJupiter, collectPriceTail } from "./collectors";
import { collectWatch, discoverRunners } from "./lanes";
import { collectRegime } from "./regime";
import { collectStatic } from "./statics";
import { collectRugcheck } from "./rugcheck";
import { computeReports, saveReports } from "./reports";

const REPORT_EVERY_MIN = 55;
const REPORT_AFTER_CHANGES = 12;
/** Collector rows are folded into the lessons within a few days; the hosted database is small, the laptop keeps them for rebuilds. */
const KEEP_SIGNALS_DAYS = process.env.VERCEL ? 6 : 60;
/** Watch readings feed lessons that stay open for 8 days. */
const KEEP_WATCH_DAYS = process.env.VERCEL ? 9 : 14;

export async function runLab(opts: { force?: boolean; limit?: number } = {}): Promise<Record<string, unknown>> {
  const db = getPool();
  const out: Record<string, unknown> = {};
  const t0 = Date.now();
  const failure = (e: unknown) => ({ error: String((e as Error)?.message ?? e).slice(0, 160) });

  // The lab's own watch list: find runners on Jupiter's lists, read every watched coin that is due.
  out.runners = await discoverRunners(db, { force: opts.force }).catch(failure);
  out.watch = await collectWatch(db, { maxCalls: process.env.VERCEL ? 3 : 30 }).catch(failure);
  // The market backdrop (hourly) and what each coin's team paid for (launchpad, DexScreener profile, boosts, ads): both free.
  out.regime = await collectRegime(db, { force: opts.force }).catch(failure);
  out.statics = await collectStatic(db, { maxOrders: process.env.VERCEL ? 15 : 40 }).catch(failure);
  // who holds the newest coins (RugCheck's free report; laptop only)
  out.rugcheck = await collectRugcheck(db, { maxCalls: 8 }).catch(failure);
  out.priceTail = await collectPriceTail(db, { limit: 150 }).catch(failure);
  out.geckoMulti = await collectGeckoMulti(db, { maxCalls: 3 }).catch(failure);
  out.jupiter = await collectJupiter(db, { maxCalls: 3 }).catch(failure);

  const now = Date.now() / 1000;
  const cands = await selectCandidates(db, { limit: opts.limit ?? 25 });
  const watched = await selectWatch(db, { limit: process.env.VERCEL ? 12 : 150 });
  const built = await buildCoins(db, [...cands, ...watched], now);
  const saved = await saveCoins(db, built.coins, process.env.VERCEL ? "hosted" : "local");
  out.lessons = { due: cands.length, watched: watched.length, saved, skipped: built.skipped.length };

  const { rows } = await db.query(`SELECT EXTRACT(EPOCH FROM (now() - computed_at))::float8 AS age_s FROM lab_reports WHERE kind = 'meta'`).catch(() => ({ rows: [] as Array<{ age_s: number }> }));
  const ageMin = rows[0] ? rows[0].age_s / 60 : Infinity;
  const pending = Number(((await db.query(`SELECT count(*)::int AS n FROM lab_coins WHERE built_at > (SELECT COALESCE(max(computed_at), 'epoch') FROM lab_reports WHERE kind = 'meta')`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0));
  if (opts.force || ageMin >= REPORT_EVERY_MIN || pending >= REPORT_AFTER_CHANGES) {
    const reports = await computeReports(db);
    await saveReports(db, reports);
    out.reports = { computed: Object.keys(reports).length, coins: (reports.meta as { coins: number }).coins };
  } else out.reports = { skipped: true, ageMin: Math.round(ageMin), changed: pending };

  await db.query(`DELETE FROM lab_signals_ts WHERE source <> 'watch' AND taken_at < now() - make_interval(days => $1)`, [KEEP_SIGNALS_DAYS]).catch(() => undefined);
  await db.query(`DELETE FROM lab_signals_ts WHERE source = 'watch' AND taken_at < now() - make_interval(days => $1)`, [KEEP_WATCH_DAYS]).catch(() => undefined);
  // A lesson whose coin was first seen more than 8 days ago has nothing left to learn from, even if its readings were pruned since.
  await db.query(`UPDATE lab_coins SET status = 'final' WHERE status = 'open' AND first_seen_at < now() - interval '8 days'`).catch(() => undefined);
  out.ms = Date.now() - t0;
  return out;
}
