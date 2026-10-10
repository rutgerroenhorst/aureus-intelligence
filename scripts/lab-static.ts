/**
 * Fill in the static facts (launchpad, DexScreener paid profile / boosts / ads / community takeover, developer count) for every coin
 * the lab has a lesson for, then rebuild with scripts/lab-build.ts. One order lookup per second (DexScreener allows 60 a minute).
 *
 *   corepack pnpm exec tsx scripts/lab-static.ts
 */
import pg from "pg";
import { collectStatic } from "../apps/web/lib/lab/statics";
import { collectRegime } from "../apps/web/lib/lab/regime";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const pool = new pg.Pool({ connectionString: url, max: 2 });

async function main() {
  console.log("regime:", JSON.stringify(await collectRegime(pool, { force: true })));
  let total = { coins: 0, saved: 0, failed: 0 };
  const t0 = Date.now();
  for (;;) {
    const r = await collectStatic(pool, { maxOrders: 100 });
    if (!r.coins) break;
    total = { coins: total.coins + r.coins, saved: total.saved + r.saved, failed: total.failed + r.failed };
    console.log(`  ${total.saved} saved, ${total.failed} failed (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
    if (r.saved === 0) break; // nothing could be saved: stop instead of hammering
  }
  console.log("done", total);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
