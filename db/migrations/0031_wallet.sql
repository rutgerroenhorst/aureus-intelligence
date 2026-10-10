-- 0031_wallet.sql: what the user's own wallet bought and sold, read from the chain with only its public address.
--
-- wallet_watch    the address(es) the system follows (one row; never returned by any API, only masked on screens)
-- wallet_txs      every transaction signature of the address and whether it has been read yet (the free public RPC is rate
--                 limited, so reading is gradual and resumable: a transaction that could not be read is tried again later)
-- wallet_fills    what each readable transaction did: a buy or sell of one coin (with what was paid or received and its value in
--                 dollars at that hour), or a plain transfer in or out
--
-- Additive only: no existing table is altered or dropped, so older code ignores all of this. The trade journal (my_trades) is
-- updated from these rows by lib/walletSync.ts, with rows added by the sync marked source = 'wallet'.

CREATE TABLE IF NOT EXISTS wallet_watch (
  address    TEXT PRIMARY KEY,
  label      TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at  TIMESTAMPTZ,
  newest_sig TEXT
);

CREATE TABLE IF NOT EXISTS wallet_txs (
  signature  TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  block_time TIMESTAMPTZ,
  -- pending: not read yet (or could not be read, see tries); done: read; skipped: failed on chain or unreadable after many tries
  state      TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'skipped')),
  tries      INT NOT NULL DEFAULT 0,
  last_try   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wallet_txs_state_idx ON wallet_txs (address, state, block_time DESC);

CREATE TABLE IF NOT EXISTS wallet_fills (
  signature    TEXT NOT NULL,
  address      TEXT NOT NULL,
  t            TIMESTAMPTZ NOT NULL,
  mint         TEXT NOT NULL,
  -- buy / sell: a swap against SOL or a stablecoin; in / out: tokens received or sent away without a price
  side         TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'in', 'out')),
  tokens       DOUBLE PRECISION NOT NULL,
  quote        TEXT,
  quote_amount DOUBLE PRECISION,
  usd          DOUBLE PRECISION,
  PRIMARY KEY (signature, mint, side)
);
CREATE INDEX IF NOT EXISTS wallet_fills_mint_idx ON wallet_fills (address, mint, t);

-- what the wallet shows about a journal row: dollars taken out by sells, the share of the position that was sold, tokens still held
ALTER TABLE my_trades ADD COLUMN IF NOT EXISTS sold_usd      NUMERIC(14,2);
ALTER TABLE my_trades ADD COLUMN IF NOT EXISTS sold_fraction REAL;
ALTER TABLE my_trades ADD COLUMN IF NOT EXISTS tokens_held   DOUBLE PRECISION;

GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_watch, wallet_txs, wallet_fills TO aureus_app;
