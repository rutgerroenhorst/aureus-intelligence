-- 0029_lab_watch.sql: the Learning Lab's own watch list, for coins the Radar's door does not let in.
--
-- The Radar admits a coin only when its pair is at least 60 minutes old and worth at most $150K at the door
-- (apps/worker/src/run.ts, DISCOVERY_MIN_AGE_MIN / DISCOVERY_MAX_MCAP_USD). That is a deliberate choice for what the Radar
-- shows, but it means the system never learns what happens to the coins it turns away: HOTBOT (a coin the user holds, now
-- 10x) was above $1M within hours of graduating and was never seen. The lab watches those coins too, without touching the
-- Radar: they are polled by the lab's own collector and become lessons with a lane of their own.
--
--   lane  graduate  turned away at the door as too young (under 60 minutes)
--         runner    turned away as too big for the door, or found on Jupiter's organic / traded / trending top lists
--
-- Rows are written by the worker's discovery pass (what the door turned away) and by the lab tick (Jupiter's lists).

CREATE TABLE IF NOT EXISTS lab_watch (
  mint            TEXT PRIMARY KEY,
  lane            TEXT NOT NULL,
  reason          TEXT NOT NULL,                 -- too_young | too_big | jupiter_organic | jupiter_traded | jupiter_trending
  chain           TEXT NOT NULL DEFAULT 'solana',
  symbol          TEXT,
  name            TEXT,
  pool_address    TEXT,
  pair_created_at TIMESTAMPTZ,
  launchpad       TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_mcap      NUMERIC(20,2),
  first_liq       NUMERIC(20,2),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  watch_until     TIMESTAMPTZ NOT NULL,
  last_polled_at  TIMESTAMPTZ,
  polls           INT NOT NULL DEFAULT 0,
  gone_polls      INT NOT NULL DEFAULT 0,         -- consecutive polls where the exchange listed nothing for the coin
  note            TEXT
);
CREATE INDEX IF NOT EXISTS lab_watch_poll_idx ON lab_watch (active, last_polled_at);
CREATE INDEX IF NOT EXISTS lab_watch_first_seen_idx ON lab_watch (first_seen_at);

GRANT SELECT, INSERT, UPDATE ON lab_watch TO aureus_app;
