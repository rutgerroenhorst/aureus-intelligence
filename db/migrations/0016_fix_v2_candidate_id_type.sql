-- Fix V2 candidate_id type mismatch and optimize indexes
-- This is a local-only fix since v2 is still Phase 1/shadow
-- Handles both existing databases with TEXT column and fresh installs with UUID

BEGIN;

-- Check if candidate_id is already UUID (fresh installs)
-- If it's TEXT, convert it; if already UUID, skip conversion

-- Only do type migration if column exists and is TEXT
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'intelligence_v2_scores' 
    AND column_name = 'candidate_id' 
    AND data_type = 'character varying'
  ) THEN
    -- Add UUID version if not exists
    ALTER TABLE intelligence_v2_scores 
      ADD COLUMN IF NOT EXISTS candidate_id_uuid UUID;

    -- Migrate data with safe casting
    UPDATE intelligence_v2_scores
      SET candidate_id_uuid = candidate_id::uuid
      WHERE candidate_id_uuid IS NULL;

    -- Drop old FK constraint if it exists
    ALTER TABLE intelligence_v2_scores
      DROP CONSTRAINT IF EXISTS intelligence_v2_scores_candidate_id_fkey;

    -- Drop old TEXT column
    ALTER TABLE intelligence_v2_scores
      DROP COLUMN IF EXISTS candidate_id;

    -- Rename new column
    ALTER TABLE intelligence_v2_scores
      RENAME COLUMN candidate_id_uuid TO candidate_id;

    -- Make it NOT NULL
    ALTER TABLE intelligence_v2_scores
      ALTER COLUMN candidate_id SET NOT NULL;

    -- Add back FK constraint
    ALTER TABLE intelligence_v2_scores
      ADD CONSTRAINT intelligence_v2_scores_candidate_id_fkey
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Drop old ineffective indexes (may or may not exist depending on installation path)
DROP INDEX IF EXISTS ix_intelligence_v2_candidate_time;
DROP INDEX IF EXISTS ix_intelligence_v2_status_time;
DROP INDEX IF EXISTS ix_intelligence_v2_version_time;
DROP INDEX IF EXISTS ix_intelligence_v2_created;
DROP INDEX IF EXISTS ix_intelligence_v2_latest_per_candidate;

-- Create optimized indexes (same indexes, but with improved definitions)
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_candidate_time
  ON intelligence_v2_scores(candidate_id, computed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_intelligence_v2_status
  ON intelligence_v2_scores(v2_status, computed_at DESC);

CREATE INDEX IF NOT EXISTS ix_intelligence_v2_latest_per_candidate
  ON intelligence_v2_scores(candidate_id, computed_at DESC, id DESC)
  WHERE v2_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_intelligence_v2_created
  ON intelligence_v2_scores(created_at DESC);

COMMIT;
