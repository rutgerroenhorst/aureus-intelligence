-- Index for "the last N transaction windows for this pool".
--
-- txagg_pool_time_idx is (pool_id, window_seconds, observed_at DESC). The board asks
-- only for pool_id ordered by observed_at, so window_seconds sits between the two
-- columns it needs and the index cannot supply the ordering: every candidate fell back
-- to a top-N heapsort across partitions. 3.1s for 400 candidates, and it was the single
-- largest remaining cost on /today once the rule projection landed.
--
-- The existing index is kept: queries that DO filter by window_seconds still want it.
CREATE INDEX IF NOT EXISTS txagg_pool_observed_idx
  ON transaction_aggregates (pool_id, observed_at DESC);
