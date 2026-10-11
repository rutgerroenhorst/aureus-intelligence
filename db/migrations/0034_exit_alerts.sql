-- 0034_exit_alerts.sql: which exit alerts (2x / 5x of what was paid for what is still held) have been reported, so each goes out once.
--
-- apps/worker/src/exitLoop.ts. A position is a coin plus the time of its oldest lot still held (first in first out), so a coin that was sold
-- in full and bought again is a new position. Level 0 is the "this position has been seen" marker; 'seeded' means the level was already
-- reached when the alerts were switched on (no message), 'claimed' is a message about to be sent (cleared after ten minutes if the
-- process died in between), 'sent' carries Telegram's message id. No chat id and no token are stored here: they live in a git-ignored file.

CREATE TABLE IF NOT EXISTS exit_alerts (
  mint           TEXT NOT NULL,
  level          NUMERIC(8,2) NOT NULL,
  position_start TIMESTAMPTZ NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('seeded', 'claimed', 'sent')),
  multiple       NUMERIC(14,4),
  price          NUMERIC(38,18),
  basis          NUMERIC(38,18),
  value_usd      NUMERIC(14,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ,
  message_id     BIGINT,
  PRIMARY KEY (mint, level, position_start)
);

CREATE TABLE IF NOT EXISTS exit_alert_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON exit_alerts, exit_alert_kv TO aureus_app;
