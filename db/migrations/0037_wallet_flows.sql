-- 0037_wallet_flows.sql: money that moved into or out of the followed wallet without being a trade (deposits and withdrawals of SOL).
--
-- wallet_flows   one row per transfer: a system-program SOL transfer between the wallet and ANOTHER address, in a transaction that is not a trade
--                (apps/web/lib/wallet.ts decodeFlows says exactly what counts and what does not). usd is the value at the time of the transfer
--                (DefiLlama's hourly SOL price), counterparty is the other address (kept here, masked wherever it is shown).
-- wallet_txs.flows_read   whether the transaction has been looked at for flows (transactions read before this migration are read once more by
--                scripts/wallet-flows.ts; the sync marks the ones it reads from now on)
--
-- Additive only: nothing existing is altered or dropped except one new column with a default. Older code ignores all of it.

CREATE TABLE IF NOT EXISTS wallet_flows (
  signature    TEXT NOT NULL,
  address      TEXT NOT NULL,
  t            TIMESTAMPTZ NOT NULL,
  asset        TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount       DOUBLE PRECISION NOT NULL,
  usd          DOUBLE PRECISION,
  counterparty TEXT,
  -- the position of the transfer inside its transaction, so two transfers in one transaction are two rows
  n            SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (signature, direction, n)
);
CREATE INDEX IF NOT EXISTS wallet_flows_time_idx ON wallet_flows (address, t);

ALTER TABLE wallet_txs ADD COLUMN IF NOT EXISTS flows_read BOOLEAN NOT NULL DEFAULT FALSE;

GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_flows TO aureus_app;
