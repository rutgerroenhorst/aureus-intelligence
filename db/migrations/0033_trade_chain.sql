-- 0033_trade_chain.sql: the trade journal can hold coins from other networks than Solana.
--
-- chain is the id used in lib/chains.ts ('solana', 'base', 'bsc', 'monad', 'ethereum', 'robinhood'). Every existing row is Solana,
-- which is the default, so nothing changes for them. Additive only.

ALTER TABLE my_trades ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'solana';
