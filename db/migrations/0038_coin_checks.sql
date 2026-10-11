-- 0038_coin_checks.sql: the "Check" button on the Radar's coin cards.
--
-- The user presses Check on a coin that is dead or does not belong on its tab. The site looks at the coin again right now and says what it finds
-- (apps/web/lib/coinCheck.ts: it agrees only when the data show it, and says "I do not agree" otherwise). Every check is kept here with what was
-- measured and what the site concluded, so the Learning page can grade the user's doubts against how those coins really ended, and a coin that its tab
-- lists again after a check carries a note. tab is the journal name of the tab (cate, buy_signals, ultra_momentum, elite, incubation, runners, graduates, hot).
--
-- Additive only: one new table, no existing table or column is touched.

CREATE TABLE IF NOT EXISTS coin_checks (
  id         BIGSERIAL PRIMARY KEY,
  mint       TEXT NOT NULL,
  chain      TEXT NOT NULL DEFAULT 'solana',
  symbol     TEXT,
  tab        TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('agree', 'disagree', 'unclear')),
  dead       BOOLEAN,
  flags      TEXT[] NOT NULL DEFAULT '{}',
  lines      TEXT[] NOT NULL DEFAULT '{}',
  -- what DexScreener showed at that moment (numbers only)
  snapshot   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_checks_coin_idx ON coin_checks (mint, tab, created_at DESC);
CREATE INDEX IF NOT EXISTS coin_checks_time_idx ON coin_checks (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON coin_checks TO aureus_app;
GRANT USAGE, SELECT ON SEQUENCE coin_checks_id_seq TO aureus_app;
