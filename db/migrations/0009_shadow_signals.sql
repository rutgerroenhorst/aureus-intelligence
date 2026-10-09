-- Shadow paper signals: recorded (never traded) when a candidate crosses the
-- CORE SAFETY PASS + ENTRY PASS gate. Returns/MFE/MAE tracked per horizon.
CREATE TABLE IF NOT EXISTS shadow_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID NOT NULL REFERENCES candidates(id),
  signal_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_price     NUMERIC(38,18) NOT NULL,
  entry_zone_low    NUMERIC(38,18),
  entry_zone_high   NUMERIC(38,18),
  invalidation      NUMERIC(38,18),
  target            NUMERIC(38,18),
  rr                NUMERIC(12,4),
  max_chase_price   NUMERIC(38,18),
  est_slippage_pct  NUMERIC(8,3),
  anchor_liquidity_usd NUMERIC(38,4),
  core_safety       TEXT NOT NULL,
  advanced_status   TEXT NOT NULL,
  unknown_datasets  JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_versions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  measurements      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per-horizon return/mfe/mae/liq
  mfe_pct           NUMERIC(12,4),
  mae_pct           NUMERIC(12,4),
  status            TEXT NOT NULL DEFAULT 'OPEN',          -- OPEN | CLOSED | INVALIDATED
  outcome           TEXT,
  closed_at         TIMESTAMPTZ
);
-- One OPEN shadow signal per candidate at a time.
CREATE UNIQUE INDEX IF NOT EXISTS shadow_signals_open_uq ON shadow_signals (candidate_id) WHERE status='OPEN';
CREATE INDEX IF NOT EXISTS shadow_signals_status_idx ON shadow_signals (status, signal_at);
