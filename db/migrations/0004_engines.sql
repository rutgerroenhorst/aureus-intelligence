-- 0004_engines.sql — persistence for Feature / Rule / Snapshot / Outcome engines
-- and the research notebook.
--
-- Determinism & immutability (binding):
--  * feature_values, rule_evaluations: append-only (corrections are new rows).
--  * candidate_snapshots + snapshot_features + snapshot_rules: immutable.
--  * research_notebook_entries: append-only timeline.
--  * outcome_measurements: immutable once written.
--  * outcome_schedules: MUTABLE (status PENDING -> DONE/SKIPPED) — the only one.
-- Reuses public.forbid_mutation() from 0001.

BEGIN;

CREATE TYPE feature_status_t AS ENUM ('OK', 'MISSING', 'UNAVAILABLE', 'STALE', 'PARTIAL');
CREATE TYPE rule_result_t    AS ENUM ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_APPLICABLE');
CREATE TYPE rule_family_t    AS ENUM ('SAFETY', 'QUALITY', 'ENTRY', 'POSITION_RISK', 'DATA_QUALITY');
CREATE TYPE snapshot_kind_t  AS ENUM ('discovery', 'm15', 'h1', 'h6', 'h24', 'h72', 'd7', 'd30');
CREATE TYPE schedule_status_t AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- ── Engine version registry ───────────────────────────────────────────────
CREATE TABLE engine_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine      TEXT NOT NULL,          -- 'feature' | 'rule' | 'snapshot' | 'outcome'
  version     TEXT NOT NULL,          -- semantic-ish, e.g. 'fe-0.1.0'
  param_hash  TEXT NOT NULL,          -- hash of the frozen config that produced results
  spec_ref    TEXT,                   -- doc reference
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engine, version, param_hash)
);

-- ── Feature definitions + values ──────────────────────────────────────────
CREATE TABLE feature_definitions (
  feature_id      TEXT PRIMARY KEY,
  version         TEXT NOT NULL,
  unit            TEXT NOT NULL,
  observation_window TEXT NOT NULL,
  description     TEXT NOT NULL,
  required_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_values (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id       UUID NOT NULL REFERENCES candidates(id),
  feature_id         TEXT NOT NULL REFERENCES feature_definitions(feature_id),
  version            TEXT NOT NULL,
  status             feature_status_t NOT NULL,
  value              NUMERIC(38,10),         -- NULL unless status = OK/PARTIAL
  unit               TEXT NOT NULL,
  observation_window TEXT NOT NULL,
  source_inputs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_quality       NUMERIC(4,3),           -- 0..1
  missing_reason     TEXT,
  explanation        TEXT NOT NULL,
  calculated_at      TIMESTAMPTZ NOT NULL,
  engine_version     TEXT NOT NULL
);
CREATE INDEX feature_values_cand_idx ON feature_values (candidate_id, feature_id, calculated_at DESC);
CREATE TRIGGER feature_values_immutable
  BEFORE UPDATE OR DELETE ON feature_values
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Rule definitions + evaluations ────────────────────────────────────────
CREATE TABLE rule_definitions (
  rule_id          TEXT PRIMARY KEY,
  rule_version     TEXT NOT NULL,
  family           rule_family_t NOT NULL,
  required_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity         severity_t NOT NULL,
  description      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rule_evaluations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id),
  rule_id        TEXT NOT NULL REFERENCES rule_definitions(rule_id),
  rule_version   TEXT NOT NULL,
  family         rule_family_t NOT NULL,
  result         rule_result_t NOT NULL,
  severity       severity_t NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation    TEXT NOT NULL,
  invalidation   TEXT NOT NULL,
  evaluated_at   TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ,
  engine_version TEXT NOT NULL
);
CREATE INDEX rule_evaluations_cand_idx ON rule_evaluations (candidate_id, family, evaluated_at DESC);
CREATE TRIGGER rule_evaluations_immutable
  BEFORE UPDATE OR DELETE ON rule_evaluations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Snapshots (immutable) ─────────────────────────────────────────────────
CREATE TABLE candidate_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        UUID NOT NULL REFERENCES candidates(id),
  kind                snapshot_kind_t NOT NULL,
  scheduled_for       TIMESTAMPTZ NOT NULL,     -- discovery_at + offset
  taken_at            TIMESTAMPTZ NOT NULL,
  decision_state      candidate_state_t NOT NULL,
  data_quality_status TEXT NOT NULL,            -- OK|DEGRADED|CONFLICTED|STALE
  engine_versions     JSONB NOT NULL,           -- {feature, rule, snapshot}
  market              JSONB,                    -- price/mcap/fdv
  liquidity           JSONB,
  holders             JSONB,
  wallet_flows        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, kind)
);
CREATE INDEX candidate_snapshots_cand_idx ON candidate_snapshots (candidate_id, scheduled_for);
CREATE TRIGGER candidate_snapshots_immutable
  BEFORE UPDATE OR DELETE ON candidate_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE snapshot_features (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID NOT NULL REFERENCES candidate_snapshots(id),
  feature_id    TEXT NOT NULL,
  version       TEXT NOT NULL,
  status        feature_status_t NOT NULL,
  value         NUMERIC(38,10),
  unit          TEXT NOT NULL,
  data_quality  NUMERIC(4,3),
  UNIQUE (snapshot_id, feature_id)
);
CREATE TRIGGER snapshot_features_immutable
  BEFORE UPDATE OR DELETE ON snapshot_features
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE snapshot_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID NOT NULL REFERENCES candidate_snapshots(id),
  rule_id       TEXT NOT NULL,
  rule_version  TEXT NOT NULL,
  family        rule_family_t NOT NULL,
  result        rule_result_t NOT NULL,
  severity      severity_t NOT NULL,
  UNIQUE (snapshot_id, rule_id)
);
CREATE TRIGGER snapshot_rules_immutable
  BEFORE UPDATE OR DELETE ON snapshot_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Research notebook (append-only timeline) ──────────────────────────────
CREATE TABLE research_notebook_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  seq          BIGINT NOT NULL,                 -- monotonic per candidate
  entry_type   TEXT NOT NULL,                   -- discovery|wallet_event|funding|liquidity|rule_transition|alert|note|outcome|lesson
  at           TIMESTAMPTZ NOT NULL,
  source       source_t,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, seq)
);
CREATE INDEX notebook_cand_idx ON research_notebook_entries (candidate_id, seq);
CREATE TRIGGER notebook_immutable
  BEFORE UPDATE OR DELETE ON research_notebook_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Outcome scheduling (mutable) + measurements (immutable) ────────────────
CREATE TABLE outcome_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  anchor        TEXT NOT NULL,                  -- 'discovery' | 'alert:<id>'
  anchor_at     TIMESTAMPTZ NOT NULL,
  horizon       snapshot_kind_t NOT NULL,       -- reuse horizon labels
  due_at        TIMESTAMPTZ NOT NULL,
  status        schedule_status_t NOT NULL DEFAULT 'PENDING',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, anchor, horizon)
);
CREATE INDEX outcome_sched_due_idx ON outcome_schedules (status, due_at);

CREATE TABLE outcome_measurements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID NOT NULL REFERENCES candidates(id),
  anchor            TEXT NOT NULL,
  anchor_at         TIMESTAMPTZ NOT NULL,
  horizon           snapshot_kind_t NOT NULL,
  measured_at       TIMESTAMPTZ NOT NULL,
  ret               NUMERIC(12,6),
  mfe               NUMERIC(12,6),
  mae               NUMERIC(12,6),
  time_to_peak_s    BIGINT,
  time_to_failure_s BIGINT,
  liquidity_loss_pct NUMERIC(6,3),
  holder_growth     INT,
  rug_label         TEXT,                       -- rug|soft_fail|survived|NULL
  reached_state     candidate_state_t,
  sim_entry_return  NUMERIC(12,6),
  false_positive    BOOLEAN,
  false_negative    BOOLEAN,
  window_complete   BOOLEAN NOT NULL DEFAULT FALSE,
  engine_version    TEXT NOT NULL,
  UNIQUE (candidate_id, anchor, horizon)
);
CREATE INDEX outcome_meas_cand_idx ON outcome_measurements (candidate_id);
CREATE TRIGGER outcome_measurements_immutable
  BEFORE UPDATE OR DELETE ON outcome_measurements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
