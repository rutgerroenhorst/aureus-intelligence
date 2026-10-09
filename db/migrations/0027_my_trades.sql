-- 0027_my_trades.sql: a persistent journal of the coins the user actually entered.
--
-- The Radar's "Enter" button used to POST to /api/my-trades, which kept the entry in a JavaScript Map: gone on every
-- restart or serverless cold start, with no record of WHICH TAB the entry came from, and with a "current market cap"
-- that was simply the entry value for any coin no longer on the board. Nothing could be learned from it.
--
-- Now every entry is a row: the tab it was made from, a live snapshot at the moment of entry, and after entry the highest
-- and lowest market cap seen (refreshed whenever a screen is open), so the Results page can show "peak 5.5x, now 0.4x".
-- source = 'manual' marks rows added by hand from the user's own screenshots/notes.

CREATE TABLE IF NOT EXISTS my_trades (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint                      TEXT NOT NULL,
  symbol                    TEXT,
  tab_name                  TEXT,                       -- cate | buy_signals | ultra_momentum | elite | incubation | NULL (unknown)
  source                    TEXT NOT NULL DEFAULT 'radar',
  entered_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  entry_mcap_usd            NUMERIC(20,2) NOT NULL CHECK (entry_mcap_usd > 0),
  entry_liquidity_usd       NUMERIC(20,2),
  entry_price_usd           NUMERIC(38,18),
  pair_age_minutes_at_entry INT,
  size_usd                  NUMERIC(12,2),
  note                      TEXT,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exited')),
  last_mcap_usd             NUMERIC(20,2),
  peak_mcap_usd             NUMERIC(20,2),
  peak_at                   TIMESTAMPTZ,
  low_mcap_usd              NUMERIC(20,2),
  last_checked_at           TIMESTAMPTZ,
  exit_mcap_usd             NUMERIC(20,2),
  exited_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS my_trades_status_idx ON my_trades (status, entered_at DESC);
CREATE INDEX IF NOT EXISTS my_trades_mint_idx   ON my_trades (mint);

GRANT SELECT, INSERT, UPDATE ON my_trades TO aureus_app;
