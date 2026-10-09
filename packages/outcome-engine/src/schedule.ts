import type { Pool } from "pg";
import type { SnapshotKind } from "@aureus/contracts";
import { SNAPSHOT_KINDS, SNAPSHOT_OFFSETS_MS } from "@aureus/contracts";

export interface OutcomeSchedule {
  horizon: SnapshotKind;
  dueAtMs: number;
}

/** All outcome horizons for an anchor (discovery or an alert instant). */
export function buildOutcomeSchedules(anchorAtMs: number): OutcomeSchedule[] {
  return SNAPSHOT_KINDS.filter((k) => k !== "discovery").map((horizon) => ({
    horizon,
    dueAtMs: anchorAtMs + SNAPSHOT_OFFSETS_MS[horizon],
  }));
}

/** Persist (idempotently) the outcome schedule rows for a candidate+anchor. */
export async function persistSchedules(
  pool: Pool,
  candidateId: string,
  anchor: string,
  anchorAtMs: number,
): Promise<number> {
  const schedules = buildOutcomeSchedules(anchorAtMs);
  let inserted = 0;
  for (const s of schedules) {
    const res = await pool.query(
      `INSERT INTO outcome_schedules (candidate_id, anchor, anchor_at, horizon, due_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (candidate_id, anchor, horizon) DO NOTHING`,
      [candidateId, anchor, new Date(anchorAtMs).toISOString(), s.horizon, new Date(s.dueAtMs).toISOString()],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export interface DueSchedule {
  id: string;
  candidateId: string;
  anchor: string;
  anchorAt: string;
  horizon: SnapshotKind;
}

/** Schedules whose due_at has passed and are still PENDING. */
export async function dueSchedules(pool: Pool, nowMs: number): Promise<DueSchedule[]> {
  const { rows } = await pool.query(
    `SELECT id, candidate_id AS "candidateId", anchor, anchor_at AS "anchorAt", horizon
       FROM outcome_schedules
      WHERE status = 'PENDING' AND due_at <= $1
      ORDER BY due_at`,
    [new Date(nowMs).toISOString()],
  );
  return rows as DueSchedule[];
}

export async function markScheduleDone(pool: Pool, id: string): Promise<void> {
  await pool.query(`UPDATE outcome_schedules SET status='DONE', updated_at=now() WHERE id=$1`, [id]);
}
