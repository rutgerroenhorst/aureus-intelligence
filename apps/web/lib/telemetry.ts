"use server";

import { getPool } from "@aureus/db";
import { formatLatency } from "./telemetry-utils";

export interface FeedTelemetry {
  status: "LIVE" | "DEGRADED" | "OFFLINE";
  lastCandidateAt: string | null;
  lastWorkerCycleAt: string | null;
  lastV2EvaluationAt: string | null;
  candidateCount: number;
  v2QualifiedCount: number;
  latencyMs: number;
  refreshIntervalMs: number;
}

export async function getFeedTelemetry(): Promise<FeedTelemetry> {
  const pool = getPool();
  
  try {
    const candResult = await pool.query(
      `SELECT MAX(discovered_at) as max_time, COUNT(*) as count FROM candidates WHERE discovery_source NOT IN ('mock','manual') AND current_state <> 'EXPIRED'`
    );
    const lastCandidateAt = candResult.rows[0]?.max_time;
    const totalCandidates = candResult.rows[0]?.count || 0;
    
    const v2Result = await pool.query(`
      SELECT COUNT(DISTINCT candidate_id) as count, MAX(computed_at) as max_time
      FROM (
        SELECT DISTINCT ON (candidate_id) candidate_id, v2_status, computed_at
        FROM intelligence_v2_scores
        ORDER BY candidate_id, computed_at DESC
      ) t
      WHERE t.v2_status = 'STRUCTURALLY_QUALIFIED'
    `);
    const v2QualifiedCount = v2Result.rows[0]?.count || 0;
    const lastV2EvaluationAt = v2Result.rows[0]?.max_time;
    
    const workerResult = await pool.query(
      `SELECT MAX(last_cycle_at) as max_time FROM worker_heartbeats`
    );
    const lastWorkerCycleAt = workerResult.rows[0]?.max_time;

    const now = new Date();
    const latencyMs = lastCandidateAt
      ? Math.max(0, Math.floor(now.getTime() - new Date(lastCandidateAt).getTime()))
      : 999_999;
    
    const fiveMinutesMs = 5 * 60 * 1000;
    let status: "LIVE" | "DEGRADED" | "OFFLINE";
    if (latencyMs < fiveMinutesMs) {
      status = "LIVE";
    } else if (latencyMs < 24 * 60 * 60 * 1000) {
      status = "DEGRADED";
    } else {
      status = "OFFLINE";
    }
    
    return {
      status,
      lastCandidateAt: lastCandidateAt ? new Date(lastCandidateAt).toISOString() : null,
      lastWorkerCycleAt: lastWorkerCycleAt ? new Date(lastWorkerCycleAt).toISOString() : null,
      lastV2EvaluationAt: lastV2EvaluationAt ? new Date(lastV2EvaluationAt).toISOString() : null,
      candidateCount: totalCandidates,
      v2QualifiedCount,
      latencyMs,
      refreshIntervalMs: 5000,
    };
  } catch (err) {
    console.error("Telemetry error:", err);
    return {
      status: "OFFLINE",
      lastCandidateAt: null,
      lastWorkerCycleAt: null,
      lastV2EvaluationAt: null,
      candidateCount: 0,
      v2QualifiedCount: 0,
      latencyMs: 999_999,
      refreshIntervalMs: 5000,
    };
  }
}
