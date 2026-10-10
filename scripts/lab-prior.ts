/**
 * Compute the runner prior (what coins did after crossing $300K with real liquidity) from the price history in the database and
 * store it as the "prior" report. Run on the laptop (it needs the full history); lab-push.ts copies it to the hosted database.
 *
 *   corepack pnpm exec tsx scripts/lab-prior.ts
 */
import pg from "pg";
import { loadObs, selectCandidates } from "../apps/web/lib/lab/builder";
import { buildPrior, eventOf, type PriorEvent } from "../apps/web/lib/lab/reports/prior";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 });

async function main() {
  const cands = await selectCandidates(pool, { limit: 1_000_000, all: true });
  const events: PriorEvent[] = [];
  for (let i = 0; i < cands.length; i += 40) {
    const batch = cands.slice(i, i + 40);
    const obs = await loadObs(pool, batch);
    for (const c of batch) {
      const e = eventOf(c.mint, obs.get(c.pool_id) ?? [], c.pool_created);
      if (e) events.push(e);
    }
  }
  const report = buildPrior(events);
  await pool.query(
    `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ('prior', now(), $1, $2::jsonb)
     ON CONFLICT (kind) DO UPDATE SET computed_at = now(), n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
    [events.length, JSON.stringify(report)],
  );
  console.log(`${cands.length} coins read, ${events.length} crossed; decided ${report.groups[0]!.decided}`);
  for (const g of report.groups) {
    const p = (r: { p: number; k: number; n: number }) => (r.n ? `${(r.p * 100).toFixed(0)}% (${r.k}/${r.n})` : "-");
    console.log(`${g.label.padEnd(44)} n=${String(g.n).padStart(3)} decided=${String(g.decided).padStart(3)}  held2 ${p(g.go2).padEnd(12)} held3 ${p(g.go3).padEnd(12)} held5 ${p(g.go5).padEnd(10)} lost half ${p(g.collapse24).padEnd(12)} plan ${g.ev == null ? "-" : ((g.ev - 1) * 100).toFixed(0) + "%"}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
