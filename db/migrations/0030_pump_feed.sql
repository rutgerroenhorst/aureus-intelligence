-- 0030_pump_feed.sql: pump.fun's own event stream (PumpPortal's free websocket), kept for the Learning Lab.
--
-- pump_launches    every coin created on pump.fun, for 72 hours: who created it, how much they bought in the same transaction,
--                  whether it was launched in Mayhem Mode (an AI agent trades it for 24 hours, supply 2 billion instead of 1)
-- pump_graduates   every coin that graduated to PumpSwap, with what was known at that moment: minutes from launch to graduation,
--                  the creator's first buy, Mayhem Mode, how many coins the same creator launched in the 72 hours before
--
-- Written by one process only (a database lock makes sure of it: the feed asks to be the only connection). Graduates also enter
-- lab_watch (lane "graduate") from their first minute, so the lab follows them from the start.

CREATE TABLE IF NOT EXISTS pump_launches (
  mint            TEXT PRIMARY KEY,
  creator         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  name            TEXT,
  symbol          TEXT,
  initial_buy_sol DOUBLE PRECISION,
  mcap_sol        DOUBLE PRECISION,
  mayhem          BOOLEAN NOT NULL DEFAULT FALSE,
  pool            TEXT
);
CREATE INDEX IF NOT EXISTS pump_launches_creator_idx ON pump_launches (creator, created_at DESC);
CREATE INDEX IF NOT EXISTS pump_launches_time_idx ON pump_launches (created_at);

CREATE TABLE IF NOT EXISTS pump_graduates (
  mint                  TEXT PRIMARY KEY,
  migrated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  creator               TEXT,
  created_at            TIMESTAMPTZ,
  create_to_migrate_min DOUBLE PRECISION,
  initial_buy_sol       DOUBLE PRECISION,
  mayhem                BOOLEAN,
  creator_launches_72h  INT,
  name                  TEXT,
  symbol                TEXT,
  signature             TEXT
);
CREATE INDEX IF NOT EXISTS pump_graduates_time_idx ON pump_graduates (migrated_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON pump_launches, pump_graduates TO aureus_app;
