-- Migration 0020: Enforce immutability on intelligence_v2_scores
-- 
-- CRITICAL: The intelligence_v2_scores table must be immutable to preserve
-- historical snapshots and audit trail. Without these triggers, UPDATE or
-- DELETE operations could corrupt evaluation history.
--
-- This migration adds:
-- 1. Function to block UPDATE operations
-- 2. Trigger to prevent UPDATE on intelligence_v2_scores
-- 3. Trigger to prevent DELETE on intelligence_v2_scores

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Immutability enforcement
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION block_intelligence_v2_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intelligence_v2_scores is immutable: UPDATE not allowed. '
    'Create a new snapshot with a new score_version instead.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_intelligence_v2_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intelligence_v2_scores is immutable: DELETE not allowed. '
    'Historical snapshots must be preserved for audit trail and outcome measurement.';
END;
$$ LANGUAGE plpgsql;

-- Create triggers if they don't exist
-- These will error on any UPDATE or DELETE attempt, enforcing immutability.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'intelligence_v2_scores'::regclass
    AND tgname = 'prevent_intelligence_v2_update'
  ) THEN
    CREATE TRIGGER prevent_intelligence_v2_update
      BEFORE UPDATE ON intelligence_v2_scores
      FOR EACH ROW
      EXECUTE FUNCTION block_intelligence_v2_update();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'intelligence_v2_scores'::regclass
    AND tgname = 'prevent_intelligence_v2_delete'
  ) THEN
    CREATE TRIGGER prevent_intelligence_v2_delete
      BEFORE DELETE ON intelligence_v2_scores
      FOR EACH ROW
      EXECUTE FUNCTION block_intelligence_v2_delete();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Index optimization for latest-snapshot queries
-- ─────────────────────────────────────────────────────────────────────────

-- Ensure the primary query path for latest evaluation per candidate is indexed
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_latest_snapshot
  ON intelligence_v2_scores(candidate_id, computed_at DESC)
  WHERE v2_status IS NOT NULL;

COMMIT;
