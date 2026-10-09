import type { Pool } from "pg";
import type { CandidateSnapshot } from "@aureus/contracts";

/**
 * Persist an immutable snapshot: one candidate_snapshots row plus its
 * snapshot_features and snapshot_rules. UNIQUE(candidate_id, kind) + the
 * immutability trigger mean a snapshot for a given kind is written exactly once.
 */
export async function persistSnapshot(pool: Pool, snap: CandidateSnapshot): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: string }>(
      `INSERT INTO candidate_snapshots
        (candidate_id, kind, scheduled_for, taken_at, decision_state, data_quality_status,
         engine_versions, market, liquidity, holders, wallet_flows)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        snap.candidateId, snap.kind, snap.scheduledFor, snap.takenAt, snap.decisionState,
        snap.dataQualityStatus, JSON.stringify(snap.engineVersions),
        snap.market ? JSON.stringify(snap.market) : null,
        snap.liquidity ? JSON.stringify(snap.liquidity) : null,
        snap.holders ? JSON.stringify(snap.holders) : null,
        snap.walletFlows ? JSON.stringify(snap.walletFlows) : null,
      ],
    );
    const snapshotId = res.rows[0]!.id;

    for (const f of snap.features) {
      await client.query(
        `INSERT INTO snapshot_features (snapshot_id, feature_id, version, status, value, unit, data_quality)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshotId, f.featureId, f.version, f.status, f.value, f.unit, f.dataQuality],
      );
    }
    for (const r of snap.rules) {
      await client.query(
        `INSERT INTO snapshot_rules (snapshot_id, rule_id, rule_version, family, result, severity)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [snapshotId, r.ruleId, r.ruleVersion, r.family, r.result, r.severity],
      );
    }
    await client.query("COMMIT");
    return snapshotId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
