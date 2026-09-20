/**
 * Persisted two-decision action status with STABILITY, plus multi-phase snapshots.
 *
 * A promotion up the ladder requires N confirming scans; a critical failure degrades
 * immediately. This prevents per-poll flip-flop and makes "time in status" real.
 */
import type { Pool } from "pg";
import type { ActionStatusV2 } from "@aureus/watch-engine";

const CONFIRM_SCANS = 2; // consecutive confirming scans required to promote
const LADDER: Record<string, number> = {
  DISCOVERED: 0, FUNDAMENTAL_WATCH: 1, SETUP_FORMING: 2, ENTRY_APPROACHING: 3, ENTRY_READY: 4,
  TOO_EXTENDED: -1, INVALIDATED: -2, REJECTED: -3, EXPIRED: -4,
};
const TRACKED_PHASES = new Set(["FUNDAMENTAL_WATCH", "SETUP_FORMING", "ENTRY_APPROACHING", "ENTRY_READY"]);
const HORIZONS: Array<[string, number]> = [["m5", 5], ["m15", 15], ["m30", 30], ["h1", 60], ["h4", 240], ["h24", 1440]];

export interface ComputedStatus {
  status: ActionStatusV2;
  entryProximity: string;
  fundVerdict: string;
  qualityRank: number;
  entryRank: number;
  reasons: Record<string, unknown>;
  plan: Record<string, unknown> | null;
  // market anchors for a phase snapshot
  price: number;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  coreSafety: string;
  structure: string;
  unknownRisks: string[];
  criticalFail: boolean; // REJECTED/INVALIDATED cause → immediate degrade
}

export async function updateActionStatus(pool: Pool, candidateId: string, c: ComputedStatus, nowMs: number): Promise<{ status: ActionStatusV2; changed: boolean; trend: string }> {
  const prev = await pool.query<{ status: string; since: string; confirming_scans: number; pending_status: string | null; pending_scans: number }>(
    `SELECT status, extract(epoch from since)*1000 since, confirming_scans, pending_status, pending_scans FROM candidate_action_status WHERE candidate_id=$1`,
    [candidateId],
  );
  const p = prev.rows[0];
  const target = c.status;
  let final: ActionStatusV2 = target;
  let pendingStatus: string | null = null;
  let pendingScans = 0;
  let confirming = 1;
  let trend = "NEW";

  if (p) {
    const curRank = LADDER[p.status] ?? 0;
    const tgtRank = LADDER[target] ?? 0;
    const degrade = c.criticalFail || tgtRank < 0 || tgtRank < curRank;
    if (target === p.status) {
      final = p.status as ActionStatusV2; confirming = p.confirming_scans + 1; trend = confirming >= 3 ? "STABLE" : "RISING";
    } else if (degrade) {
      final = target; trend = "FALLING"; // immediate degrade
    } else {
      // promotion — needs confirming scans
      if (p.pending_status === target) pendingScans = p.pending_scans + 1; else pendingScans = 1;
      if (pendingScans >= CONFIRM_SCANS) { final = target; trend = "RISING"; }
      else { final = p.status as ActionStatusV2; pendingStatus = target; confirming = p.confirming_scans; trend = "RISING"; }
    }
  }

  const changed = !p || final !== p.status;
  await pool.query(
    `INSERT INTO candidate_action_status (candidate_id, status, entry_proximity, fund_verdict, quality_rank, entry_rank, since, confirming_scans, prev_status, trend, pending_status, pending_scans, reasons, plan, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $13 THEN to_timestamp($7) ELSE COALESCE((SELECT since FROM candidate_action_status WHERE candidate_id=$1), to_timestamp($7)) END, $8,$9,$10,$11,$12,$14,$15, now())
     ON CONFLICT (candidate_id) DO UPDATE SET status=EXCLUDED.status, entry_proximity=EXCLUDED.entry_proximity, fund_verdict=EXCLUDED.fund_verdict,
       quality_rank=EXCLUDED.quality_rank, entry_rank=EXCLUDED.entry_rank,
       since=CASE WHEN $13 THEN to_timestamp($7) ELSE candidate_action_status.since END,
       confirming_scans=EXCLUDED.confirming_scans, prev_status=$9, trend=EXCLUDED.trend,
       pending_status=EXCLUDED.pending_status, pending_scans=EXCLUDED.pending_scans, reasons=EXCLUDED.reasons, plan=EXCLUDED.plan, updated_at=now()`,
    [candidateId, final, c.entryProximity, c.fundVerdict, c.qualityRank, c.entryRank, nowMs / 1000, confirming, p?.status ?? null, trend, pendingStatus, pendingScans, changed, JSON.stringify(c.reasons), c.plan ? JSON.stringify(c.plan) : null],
  );

  // First entry into a tracked phase → snapshot (dedup: none open for this phase).
  if (changed && TRACKED_PHASES.has(final) && c.price > 0) {
    await pool.query(
      `INSERT INTO watch_phase_snapshots (candidate_id, phase, at, anchor_price, liquidity_usd, volume_usd, core_safety, structure, unknown_risks)
       SELECT $1,$2,now(),$3,$4,$5,$6,$7,$8
       WHERE NOT EXISTS (SELECT 1 FROM watch_phase_snapshots w WHERE w.candidate_id=$1 AND w.phase=$2 AND w.window_complete=false)`,
      [candidateId, final, c.price, c.liquidityUsd, c.volumeUsd, c.coreSafety, c.structure, JSON.stringify(c.unknownRisks)],
    );
  }
  return { status: final, changed, trend };
}

/** Measure open phase snapshots: return/MFE/MAE per horizon from the anchor price. */
export async function measurePhaseSnapshots(pool: Pool, nowMs: number): Promise<{ measured: number; closed: number }> {
  const snaps = await pool.query<{ id: string; candidate_id: string; at_ms: string; anchor_price: string }>(
    // NOTE: `at` is a reserved keyword in Postgres (AT TIME ZONE) — alias must differ.
    `SELECT id, candidate_id, extract(epoch from at)*1000 AS at_ms, anchor_price FROM watch_phase_snapshots WHERE window_complete=false`,
  );
  let measured = 0, closed = 0;
  for (const s of snaps.rows) {
    const anchorMs = Number(s.at_ms); const anchor = Number(s.anchor_price);
    if (!(anchor > 0)) continue;
    const poolRow = await pool.query<{ pool_id: string }>(`SELECT pool_id FROM candidates WHERE id=$1`, [s.candidate_id]);
    const poolId = poolRow.rows[0]?.pool_id; if (!poolId) continue;
    const px = await pool.query<{ t: string; p: string }>(
      `SELECT extract(epoch from observed_at)*1000 t, price_usd p FROM prices WHERE pool_id=$1 AND observed_at >= to_timestamp($2) ORDER BY observed_at`,
      [poolId, anchorMs / 1000],
    );
    const series = px.rows.map((r) => ({ atMs: Number(r.t), price: Number(r.p) }));
    if (series.length === 0) continue;
    const rets = series.map((x) => (x.price - anchor) / anchor);
    const mfe = Math.max(0, ...rets), mae = Math.min(0, ...rets);
    const m: Record<string, unknown> = {};
    for (const [k, mins] of HORIZONS) {
      const cutoff = anchorMs + mins * 60_000;
      const pt = [...series].reverse().find((x) => x.atMs <= cutoff);
      m[k] = { returnPct: pt ? (pt.price - anchor) / anchor : null, complete: nowMs >= cutoff };
    }
    const complete = nowMs - anchorMs >= 24 * 60 * 60_000;
    await pool.query(`UPDATE watch_phase_snapshots SET measurements=$2, mfe_pct=$3, mae_pct=$4, window_complete=$5 WHERE id=$1`, [s.id, JSON.stringify(m), mfe, mae, complete]);
    measured++; if (complete) closed++;
  }
  return { measured, closed };
}
