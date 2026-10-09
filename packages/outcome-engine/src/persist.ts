import type { Pool } from "pg";
import type { SnapshotKind } from "@aureus/contracts";
import { OUTCOME_ENGINE_VERSION, type OutcomeMeasurement } from "./measure.js";

/**
 * Persist a measurement (immutable). UNIQUE(candidate, anchor, horizon) plus the
 * immutability trigger mean each horizon is written once. In production this runs
 * under the `outcome` DB role, which has no write access to engine/feature/state
 * tables — the structural anti-look-ahead guarantee.
 */
export async function persistMeasurement(
  pool: Pool,
  candidateId: string,
  anchor: string,
  anchorAtMs: number,
  horizon: SnapshotKind,
  measuredAtMs: number,
  m: OutcomeMeasurement,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO outcome_measurements
      (candidate_id, anchor, anchor_at, horizon, measured_at, ret, mfe, mae,
       time_to_peak_s, time_to_failure_s, liquidity_loss_pct, holder_growth,
       rug_label, reached_state, sim_entry_return, false_positive, false_negative,
       window_complete, engine_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      candidateId, anchor, new Date(anchorAtMs).toISOString(), horizon, new Date(measuredAtMs).toISOString(),
      m.ret, m.mfe, m.mae, m.timeToPeakS, m.timeToFailureS, m.liquidityLossPct, m.holderGrowth,
      m.rugLabel, m.reachedState, m.simEntryReturn, m.falsePositive, m.falseNegative,
      m.windowComplete, OUTCOME_ENGINE_VERSION,
    ],
  );
  return res.rows[0]!.id;
}
