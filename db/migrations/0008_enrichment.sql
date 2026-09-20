-- 0008_enrichment.sql — asynchronous on-chain (Helius) enrichment + monitoring tiers.
-- Helius is decoupled from discovery: missing on-chain data never blocks the market
-- pipeline. Enrichment status and per-dataset detail are tracked separately from
-- the deterministic rule outcomes so the UI can distinguish "waiting on data" from
-- a real FAIL. No fabricated data — unresolved datapoints stay UNAVAILABLE/INCOMPLETE.

BEGIN;

CREATE TYPE enrichment_status_t AS ENUM (
  'NOT_REQUESTED', 'QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETE', 'FAILED', 'RETRYING', 'STALE');

CREATE TYPE monitoring_tier_t AS ENUM (
  'TIER0_DORMANT', 'TIER1_LOW', 'TIER2_ENRICHMENT', 'TIER3_WATCH', 'TIER4_TRADE');

-- ── Enrichment + monitoring columns on candidates ──────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS enrichment_status enrichment_status_t NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS enrichment_queued_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_attempts    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_last_error  TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_data_version TEXT,
  -- monitoring tiers
  ADD COLUMN IF NOT EXISTS monitoring_tier monitoring_tier_t NOT NULL DEFAULT 'TIER1_LOW',
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_components JSONB,
  ADD COLUMN IF NOT EXISTS monitoring_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitoring_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_stable_cycles INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS downgrade_reason TEXT,
  ADD COLUMN IF NOT EXISTS stop_monitoring_reason TEXT;

CREATE INDEX IF NOT EXISTS candidates_enrichment_idx ON candidates (enrichment_status);
CREATE INDEX IF NOT EXISTS candidates_tier_idx ON candidates (monitoring_tier, next_scan_at);

-- ── On-chain enrichment result (recomputable, one per candidate) ───────────
CREATE TABLE onchain_enrichment (
  candidate_id   UUID PRIMARY KEY REFERENCES candidates(id),
  intel          JSONB NOT NULL,          -- OnChainIntel (available + derived values)
  datasets       JSONB NOT NULL,          -- per-dataset {status, reason} (supply/holders/...)
  data_version   TEXT NOT NULL,
  response_hash  TEXT,                     -- hash of raw Helius inputs (idempotency)
  source         source_t NOT NULL DEFAULT 'helius',
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Enrichment job dead-letter (queue lives in Redis; failures land here) ──
CREATE TABLE enrichment_failures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  job_type     TEXT NOT NULL,
  attempts     INT NOT NULL,
  error        TEXT NOT NULL,
  failed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
