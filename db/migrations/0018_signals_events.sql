-- Real-time signals: meaningful events in the candidate lifecycle
-- NOT just status snapshots, but genuine transitions and milestones
CREATE TABLE signals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES candidates(id),

  -- Event classification
  event_type            TEXT NOT NULL,
  event_category        TEXT NOT NULL,
  event_priority        TEXT NOT NULL,

  -- Human-readable event description
  event_label           TEXT NOT NULL,
  event_description     TEXT,

  -- Numeric context
  change_pct            NUMERIC(12,4),
  change_raw            NUMERIC(38,18),
  duration_ms           INTEGER,

  -- Market data snapshot AT event time
  price_usd             NUMERIC(38,18),
  market_cap_usd        NUMERIC(38,18),
  liquidity_usd         NUMERIC(38,18),
  volume_24h_usd        NUMERIC(38,18),

  -- Status transition context
  status_from           TEXT,
  status_to             TEXT,

  -- Wallet event details
  wallet_count          INTEGER,
  net_flow_sol          NUMERIC(38,18),

  -- Raw event metadata
  metadata              JSONB DEFAULT '{}',

  -- State tracking
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deduplication
  event_hash            TEXT UNIQUE,

  -- Compositing: group related rapid-fire events
  event_bundle_id       UUID
);

CREATE INDEX signals_candidate_idx ON signals(candidate_id);
CREATE INDEX signals_created_idx ON signals(created_at DESC);
CREATE INDEX signals_event_type_idx ON signals(event_type);
CREATE INDEX signals_event_category_idx ON signals(event_category);
CREATE INDEX signals_priority_idx ON signals(event_priority);
CREATE INDEX signals_bundle_idx ON signals(event_bundle_id);

COMMENT ON TABLE signals IS 'Real-time meaningful events in candidate lifecycle';
COMMENT ON COLUMN signals.event_type IS 'STRUCTURAL_QUALIFICATION, WALLET_ENTRY, WALLET_EXIT, LIQUIDITY_CHANGE, RISK_ESCALATION, etc';
COMMENT ON COLUMN signals.event_category IS 'Wallets | Tokens | Structure | Liquidity | Risk | Entities | System';
COMMENT ON COLUMN signals.event_priority IS 'CRITICAL | HIGH | INFORMATIONAL';
