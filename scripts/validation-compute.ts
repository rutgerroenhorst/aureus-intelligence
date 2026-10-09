/**
 * pnpm validation:compute — backfill paper tracking + research summary for every
 * candidate from the price/liquidity/volume series already collected. Idempotent.
 * Pure analysis over existing data; collects no new signals.
 */
import { getPool, closePool } from "@aureus/db";
import { computeAndPersistResearch } from "../apps/worker/src/research.js";

const pool = getPool();
const nowMs = Date.now();
try {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM candidates WHERE discovery_source NOT IN ('mock','manual') ORDER BY discovered_at`,
  );
  console.log(`Computing research for ${rows.length} candidates…`);
  let ok = 0;
  for (const r of rows) {
    try { await computeAndPersistResearch(pool, r.id, nowMs); ok++; }
    catch (e) { console.error(`  ${r.id.slice(0, 8)}: ${(e as Error).message}`); }
    if (ok % 25 === 0) process.stdout.write(`  …${ok}\n`);
  }
  const cnt = await pool.query(`SELECT count(*) n, count(*) FILTER (WHERE is_rug) rugs, count(*) FILTER (WHERE window_24h_complete) w24 FROM candidate_research`);
  console.log(`Done. candidate_research=${cnt.rows[0].n}  rugs=${cnt.rows[0].rugs}  24h-complete=${cnt.rows[0].w24}`);
} catch (err) {
  console.error("COMPUTE ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
