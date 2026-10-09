/**
 * Cohort grading — the report the system has never been able to produce.
 *
 * For every verdict family, what actually happened afterwards? This is the only
 * way to distinguish a filter that is protecting the user from a filter that is
 * simply refusing everything. Both look identical from the inside.
 *
 * Reading the output:
 *   - REJECTED cohorts with high MFE = we walked away from real moves (opportunity cost)
 *   - REJECTED cohorts with deep MAE = the rejection saved money (working as intended)
 *   - UNOBSERVABLE share high = we stopped watching, so the cohort says nothing at all
 *
 * Nothing here feeds a gate. It grades the gates.
 */
import type { Pool } from "pg";

export interface CohortRow {
  cohort: string;
  horizon: string;
  n: number;
  unobservable: number;
  medianRet: number | null;
  medianMfe: number | null;
  medianMae: number | null;
  /** Share whose peak in-window gain cleared +50% — a move we could have caught. */
  shareBigUp: number | null;
  /** Share that lost more than half its value — a move we were right to avoid. */
  shareHalved: number | null;
}

const q = (n: number) => `${n}`;

/** Group by action verdict (REJECTED, FUNDAMENTAL_WATCH, …). */
export async function cohortsByVerdict(pool: Pool, horizon = "h1"): Promise<CohortRow[]> {
  return cohortQuery(pool, "v.verdict", horizon);
}

/** Group by WHY we rejected — the actionable cut. */
export async function cohortsByReason(pool: Pool, horizon = "h1"): Promise<CohortRow[]> {
  return cohortQuery(pool, "v.reason_family", horizon);
}

async function cohortQuery(pool: Pool, groupExpr: string, horizon: string): Promise<CohortRow[]> {
  const res = await pool.query<{
    cohort: string; n: string; unobservable: string;
    med_ret: string | null; med_mfe: string | null; med_mae: string | null;
    big_up: string | null; halved: string | null;
  }>(
    `SELECT ${groupExpr} AS cohort,
            count(*) AS n,
            count(*) FILTER (WHERE o.status = 'UNOBSERVABLE') AS unobservable,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.ret) FILTER (WHERE o.status='MEASURED') AS med_ret,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.mfe) FILTER (WHERE o.status='MEASURED') AS med_mfe,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.mae) FILTER (WHERE o.status='MEASURED') AS med_mae,
            avg(CASE WHEN o.status='MEASURED' AND o.mfe >= 0.5 THEN 1.0 ELSE 0.0 END)
              FILTER (WHERE o.status='MEASURED') AS big_up,
            avg(CASE WHEN o.status='MEASURED' AND o.mae <= -0.5 THEN 1.0 ELSE 0.0 END)
              FILTER (WHERE o.status='MEASURED') AS halved
       FROM candidate_verdicts v
       JOIN verdict_outcomes o ON o.verdict_id = v.id
      WHERE o.horizon = $1
      GROUP BY 1
      HAVING count(*) > 0
      ORDER BY count(*) DESC`,
    [horizon],
  );
  const num = (s: string | null) => (s == null ? null : Number(s));
  return res.rows.map((r) => ({
    cohort: r.cohort ?? "unknown",
    horizon,
    n: Number(r.n),
    unobservable: Number(r.unobservable),
    medianRet: num(r.med_ret),
    medianMfe: num(r.med_mfe),
    medianMae: num(r.med_mae),
    shareBigUp: num(r.big_up),
    shareHalved: num(r.halved),
  }));
}

const pct = (v: number | null) => (v == null ? "     —" : `${(v * 100).toFixed(1).padStart(6)}%`);

/** Render a cohort table for the CLI. Honest about coverage: n counts every row,
 *  and the `unobs` column says how many of them we simply stopped watching. */
export function formatCohorts(rows: CohortRow[], title: string): string {
  if (rows.length === 0) return `${title}\n  (no graded verdicts yet)\n`;
  const head = `${title}\n` +
    `  ${"cohort".padEnd(26)} ${"n".padStart(4)} ${"unobs".padStart(6)} ${"medRet".padStart(7)} ${"medMFE".padStart(7)} ${"medMAE".padStart(7)} ${"≥+50%".padStart(7)} ${"≤-50%".padStart(7)}\n` +
    `  ${"-".repeat(26)} ${"-".repeat(4)} ${"-".repeat(6)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(7)}`;
  const body = rows.map((r) =>
    `  ${r.cohort.padEnd(26)} ${q(r.n).padStart(4)} ${q(r.unobservable).padStart(6)} ` +
    `${pct(r.medianRet)} ${pct(r.medianMfe)} ${pct(r.medianMae)} ${pct(r.shareBigUp)} ${pct(r.shareHalved)}`,
  ).join("\n");
  return `${head}\n${body}\n`;
}
