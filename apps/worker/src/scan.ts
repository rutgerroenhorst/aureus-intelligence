import type { Pool } from "pg";
import type { CandidateState } from "@aureus/contracts";
import { nextIntervalMs } from "./wconfig.js";

export interface DueCandidate {
  id: string;
  mint: string;
}

/**
 * Candidates that are young AND due, newest first — a lane that priority_score cannot
 * starve.
 *
 * Measured cause: TIER1_LOW held 283 candidates of which 281 were overdue, the worst by
 * 25 days, while TIER3_WATCH stayed current. A newly discovered coin enters at TIER1,
 * so every new coin queued behind that backlog and waited a median of 74 minutes for
 * its first price. For a system whose whole premise is being early, the newest coin
 * was the one it looked at last.
 *
 * Ordering by discovered_at DESC rather than priority_score is deliberate: a coin we
 * have barely observed has no meaningful priority score yet, so ranking new coins by
 * it ranks them by noise.
 */
export async function freshCandidates(pool: Pool, limit: number, maxAgeHours: number): Promise<DueCandidate[]> {
  const { rows } = await pool.query<DueCandidate>(
    `SELECT c.id, t.mint FROM candidates c JOIN tokens t ON t.id = c.token_id
      WHERE c.discovery_source = 'dexscreener'
        AND c.monitoring_tier <> 'TIER0_DORMANT'
        AND c.discovered_at > now() - ($2 || ' hours')::interval
        AND (c.next_scan_at IS NULL OR c.next_scan_at <= now())
      ORDER BY c.discovered_at DESC
      LIMIT $1`,
    [limit, maxAgeHours],
  );
  return rows;
}

/** Candidates due for a rescan, prioritized by state (active first). */
export async function dueCandidates(pool: Pool, limit: number): Promise<DueCandidate[]> {
  const { rows } = await pool.query<DueCandidate>(
    `SELECT c.id, t.mint FROM candidates c JOIN tokens t ON t.id = c.token_id
      WHERE c.discovery_source = 'dexscreener'
        AND c.monitoring_tier <> 'TIER0_DORMANT'
        AND (c.next_scan_at IS NULL OR c.next_scan_at <= now())
      ORDER BY c.priority_score DESC, c.next_scan_at NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function scheduleNext(pool: Pool, candidateId: string, state: CandidateState): Promise<void> {
  const ms = nextIntervalMs(state);
  await pool.query(`UPDATE candidates SET next_scan_at = now() + ($2 || ' milliseconds')::interval WHERE id=$1`, [candidateId, ms]);
}

export async function recordScanError(pool: Pool, candidateId: string): Promise<void> {
  await pool.query(
    `UPDATE candidates SET consecutive_errors = consecutive_errors + 1, scan_attempts = scan_attempts + 1,
       last_scan_at = now(), next_scan_at = now() + interval '60 seconds' WHERE id=$1`,
    [candidateId],
  );
}

/** Bounded-concurrency map — no uncontrolled Promise fan-out. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}
