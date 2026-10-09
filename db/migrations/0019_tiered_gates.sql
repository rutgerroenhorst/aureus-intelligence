-- Tiered Qualification System
--
-- Adds support for QUICK → EARLY → STRUCTURALLY_QUALIFIED progression.
-- Coins now qualify immediately at TIER 0 (5-10s) with basic safety gates,
-- then progress through enrichment (TIER 1) and full verification (TIER 2).

ALTER TABLE intelligence_v2_scores
ADD COLUMN IF NOT EXISTS v2_tier TEXT,  -- QUICK_QUALIFIED | EARLY_QUALIFIED | STRUCTURALLY_QUALIFIED
ADD COLUMN IF NOT EXISTS qualification_time TEXT;  -- 5-10s | 2-5m | background

-- Index for tier-based queries (radar filtering)
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_tier
  ON intelligence_v2_scores(v2_tier, computed_at DESC)
  WHERE v2_tier IS NOT NULL;

-- Index for qualification speed analysis
CREATE INDEX IF NOT EXISTS ix_intelligence_v2_tier_status
  ON intelligence_v2_scores(v2_tier, v2_status, computed_at DESC);
