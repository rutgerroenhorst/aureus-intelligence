-- 0007_validation_lab.sql — Validation Lab research tables.
-- Pure ANALYSIS over data already collected (raw prices/liquidity/tx time-series).
-- No new signals, sources, or rules. Both tables are RECOMPUTABLE (upsert), so they
-- are not immutable — they are derived research artifacts, not the append-only record.

BEGIN;

-- Per (candidate, horizon) paper-tracking point, measured from discovery.
CREATE TABLE paper_tracking (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     UUID NOT NULL REFERENCES candidates(id),
  horizon          TEXT NOT NULL,           -- m15 m30 h1 h2 h4 h8 h24 d3 d7
  anchor_at        TIMESTAMPTZ NOT NULL,    -- discovery moment
  target_at        TIMESTAMPTZ NOT NULL,    -- anchor + horizon
  measured_at      TIMESTAMPTZ NOT NULL,    -- when computed
  anchor_price     NUMERIC(38,18),
  price            NUMERIC(38,18),          -- price at/near target (or last if incomplete)
  return_pct       NUMERIC(14,6),
  max_drawdown_pct NUMERIC(14,6),           -- min(price)/anchor - 1 within window
  max_runup_pct    NUMERIC(14,6),           -- max(price)/anchor - 1 within window
  liquidity_usd    NUMERIC(38,4),
  volume_usd       NUMERIC(38,4),
  window_complete  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (candidate_id, horizon)
);
CREATE INDEX paper_tracking_cand_idx ON paper_tracking (candidate_id);

-- Per-candidate research summary — the join target for compare + attribution.
CREATE TABLE candidate_research (
  candidate_id           UUID PRIMARY KEY REFERENCES candidates(id),
  discovered_at          TIMESTAMPTZ NOT NULL,
  discovery_price        NUMERIC(38,18),
  discovery_liquidity_usd NUMERIC(38,4),
  discovery_fdv_usd      NUMERIC(38,4),
  discovery_volume_usd   NUMERIC(38,4),
  pair_age_at_discovery_s BIGINT,
  observations           INT NOT NULL DEFAULT 0,
  last_observed_at       TIMESTAMPTZ,
  -- outcome metrics (over all collected data)
  final_return_pct       NUMERIC(14,6),      -- last price vs discovery
  return_24h_pct         NUMERIC(14,6),      -- return at ~24h (null if incomplete)
  peak_return_pct        NUMERIC(14,6),      -- max run-up
  max_drawdown_pct       NUMERIC(14,6),
  time_to_peak_s         BIGINT,
  liquidity_growth_pct   NUMERIC(14,6),      -- max liq vs discovery liq
  volume_growth_pct      NUMERIC(14,6),      -- max vol vs discovery vol
  lifespan_s             BIGINT,             -- discovery → last meaningful liquidity
  is_rug                 BOOLEAN NOT NULL DEFAULT FALSE,
  reached_state          candidate_state_t,
  window_24h_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidate_research_ret_idx ON candidate_research (return_24h_pct);
CREATE INDEX candidate_research_peak_idx ON candidate_research (peak_return_pct);
CREATE INDEX candidate_research_rug_idx ON candidate_research (is_rug);

COMMIT;
