-- Persisted two-decision action status (with stability metadata) + multi-phase snapshots.
CREATE TABLE IF NOT EXISTS candidate_action_status (
  candidate_id     UUID PRIMARY KEY REFERENCES candidates(id),
  status           TEXT NOT NULL,               -- DISCOVERED..ENTRY_READY/TOO_EXTENDED/INVALIDATED/REJECTED/EXPIRED
  entry_proximity  TEXT NOT NULL,
  fund_verdict     TEXT NOT NULL,               -- WATCHABLE|OBSERVATION|REJECT
  quality_rank     INT,                         -- 0..100 (NOT win probability)
  entry_rank       INT,                         -- 0..100
  watch_priority   TEXT,                        -- PRIMARY|SECONDARY|OBSERVATION
  since            TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirming_scans INT NOT NULL DEFAULT 0,
  prev_status      TEXT,
  trend            TEXT NOT NULL DEFAULT 'NEW',  -- NEW|RISING|STABLE|FALLING
  pending_status   TEXT,                         -- promotion target awaiting confirmation
  pending_scans    INT NOT NULL DEFAULT 0,
  reasons          JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan             JSONB,                        -- provisional or confirmed entry plan
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cand_action_status_idx ON candidate_action_status (status, quality_rank DESC);

-- One snapshot the first time a candidate enters each tracked phase; returns tracked per horizon.
CREATE TABLE IF NOT EXISTS watch_phase_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  phase         TEXT NOT NULL,                  -- FUNDAMENTAL_WATCH|SETUP_FORMING|ENTRY_APPROACHING|ENTRY_READY
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  anchor_price  NUMERIC(38,18) NOT NULL,
  liquidity_usd NUMERIC(38,4),
  volume_usd    NUMERIC(38,4),
  core_safety   TEXT,
  structure     TEXT,
  unknown_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  measurements  JSONB NOT NULL DEFAULT '{}'::jsonb,
  mfe_pct       NUMERIC(12,4),
  mae_pct       NUMERIC(12,4),
  window_complete BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (candidate_id, phase, at)
);
CREATE INDEX IF NOT EXISTS watch_phase_open_idx ON watch_phase_snapshots (window_complete, at);
