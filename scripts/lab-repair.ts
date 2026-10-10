/**
 * One-off: for coins the scanner dropped (rejected, expired, dormant) and the lab marks "censored", fetch the hourly closes
 * after the last reading from GeckoTerminal, so that what happened to them afterwards is known. Safe to stop and restart: coins
 * that already have a candle tail are skipped. Then run scripts/lab-build.ts again to fold the tails into the lessons.
 *
 *   corepack pnpm exec tsx scripts/lab-repair.ts          # all censored coins, ~8 requests a minute
 */
import pg from "pg";
import { repairWithCandles } from "../apps/web/lib/lab/collectors";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const pool = new pg.Pool({ connectionString: url, max: 2 });
const delayMs = Number(process.env.LAB_REPAIR_DELAY_MS ?? 7500);

async function main() {
  const t0 = Date.now();
  let total = { done: 0, empty: 0, failed: 0 };
  for (;;) {
    const r = await repairWithCandles(pool, {
      limit: 50, delayMs,
      onProgress: (d, n) => { if (d % 10 === 0) console.log(`  batch ${d}/${n}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`); },
    });
    total = { done: total.done + r.done, empty: total.empty + r.empty, failed: total.failed + r.failed };
    console.log("batch finished", r, "total", total);
    if (r.done + r.failed === 0 || (r.done === 0 && r.failed > 0)) break; // nothing left, or only failures: stop instead of hammering
  }
  console.log("repair finished", total, `${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => undefined); process.exit(1); });
