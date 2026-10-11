-- 0035_telegram_messages.sql: the Telegram messages the system sent (exit alerts, welcome, tests), for the "Telegram" page in the menu.
--
-- Written by the laptop (apps/worker/src/exitLoop.ts, scripts/exit-alerts-test.ts) and copied to the hosted database by the same loop when
-- LAB_SYNC_URL is set, so the phone shows them too. `body` is the text as the user read it (tags removed). No bot token, no chat id and no
-- address is ever stored here; a failed send is kept with Telegram's reason (cleaned of the token before it is written).

CREATE TABLE IF NOT EXISTS telegram_messages (
  id         BIGSERIAL PRIMARY KEY,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind       TEXT NOT NULL CHECK (kind IN ('alert', 'welcome', 'test')),
  ok         BOOLEAN NOT NULL,
  message_id BIGINT,
  symbol     TEXT,
  level      NUMERIC(8,2),
  multiple   NUMERIC(14,4),
  body       TEXT NOT NULL,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS telegram_messages_sent_idx ON telegram_messages (sent_at DESC);

GRANT SELECT, INSERT ON telegram_messages TO aureus_app;
