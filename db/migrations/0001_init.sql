-- 0001_init.sql — Aureus Intelligence base schema
-- PostgreSQL 15+. Production-oriented, address-first, append-only where it matters.
--
-- Conventions (binding — see docs/ARCHITECTURE.md):
--  * Identity is (chain, mint) and (chain, pool). Names/tickers are labels only.
--  * Every observation-class table carries the provenance columns:
--      source, observed_at, ingested_at, evidence_status,
--      data_quality_confidence, raw_source_ref, raw_event_id.
--  * The discovery snapshot is IMMUTABLE (enforced by trigger).
--  * Corrections are new rows, never UPDATEs of prior observations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE chain_t              AS ENUM ('solana');
CREATE TYPE evidence_status_t    AS ENUM ('VERIFIED','ASSUMED','MISSING','GATED','MANUAL','MOCK','STALE');
CREATE TYPE candidate_state_t    AS ENUM (
  'RESEARCHING','REJECTED','STRUCTURE_WATCH','QUALITY_CONFIRMED',
  'ENTRY_WATCH','ENTRY_READY','OVEREXTENDED','POSITION_RISK','EXPIRED','UNRESOLVED');
CREATE TYPE safety_status_t      AS ENUM ('PASSED','INCOMPLETE','FAILED');
CREATE TYPE quality_level_t      AS ENUM ('WEAK','DEVELOPING','CONFIRMED');
CREATE TYPE entry_status_t       AS ENUM ('TOO_EARLY','WAIT_FOR_LEVEL','READY','OVEREXTENDED','INVALIDATED','EXPIRED');
CREATE TYPE severity_t           AS ENUM ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE source_t             AS ENUM ('dexscreener','geckoterminal','helius','solana_rpc','bubblemaps','fomo','aureus_derived','manual','mock');
CREATE TYPE alert_type_t         AS ENUM (
  'INTELLIGENCE_UPDATE','ENTRY_WATCH','ENTRY_READY','ENTRY_INVALIDATED',
  'OVEREXTENDED','LIQUIDITY_RISK','SMART_WALLET_EXIT','DEPLOYER_ACTIVITY','DATA_STALE');

-- ─────────────────────────────────────────────────────────────────────────
-- Raw append-only event store (replayable source of truth)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE raw_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          source_t      NOT NULL,
  endpoint        TEXT          NOT NULL,
  natural_key     TEXT          NOT NULL,           -- e.g. mint/pool/tx this event is about
  idempotency_key TEXT          NOT NULL,           -- hash(source,endpoint,natural_key,observed_at)
  observed_at     TIMESTAMPTZ,                      -- source clock (nullable if source gives none)
  ingested_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  http_status     INT,
  payload         JSONB         NOT NULL,
  UNIQUE (idempotency_key)
);
CREATE INDEX raw_events_natural_idx ON raw_events (source, natural_key, ingested_at DESC);

-- Dead-letter queue for permanently failed ingestions
CREATE TABLE dead_letter_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        source_t    NOT NULL,
  endpoint      TEXT        NOT NULL,
  natural_key   TEXT,
  request_ctx   JSONB       NOT NULL,
  error         TEXT        NOT NULL,
  attempts      INT         NOT NULL DEFAULT 0,
  failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────
-- Identities: tokens, pools
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain         chain_t     NOT NULL DEFAULT 'solana',
  mint          TEXT        NOT NULL,
  -- labels only; never used as identity
  symbol_label  TEXT,
  name_label    TEXT,
  decimals      INT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, mint)
);

CREATE TABLE pools (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain          chain_t    NOT NULL DEFAULT 'solana',
  pool_address   TEXT       NOT NULL,
  token_id       UUID       NOT NULL REFERENCES tokens(id),
  quote_mint     TEXT,                              -- e.g. SOL/USDC mint
  dex            TEXT,                              -- raydium/orca/... (label)
  created_at_src TIMESTAMPTZ,                       -- pool creation per source
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, pool_address)
);
CREATE INDEX pools_token_idx ON pools (token_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Candidate identity + immutable discovery event
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_code TEXT UNIQUE NOT NULL,              -- human-facing Candidate ID, e.g. AUR-2026-000123
  chain          chain_t     NOT NULL DEFAULT 'solana',
  token_id       UUID        NOT NULL REFERENCES tokens(id),
  pool_id        UUID        REFERENCES pools(id),
  discovered_at  TIMESTAMPTZ NOT NULL,              -- exact discovery timestamp (identity component)
  discovery_source source_t  NOT NULL,
  current_state  candidate_state_t NOT NULL DEFAULT 'RESEARCHING',
  ai_summary     TEXT,                              -- narrative only, never an engine input
  ai_summary_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, token_id, pool_id, discovered_at)
);
CREATE INDEX candidates_state_idx ON candidates (current_state);

-- Discovery snapshot: IMMUTABLE full copy of what we knew at discovery.
CREATE TABLE discovery_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  snapshot      JSONB NOT NULL,                     -- frozen market/on-chain snapshot
  source        source_t NOT NULL,
  observed_at   TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_event_id  UUID REFERENCES raw_events(id),
  UNIQUE (candidate_id)                             -- exactly one, never overwritten
);

-- Enforce immutability of discovery snapshots
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'row in % is immutable (append-only)', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER discovery_snapshots_immutable
  BEFORE UPDATE OR DELETE ON discovery_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Generic discovery event log (append-only) — every time a source re-surfaces the identity
CREATE TABLE discovery_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  source        source_t NOT NULL,
  detail        JSONB    NOT NULL,
  observed_at   TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_event_id  UUID REFERENCES raw_events(id)
);
CREATE INDEX discovery_events_cand_idx ON discovery_events (candidate_id, ingested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Generic observations + provenance mixin (documented; repeated per table)
-- ─────────────────────────────────────────────────────────────────────────
-- Free-form normalized observations that don't warrant a dedicated table yet.
CREATE TABLE observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidates(id),
  kind                    TEXT NOT NULL,            -- e.g. 'token_profile','boost','meta'
  value                   JSONB NOT NULL,
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),             -- 0..1
  raw_source_ref          TEXT,
  raw_event_id            UUID REFERENCES raw_events(id)
);
CREATE INDEX observations_cand_kind_idx ON observations (candidate_id, kind, ingested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Time-series: prices, liquidity, transaction aggregates
-- (partition by month; provenance on every row)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE prices (
  id                      UUID DEFAULT gen_random_uuid(),
  pool_id                 UUID NOT NULL REFERENCES pools(id),
  price_usd               NUMERIC(38,18),
  price_native            NUMERIC(38,18),
  market_cap_usd          NUMERIC(38,4),
  fdv_usd                 NUMERIC(38,4),
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ NOT NULL,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT,
  raw_event_id            UUID,
  PRIMARY KEY (id, observed_at)
) PARTITION BY RANGE (observed_at);
CREATE INDEX prices_pool_time_idx ON prices (pool_id, observed_at DESC);

CREATE TABLE liquidity_snapshots (
  id                      UUID DEFAULT gen_random_uuid(),
  pool_id                 UUID NOT NULL REFERENCES pools(id),
  liquidity_usd           NUMERIC(38,4),
  base_reserve            NUMERIC(38,18),
  quote_reserve           NUMERIC(38,18),
  lp_locked_pct           NUMERIC(6,3),             -- if determinable; else NULL
  lp_burned               BOOLEAN,
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ NOT NULL,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT,
  raw_event_id            UUID,
  PRIMARY KEY (id, observed_at)
) PARTITION BY RANGE (observed_at);
CREATE INDEX liq_pool_time_idx ON liquidity_snapshots (pool_id, observed_at DESC);

CREATE TABLE transaction_aggregates (
  id                      UUID DEFAULT gen_random_uuid(),
  pool_id                 UUID NOT NULL REFERENCES pools(id),
  window_seconds          INT NOT NULL,             -- 300, 3600, ...
  buys                    INT,
  sells                   INT,
  buyers                  INT,
  sellers                 INT,
  volume_usd              NUMERIC(38,4),
  net_flow_usd            NUMERIC(38,4),
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ NOT NULL,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT,
  raw_event_id            UUID,
  PRIMARY KEY (id, observed_at)
) PARTITION BY RANGE (observed_at);
CREATE INDEX txagg_pool_time_idx ON transaction_aggregates (pool_id, window_seconds, observed_at DESC);

-- Initial partitions (2026). A maintenance job creates future months.
CREATE TABLE prices_2026m07 PARTITION OF prices
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE liquidity_snapshots_2026m07 PARTITION OF liquidity_snapshots
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE transaction_aggregates_2026m07 PARTITION OF transaction_aggregates
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- OHLCV for structure detection (Entry Engine); GeckoTerminal-sourced
CREATE TABLE ohlcv (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id       UUID NOT NULL REFERENCES pools(id),
  timeframe     TEXT NOT NULL,                      -- '1m','5m','1h', ...
  ts            TIMESTAMPTZ NOT NULL,               -- candle open time
  o NUMERIC(38,18), h NUMERIC(38,18), l NUMERIC(38,18), c NUMERIC(38,18),
  v_usd NUMERIC(38,4),
  source        source_t NOT NULL DEFAULT 'geckoterminal',
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_event_id  UUID REFERENCES raw_events(id),
  UNIQUE (pool_id, timeframe, ts, source)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Wallet / deployer / funding intelligence
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE wallet_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain         chain_t NOT NULL DEFAULT 'solana',
  address       TEXT NOT NULL,
  label         TEXT,                               -- 'exchange','known_sniper',... (evidence-backed)
  is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, address)
);

CREATE TABLE wallet_performance (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id               UUID NOT NULL REFERENCES wallet_entities(id),
  perf_window             TEXT NOT NULL,            -- '30d','all'
  realized_pnl_usd        NUMERIC(38,4),
  win_rate                NUMERIC(5,4),             -- diagnostic only, not a gate
  trades                  INT,
  computed_from           JSONB,                    -- inputs used (auditability)
  source                  source_t NOT NULL DEFAULT 'aureus_derived',
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT
);
CREATE INDEX wallet_perf_wallet_idx ON wallet_performance (wallet_id, perf_window);

CREATE TABLE deployers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES wallet_entities(id),
  token_id      UUID NOT NULL REFERENCES tokens(id),
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  prior_launches INT,                               -- count of prior deploys (reputation input)
  reputation_note TEXT,
  source        source_t NOT NULL DEFAULT 'helius',
  observed_at   TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  raw_source_ref TEXT,
  UNIQUE (token_id, wallet_id)
);

CREATE TABLE funding_wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_id     UUID NOT NULL REFERENCES wallet_entities(id),
  funded_id     UUID NOT NULL REFERENCES wallet_entities(id),
  amount_native NUMERIC(38,18),
  tx_signature  TEXT,
  slot          BIGINT,
  source        source_t NOT NULL DEFAULT 'helius',
  observed_at   TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  raw_source_ref TEXT,                              -- tx signature / slot ref
  UNIQUE (funder_id, funded_id, tx_signature)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Holders, clusters, launch bundles
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE holder_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id                UUID NOT NULL REFERENCES tokens(id),
  taken_at                TIMESTAMPTZ NOT NULL,
  holder_count            INT,
  top10_pct               NUMERIC(6,3),
  top50_pct               NUMERIC(6,3),
  insider_pct             NUMERIC(6,3),             -- deployer/funder-linked share
  holders                 JSONB,                    -- [{address, pct}] top-N
  source                  source_t NOT NULL DEFAULT 'helius',
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT
);
CREATE INDEX holder_snap_token_idx ON holder_snapshots (token_id, taken_at DESC);

-- Clusters are OUR derived holder-graph groupings (source='aureus_derived'),
-- never fabricated from Bubblemaps.
CREATE TABLE clusters (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id                UUID NOT NULL REFERENCES tokens(id),
  method                  TEXT NOT NULL,            -- graph method + version
  member_count            INT,
  members                 JSONB,                    -- [address,...]
  combined_pct            NUMERIC(6,3),
  linkage_evidence        JSONB,                    -- edges used (funding/co-move)
  source                  source_t NOT NULL DEFAULT 'aureus_derived',
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT
);
CREATE INDEX clusters_token_idx ON clusters (token_id, ingested_at DESC);

CREATE TABLE launch_bundles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id                UUID NOT NULL REFERENCES tokens(id),
  bundle_tx_count         INT,
  wallets                 JSONB,                    -- wallets in the same-block/bundle buy
  same_slot               BOOLEAN,
  supply_pct_bundled      NUMERIC(6,3),
  source                  source_t NOT NULL DEFAULT 'helius',
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT
);
CREATE INDEX launch_bundles_token_idx ON launch_bundles (token_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Social / FOMO observations
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE social_observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidates(id),
  platform                TEXT NOT NULL,            -- 'x','telegram','fomo',...
  metric                  TEXT NOT NULL,            -- 'mentions','members','boost'
  value                   NUMERIC(38,4),
  is_paid_promotion       BOOLEAN NOT NULL DEFAULT FALSE, -- boost/paid correction
  detail                  JSONB,
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT
);
CREATE INDEX social_obs_cand_idx ON social_observations (candidate_id, platform, ingested_at DESC);

-- FOMO is manual-import only until permission established.
CREATE TABLE fomo_observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidates(id),
  post_url                TEXT NOT NULL,
  resolved_mint           TEXT NOT NULL,            -- must resolve to exact mint
  content_excerpt         TEXT,
  imported_by             TEXT NOT NULL DEFAULT 'manual',
  source                  source_t NOT NULL DEFAULT 'fomo',
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'MANUAL',
  raw_source_ref          TEXT
);

-- ─────────────────────────────────────────────────────────────────────────
-- Engine outputs: findings (Safety/Entry risks), confirmations (Quality)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE risk_findings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidates(id),
  engine                  TEXT NOT NULL,            -- 'safety','entry'
  rule_id                 TEXT NOT NULL,            -- e.g. 'SAFE-07-MINT-AUTHORITY'
  status                  safety_status_t,          -- for safety rules
  severity                severity_t NOT NULL,
  explanation             TEXT NOT NULL,
  evidence                JSONB NOT NULL,           -- the actual numbers/addresses
  invalidation            TEXT NOT NULL,            -- "what would change this outcome"
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT,
  spec_version            TEXT NOT NULL,
  param_hash              TEXT NOT NULL
);
CREATE INDEX risk_findings_cand_idx ON risk_findings (candidate_id, engine, ingested_at DESC);

CREATE TABLE confirmations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidates(id),
  dimension               TEXT NOT NULL,            -- 'independent_demand','capital_retention','attention'
  level                   quality_level_t NOT NULL, -- WEAK|DEVELOPING|CONFIRMED
  evidence                JSONB NOT NULL,
  missing_checks          JSONB,                    -- what is still unknown
  invalidation            TEXT NOT NULL,
  source                  source_t NOT NULL,
  observed_at             TIMESTAMPTZ,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_status         evidence_status_t NOT NULL DEFAULT 'VERIFIED',
  data_quality_confidence NUMERIC(4,3),
  raw_source_ref          TEXT,
  spec_version            TEXT NOT NULL,
  param_hash              TEXT NOT NULL
);
CREATE INDEX confirmations_cand_idx ON confirmations (candidate_id, dimension, ingested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Decision-state history (append-only; the reducer is the only writer)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE decision_state_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id),
  from_state     candidate_state_t,
  to_state       candidate_state_t NOT NULL,
  reason         TEXT NOT NULL,
  safety_status  safety_status_t,
  quality_demand quality_level_t,
  quality_capital quality_level_t,
  quality_attention quality_level_t,
  entry_status   entry_status_t,
  evidence_ref   JSONB,
  spec_version   TEXT NOT NULL,
  param_hash     TEXT NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dsh_cand_idx ON decision_state_history (candidate_id, at DESC);
CREATE TRIGGER dsh_immutable
  BEFORE UPDATE OR DELETE ON decision_state_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ─────────────────────────────────────────────────────────────────────────
-- Watchlists, alerts, simulated entries, positions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE watchlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE watchlist_members (
  watchlist_id UUID NOT NULL REFERENCES watchlists(id),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, candidate_id)
);

CREATE TABLE alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id),
  type           alert_type_t NOT NULL,
  token_label    TEXT,
  mint           TEXT NOT NULL,
  action         TEXT NOT NULL,
  reasons        JSONB NOT NULL,                    -- string[]
  data_freshness JSONB,                             -- per-input freshness summary
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ,
  candidate_link TEXT NOT NULL,
  delivered_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  read_at        TIMESTAMPTZ,
  dedup_key      TEXT NOT NULL,
  UNIQUE (dedup_key)
);
CREATE INDEX alerts_cand_idx ON alerts (candidate_id, created_at DESC);

CREATE TABLE simulated_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id),
  entry_price    NUMERIC(38,18) NOT NULL,
  invalidation   NUMERIC(38,18) NOT NULL,
  target         NUMERIC(38,18),
  rr             NUMERIC(8,3),
  est_slippage_pct NUMERIC(6,3),
  est_price_impact_pct NUMERIC(6,3),
  entry_pattern  TEXT,                              -- 'range_reclaim','retest',...
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ,
  spec_version   TEXT NOT NULL,
  param_hash     TEXT NOT NULL
);

CREATE TABLE positions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id),
  simulated_entry_id UUID REFERENCES simulated_entries(id),
  is_simulated   BOOLEAN NOT NULL DEFAULT TRUE,     -- MVP: simulated only, no real fund custody
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'OPEN',      -- OPEN|CLOSED|INVALIDATED
  notes          TEXT
);

-- ─────────────────────────────────────────────────────────────────────────
-- Outcomes (offline engine; anti-look-ahead). Written by outcome role only.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL REFERENCES candidates(id),
  anchor          TEXT NOT NULL,                    -- 'discovery' | 'alert:<id>'
  anchor_at       TIMESTAMPTZ NOT NULL,
  ret_1h NUMERIC(12,6), ret_6h NUMERIC(12,6), ret_24h NUMERIC(12,6),
  ret_72h NUMERIC(12,6), ret_7d NUMERIC(12,6), ret_30d NUMERIC(12,6),
  mfe NUMERIC(12,6), mae NUMERIC(12,6),
  time_to_peak_s  BIGINT,
  liquidity_drain_pct NUMERIC(6,3),
  rug_label       TEXT,                             -- 'rug'|'soft_fail'|'survived'|NULL
  holder_delta    INT,
  max_stage       candidate_state_t,
  sim_entry_return NUMERIC(12,6),
  sim_slippage_pct NUMERIC(6,3),
  false_positive  BOOLEAN,
  false_negative  BOOLEAN,
  reason          TEXT,
  window_complete BOOLEAN NOT NULL DEFAULT FALSE,   -- incomplete windows excluded from reports
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  spec_version    TEXT NOT NULL,
  UNIQUE (candidate_id, anchor)
);
CREATE INDEX outcomes_cand_idx ON outcomes (candidate_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Operational: source health, data-quality issues
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE source_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          source_t NOT NULL,
  observed_rpm_limit INT,                           -- learned from 429s
  configured_rpm  INT,
  last_ok_at      TIMESTAMPTZ,
  last_error_at   TIMESTAMPTZ,
  last_error      TEXT,
  consecutive_failures INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'UNKNOWN',  -- OK|DEGRADED|DOWN|UNKNOWN
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source)
);

CREATE TABLE data_quality_issues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID REFERENCES candidates(id),
  scope          TEXT NOT NULL,                     -- 'price','liquidity','holders',...
  kind           TEXT NOT NULL,                     -- 'conflict','stale','missing','duplicate'
  severity       severity_t NOT NULL,
  detail         JSONB NOT NULL,                    -- the conflicting values + sources
  is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX dqi_open_idx ON data_quality_issues (candidate_id, is_open, severity);

COMMIT;
