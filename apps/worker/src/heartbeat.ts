import type { Pool } from "pg";

export async function writeHeartbeat(
  pool: Pool,
  workerId: string,
  fields: { status: string; cycleCount: number; lastCycleMs?: number; avgCycleMs?: number; candidatesLastCycle?: number; detail?: Record<string, unknown> },
): Promise<void> {
  await pool.query(
    `INSERT INTO worker_heartbeats (worker_id, status, cycle_count, last_cycle_at, last_cycle_ms, avg_cycle_ms, candidates_last_cycle, detail, updated_at)
     VALUES ($1,$2,$3,now(),$4,$5,$6,$7,now())
     ON CONFLICT (worker_id) DO UPDATE SET
       status=EXCLUDED.status, cycle_count=EXCLUDED.cycle_count, last_cycle_at=now(),
       last_cycle_ms=EXCLUDED.last_cycle_ms, avg_cycle_ms=EXCLUDED.avg_cycle_ms,
       candidates_last_cycle=EXCLUDED.candidates_last_cycle, detail=EXCLUDED.detail, updated_at=now()`,
    [workerId, fields.status, fields.cycleCount, fields.lastCycleMs ?? null, fields.avgCycleMs ?? null, fields.candidatesLastCycle ?? null, JSON.stringify(fields.detail ?? {})],
  );
}
