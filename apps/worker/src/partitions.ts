/**
 * Time-partition maintenance.
 *
 * `prices`, `liquidity_snapshots` and `transaction_aggregates` are RANGE-partitioned
 * by month. 0001_init created 2026m07 and a comment promising a maintenance job that
 * was never written, so on 2026-08-01 every market-data INSERT started failing with
 * "no partition of relation ... found for row". The worker logged a per-candidate
 * error, kept reporting healthy cycles, and the board silently drained to zero.
 *
 * Calling this on boot and hourly means a calendar rollover can never take the
 * system down again.
 */
import type { Pool } from "pg";

export async function ensurePartitions(pool: Pool, monthsAhead = 3): Promise<string[]> {
  const { rows } = await pool.query<{ created: string }>(
    `SELECT created FROM ensure_time_partitions($1)`, [monthsAhead],
  );
  return rows.map((r) => r.created);
}

/**
 * Verify the CURRENT month is writable. A missing partition is not a warning — it
 * means every write this month fails — so the caller should treat false as fatal.
 */
export async function currentMonthWritable(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class
       WHERE relname = format('prices_%sm%s', to_char(CURRENT_DATE,'YYYY'), to_char(CURRENT_DATE,'MM'))
     ) AS ok`,
  );
  return rows[0]?.ok === true;
}

/**
 * Repair any drift between the append-only rule log and its current-state projection.
 *
 * The projection is written next to each log write, but as two statements rather than
 * one transaction. A crash between them — or a worker running code older than migration
 * 0013 — leaves it behind, and that drift PERSISTS: a rule whose result never changes is
 * never rewritten, so the stale row simply stays. A stale rule result is a wrong safety
 * verdict, not a cosmetic bug, which is why this runs on a schedule rather than only at
 * deploy time.
 */
export async function reconcileRuleCurrent(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT reconcile_rule_current() AS n`);
  return Number(rows[0]?.n ?? 0);
}
