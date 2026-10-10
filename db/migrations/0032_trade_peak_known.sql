-- 0032_trade_peak_known.sql: say which journal rows have a measured price path.
--
-- A row made with the Enter button is followed from that moment (highest and lowest market cap seen). A row that the wallet sync
-- adds for a trade made days or weeks ago has no recorded path: its "peak" is only what is known now. Those rows are marked
-- peak_known = false so the exit-plan comparison does not judge them on a path nobody recorded.
-- Additive only.

ALTER TABLE my_trades ADD COLUMN IF NOT EXISTS peak_known BOOLEAN NOT NULL DEFAULT TRUE;
