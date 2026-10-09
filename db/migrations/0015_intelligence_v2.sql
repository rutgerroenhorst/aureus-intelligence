-- Intelligence V2 — Phase 1 Conservative Verification
--
-- Stores V2 gate evaluation results in parallel with legacy scoring.
-- Shadow mode: legacy + V2 both run, V2 doesn't affect existing flows.
--
-- IMPORTANT: Each evaluation is a point-in-time snapshot.
-- We preserve history to understand what Aureus knew at evaluation time.
-- No overwrites — each row is a distinct evaluation event.

CREATE TABLE IF NOT EXISTS intelligence_v2_scores (
  id BIGSERIAL PRIMARY KEY,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  
  -- Versioning and config
  score_version TEXT NOT NULL,  -- e.g. "v2.0-conservative-allowlist"
  config_hash TEXT NOT NULL,     -- SHA256 first 16 chars, for audit trail
  
  -- Result status: STRUCTURALLY_QUALIFIED | INSUFFICIENT_DATA | FATAL_REJECT | FILTERED
  v2_status TEXT NOT NULL,
  
  -- Confidence 0-100% (reflects data completeness, not future opportunity)
  v2_confidence INTEGER NOT NULL,
  
  -- Null in Phase 1 (no soft scoring)
  v2_score NUMERIC(5,2),
  
  -- JSON: failed/caution/passed gates, missing fields, suppression reasons, evidence
  result_json JSONB NOT NULL,
  
  -- When computed (point-in-time snapshot)
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Audit trail
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_candidate_time
  ON intelligence_v2_scores(candidate_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_status_time
  ON intelligence_v2_scores(v2_status, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_version_time
  ON intelligence_v2_scores(score_version, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_created
  ON intelligence_v2_scores(created_at DESC);

-- Query latest evaluation per candidate
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_latest_per_candidate
  ON intelligence_v2_scores(candidate_id, computed_at DESC)
  WHERE v2_status IS NOT NULL;

-- NO UNIQUE CONSTRAINT: we want historical snapshots, not overwrites.
-- Multiple rows per candidate are expected and desired.
