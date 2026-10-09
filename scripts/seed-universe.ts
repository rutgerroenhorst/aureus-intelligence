/**
 * One-off: give a nearly empty database the coins another Aureus database is tracking right now.
 *
 *   SOURCE_DATABASE_URL=postgres://aureus:aureus@localhost:5432/aureus \
 *   DATABASE_URL=<target database> corepack pnpm exec tsx scripts/seed-universe.ts [limit]
 *
 * Only the MINTS are taken from the source. Every coin is read again from DexScreener and run through the normal
 * pipeline (processPair), so what lands in the target is current data written by the real code, not a copy of old
 * rows. The same admission window as discovery applies (liquidity, age, market cap), so nothing enters that the
 * scanner would not have admitted itself.
 */
import pg from "pg";
import { getPool, closePool } from "@aureus/db";
import { loadConfig } from "@aureus/config";
import { DexScreenerAdapter } from "@aureus/ingestion";
import { processPair, primaryPair } from "../apps/worker/src/pipeline.js";

const MIN_LIQUIDITY_USD = Number(process.env.DISCOVERY_MIN_LIQUIDITY_USD ?? 6_000);
const MIN_AGE_MIN = Number(process.env.DISCOVERY_MIN_AGE_MINUTES ?? 60);
const MAX_AGE_H = Number(process.env.DISCOVERY_MAX_AGE_HOURS ?? 48);
const MAX_MCAP_USD = Number(process.env.DISCOVERY_MAX_MCAP_USD ?? 150_000);

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) throw new Error("set SOURCE_DATABASE_URL (the database to take the list of coins from)");
  const limit = Number(process.argv[2] ?? 200);

  const src = new pg.Pool({ connectionString: sourceUrl, max: 1 });
  const { rows } = await src.query<{ mint: string }>(
    `SELECT t.mint FROM candidates c JOIN tokens t ON t.id = c.token_id
      WHERE c.current_state <> 'EXPIRED' AND c.discovered_at > now() - interval '48 hours'
      GROUP BY t.mint ORDER BY max(c.discovered_at) DESC LIMIT $1`,
    [limit],
  );
  await src.end();

  const pool = getPool();
  const have = new Set(
    (await pool.query<{ mint: string }>(`SELECT t.mint FROM tokens t JOIN candidates c ON c.token_id = t.id`)).rows.map((r) => r.mint),
  );
  const todo = rows.map((r) => r.mint).filter((m) => !have.has(m));
  console.log(`source lists ${rows.length} coins, ${rows.length - todo.length} already in the target, ${todo.length} to add`);

  const dex = new DexScreenerAdapter(loadConfig().env.DEXSCREENER_BASE_URL);
  const stats = { added: 0, outsideWindow: 0, noPair: 0, failed: 0 };
  const now = Date.now();
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (mint) => {
        try {
          const tokens = await dex.tokens([mint]);
          const pair = primaryPair(tokens.payload);
          if (!pair) { stats.noPair++; return; }
          const liq = pair.liquidity?.usd ?? 0;
          const ageMin = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60_000 : null;
          const mcap = pair.marketCap ?? pair.fdv ?? null;
          if (liq < MIN_LIQUIDITY_USD || ageMin == null || ageMin < MIN_AGE_MIN || ageMin > MAX_AGE_H * 60 || (mcap != null && mcap > MAX_MCAP_USD)) {
            stats.outsideWindow++;
            return;
          }
          await processPair(pool, pair, Date.now());
          stats.added++;
        } catch (err) {
          stats.failed++;
          console.error(`  ${mint.slice(0, 8)}: ${(err as Error).message}`);
        }
      }),
    );
    if ((i / 4) % 10 === 9) console.log(`  ... ${Math.min(i + 4, todo.length)}/${todo.length}`, stats);
  }
  console.log("done", stats);
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
