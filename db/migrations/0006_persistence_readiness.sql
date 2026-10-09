-- 0006_persistence_readiness.sql
-- Supports change-based persistence (write-amplification fix) and the readiness
-- model. Adds evidence hashes for cheap change detection, a denormalized readiness
-- summary + last_meaningful_change on candidates, and the rule-per-candidate index.
-- All historical data and immutable snapshots are preserved.

BEGIN;

-- Change-detection hashes (nullable; back-filled going forward).
ALTER TABLE feature_values   ADD COLUMN IF NOT EXISTS evidence_hash TEXT;
ALTER TABLE rule_evaluations ADD COLUMN IF NOT EXISTS evidence_hash TEXT;

-- Denormalized readiness summary for fast, differentiated Today/Discover lists.
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS readiness JSONB,
  ADD COLUMN IF NOT EXISTS last_meaningful_change_at TIMESTAMPTZ;

-- Index required for "latest evaluation per rule" lookups (change detection + UI).
CREATE INDEX IF NOT EXISTS rule_evaluations_rule_idx
  ON rule_evaluations (candidate_id, rule_id, evaluated_at DESC);

-- feature_values already has feature_values_cand_idx (candidate_id, feature_id, calculated_at DESC).
-- prices / liquidity_snapshots / transaction_aggregates already have (pool_id, observed_at DESC).

COMMIT;
