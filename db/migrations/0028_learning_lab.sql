-- 0028_learning_lab.sql: the Learning Lab. One compact row per coin the system has ever followed, with robust outcome
-- labels and the market's state at fixed moments after the first look, plus cached analyses computed from those rows.
--
-- Why a separate store: the learning that existed (coin_qualifications) only knew the coins that happened to be listed on
-- a Radar tab, graded them against one noisy label ("2x on any single check"), and the raw price history it would need
-- to learn from everything else is pruned after 7 days on the hosted database. The lab keeps the lessons, not the history.
--
--   lab_coins        one row per coin: first-look features, outcome labels, decision-time snapshots with forward labels
--   lab_reports      the latest computed analysis per kind (insights, rule board, model, ...); the page only reads these
--   lab_signals_ts   time series from the lab's own collectors (price tail for coins the scanner stopped following,
--                    unique buyers/sellers from GeckoTerminal, organic stats from Jupiter); pruned after 21 days
--   lab_hypotheses   hypotheses written down BEFORE they are tested forward on coins first seen after the registration date

CREATE TABLE IF NOT EXISTS lab_coins (
  mint            TEXT PRIMARY KEY,
  chain           TEXT NOT NULL DEFAULT 'solana',
  candidate_id    UUID,
  symbol          TEXT,
  name            TEXT,
  lane            TEXT NOT NULL DEFAULT 'fresh',        -- fresh | graduate | runner
  first_seen_at   TIMESTAMPTZ NOT NULL,
  pair_created_at TIMESTAMPTZ,
  first_price     NUMERIC(38,18),
  first_mcap      NUMERIC(20,2),
  first_liq       NUMERIC(20,2),
  last_seen_at    TIMESTAMPTZ,
  observations    INT NOT NULL DEFAULT 0,
  phantoms        INT NOT NULL DEFAULT 0,               -- price/liquidity readings recognised as a data glitch and left out
  tags            TEXT[] NOT NULL DEFAULT '{}',         -- narrative tags from the name/symbol/site (known at the first look)
  snaps           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{tau, ts, f:{features}, y:{forward labels}|null}]
  outcome         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {cls, peakHeld{}, minMult{}, finalMult{}, tTo{}, ...}
  status          TEXT NOT NULL DEFAULT 'open',         -- open: still maturing | final: nothing left to learn from it
  source          TEXT NOT NULL DEFAULT 'local',        -- which database built the row (local seed or hosted scan)
  built_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_coins_first_seen_idx ON lab_coins (first_seen_at);
CREATE INDEX IF NOT EXISTS lab_coins_status_idx ON lab_coins (status, built_at);

CREATE TABLE IF NOT EXISTS lab_reports (
  kind        TEXT PRIMARY KEY,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  n_coins     INT,
  payload     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_signals_ts (
  id        BIGSERIAL PRIMARY KEY,
  mint      TEXT NOT NULL,
  taken_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source    TEXT NOT NULL,                              -- price_tail | gecko_multi | jupiter
  payload   JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS lab_signals_ts_mint_idx ON lab_signals_ts (mint, taken_at DESC);
CREATE INDEX IF NOT EXISTS lab_signals_ts_time_idx ON lab_signals_ts (taken_at);

CREATE TABLE IF NOT EXISTS lab_hypotheses (
  id            TEXT PRIMARY KEY,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title         TEXT NOT NULL,
  statement     TEXT NOT NULL,
  definition    JSONB NOT NULL,
  note          TEXT
);

-- The web role is least-privilege: it reads and writes the lab's own tables and nothing else is widened.
GRANT SELECT, INSERT, UPDATE, DELETE ON lab_coins, lab_signals_ts TO aureus_app;
GRANT SELECT, INSERT, UPDATE ON lab_reports, lab_hypotheses TO aureus_app;
GRANT USAGE, SELECT ON SEQUENCE lab_signals_ts_id_seq TO aureus_app;
