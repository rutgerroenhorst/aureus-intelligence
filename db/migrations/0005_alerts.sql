-- 0005_alerts.sql — alerting, notification delivery, worker lifecycle & heartbeat.
--
-- alert_events are the deterministic, deduplicated intent to notify. Delivery is
-- tracked separately (retry-safe). No secrets are ever stored here.

BEGIN;

CREATE TYPE alert_level_t AS ENUM ('INFO', 'WATCH', 'HIGH_PRIORITY', 'ENTRY_READY', 'RISK', 'SYSTEM');
CREATE TYPE delivery_status_t AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- ── Candidate lifecycle / adaptive polling ────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS next_scan_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scan_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scan_attempts       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_errors  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activity_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS candidates_next_scan_idx ON candidates (next_scan_at) WHERE next_scan_at IS NOT NULL;

-- ── Notification channels (config only; NO secrets) ───────────────────────
CREATE TABLE notification_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL,          -- 'telegram' | 'in_app'
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  mode         TEXT NOT NULL DEFAULT 'DEGRADED', -- LIVE | DEGRADED | DISABLED
  min_level    alert_level_t NOT NULL DEFAULT 'WATCH',
  last_ok_at   TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind)
);

-- ── Alert policies (deterministic; catalog seeded from code) ──────────────
CREATE TABLE alert_policies (
  policy_id    TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  level        alert_level_t NOT NULL,
  severity     severity_t NOT NULL,
  description  TEXT NOT NULL,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Alert events (deduplicated intent) ────────────────────────────────────
CREATE TABLE alert_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     UUID NOT NULL REFERENCES candidates(id),
  policy_id        TEXT NOT NULL,
  policy_version   TEXT NOT NULL,
  level            alert_level_t NOT NULL,
  severity         severity_t NOT NULL,
  state_from       candidate_state_t,
  state_to         candidate_state_t NOT NULL,
  evidence_hash    TEXT NOT NULL,
  evidence         JSONB NOT NULL DEFAULT '{}'::jsonb,
  engine_versions  JSONB NOT NULL DEFAULT '{}'::jsonb,
  message          TEXT NOT NULL,
  dedup_key        TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedup_key)
);
CREATE INDEX alert_events_cand_idx ON alert_events (candidate_id, created_at DESC);
CREATE INDEX alert_events_level_idx ON alert_events (level, created_at DESC);

-- ── Notification deliveries (retry-safe) ──────────────────────────────────
CREATE TABLE notification_deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_event_id     UUID NOT NULL REFERENCES alert_events(id),
  channel            TEXT NOT NULL,
  status             delivery_status_t NOT NULL DEFAULT 'PENDING',
  attempts           INT NOT NULL DEFAULT 0,
  telegram_message_id BIGINT,
  payload_hash       TEXT,
  last_error         TEXT,
  delivered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_event_id, channel)
);
CREATE INDEX deliveries_status_idx ON notification_deliveries (status, updated_at);

CREATE TABLE notification_failures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_event_id UUID REFERENCES alert_events(id),
  channel        TEXT NOT NULL,
  error          TEXT NOT NULL,
  failed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Worker heartbeats ─────────────────────────────────────────────────────
CREATE TABLE worker_heartbeats (
  worker_id        TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'STARTING', -- STARTING|RUNNING|IDLE|STOPPING|ERROR
  cycle_count      BIGINT NOT NULL DEFAULT 0,
  last_cycle_at    TIMESTAMPTZ,
  last_cycle_ms    INT,
  avg_cycle_ms     INT,
  candidates_last_cycle INT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
