-- 0039_pump_graduates_chain.sql: pump.fun graduations read from the chain, for the hosted site.
--
-- The laptop reads graduations from pump.fun's live event stream (a websocket only a computer that stays awake can hold), so the hosted site's Graduations tab stood still
-- whenever the laptop slept. The site now reads them itself, every 3 minutes: the migration authority's signatures on the Solana RPC list every graduation, Jupiter's token
-- API gives the coin's name, launch time and numbers, and the creating transaction gives what the creator bought (apps/web/lib/graduateFeed.ts, docs/GRADUATIONS_FEED.md).
--
-- pump_graduates.via   where the row came from: 'stream' (the laptop's event stream, the default and every row so far) or 'chain' (the site's own feed)
-- pump_graduates.facts the feed's compact record of the coin's readings (first, peak liquidity, highest price, about one hour after graduation, newest), updated in place; null for stream rows
--
-- Additive only: two columns with defaults on one table, nothing dropped or changed.

ALTER TABLE pump_graduates ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'stream';
ALTER TABLE pump_graduates ADD COLUMN IF NOT EXISTS facts JSONB;
CREATE INDEX IF NOT EXISTS pump_graduates_via_time_idx ON pump_graduates (via, migrated_at);
