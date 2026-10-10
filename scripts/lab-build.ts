/**
 * Build (or rebuild) the Learning Lab's lessons from everything a database holds, then compute the reports.
 *
 *   corepack pnpm exec tsx scripts/lab-build.ts            # laptop database (DATABASE_URL, default localhost)
 *   LAB_REPORTS_ONLY=1 corepack pnpm exec tsx scripts/lab-build.ts   # only recompute the reports from the stored lessons
 *
 * The laptop database holds a month of history; the hosted one keeps 7 days. Run this on the laptop, then copy the
 * lessons across with scripts/lab-push.ts so the hosted site starts with the same depth.
 */
import pg from "pg";
import { buildCoins, saveCoins, selectCandidates } from "../apps/web/lib/lab/builder";
import { computeReports, saveReports } from "../apps/web/lib/lab/reports";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const source = process.env.LAB_SOURCE ?? "local";
const batch = Number(process.env.LAB_BATCH ?? 40);
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 });

async function main() {
  const t0 = Date.now();
  if (!process.env.LAB_REPORTS_ONLY) {
    const cands = await selectCandidates(pool, { limit: 1_000_000, all: true });
    console.log(`candidates to build: ${cands.length}`);
    const now = Date.now() / 1000;
    let built = 0;
    let skipped = 0;
    for (let i = 0; i < cands.length; i += batch) {
      const { coins, skipped: sk } = await buildCoins(pool, cands.slice(i, i + batch), now);
      built += await saveCoins(pool, coins, source);
      skipped += sk.length;
      if ((i / batch) % 5 === 4 || i + batch >= cands.length) console.log(`  ${Math.min(i + batch, cands.length)}/${cands.length}  built ${built}  skipped ${skipped}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }
  const reports = await computeReports(pool);
  await saveReports(pool, reports);
  console.log(`reports: ${Object.keys(reports).join(", ")}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
