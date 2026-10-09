-- 0026_cloud_retention.sql: a rolling window for the small hosted (Supabase Free, 500 MB) copy of the database.
--
-- Every coin evaluation writes about 8 KB, mostly into six append-only history tables. On the free tier that fills
-- the disk within weeks, after which the project turns read-only. prune_history(keep_days) removes history older than
-- keep_days from exactly those tables:
--
--   raw_events (+ observations), prices, liquidity_snapshots, transaction_aggregates, intelligence_v2_scores,
--   feature_values
--
-- The newest row per pool / candidate / feature is always kept, however old: a coin that has not been scanned for a
-- week still shows its last known state.
--
-- It deliberately leaves alone everything that records decisions or is a snapshot/ledger of them (candidates, rule
-- evaluations, decision_state_history, candidate_snapshots, discovery_*, outcome_*, the research notebook, paper
-- tracking, coin_qualifications): those grow only when something changes and are small.
--
-- intelligence_v2_scores and feature_values are protected by "immutable" triggers. The guard is lifted for the duration
-- of this one transaction only: ALTER TABLE ... DISABLE TRIGGER is transactional and holds a lock on the table, so no other
-- session can write to it while the guard is off, and it is switched back on before the function returns.
--
-- NOTHING CALLS THIS ON ITS OWN. The web app runs it only when RETENTION_DAYS is set (it is set on the Vercel project and
-- nowhere else), so the laptop database, which is the full research record, is never pruned.

CREATE OR REPLACE FUNCTION prune_history(keep_days INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  cnt    BIGINT;
  res    JSONB := '{}'::jsonb;
BEGIN
  IF keep_days IS NULL OR keep_days < 2 THEN
    RAISE EXCEPTION 'prune_history: keep_days must be at least 2 (got %)', keep_days;
  END IF;
  cutoff := now() - make_interval(days => keep_days);

  -- Leaf history first. "AND EXISTS (newer row ...)" keeps the newest row of each pool.
  DELETE FROM prices p WHERE p.observed_at < cutoff
     AND EXISTS (SELECT 1 FROM prices x WHERE x.pool_id = p.pool_id AND x.observed_at > p.observed_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('prices', cnt);
  DELETE FROM liquidity_snapshots l WHERE l.observed_at < cutoff
     AND EXISTS (SELECT 1 FROM liquidity_snapshots x WHERE x.pool_id = l.pool_id AND x.observed_at > l.observed_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('liquidity_snapshots', cnt);
  DELETE FROM transaction_aggregates t WHERE t.observed_at < cutoff
     AND EXISTS (SELECT 1 FROM transaction_aggregates x
                  WHERE x.pool_id = t.pool_id AND x.window_seconds = t.window_seconds AND x.observed_at > t.observed_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('transaction_aggregates', cnt);

  -- Observations point at raw events, so they go before them. A raw event that something durable still points at
  -- (a discovery snapshot or event, OHLCV, a newer observation) is kept.
  DELETE FROM observations WHERE observed_at < cutoff;
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('observations', cnt);
  DELETE FROM raw_events r
   WHERE r.ingested_at < cutoff
     AND NOT EXISTS (SELECT 1 FROM observations o        WHERE o.raw_event_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM discovery_snapshots d WHERE d.raw_event_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM discovery_events e    WHERE e.raw_event_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM ohlcv v               WHERE v.raw_event_id = r.id);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('raw_events', cnt);

  -- The two immutable ledgers: guard off, delete, guard on, all inside this transaction.
  ALTER TABLE intelligence_v2_scores DISABLE TRIGGER prevent_intelligence_v2_delete;
  ALTER TABLE feature_values         DISABLE TRIGGER feature_values_immutable;
  DELETE FROM intelligence_v2_scores s WHERE s.computed_at < cutoff
     AND EXISTS (SELECT 1 FROM intelligence_v2_scores x WHERE x.candidate_id = s.candidate_id AND x.computed_at > s.computed_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('intelligence_v2_scores', cnt);
  DELETE FROM feature_values f WHERE f.calculated_at < cutoff
     AND EXISTS (SELECT 1 FROM feature_values x
                  WHERE x.candidate_id = f.candidate_id AND x.feature_id = f.feature_id AND x.calculated_at > f.calculated_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('feature_values', cnt);
  ALTER TABLE intelligence_v2_scores ENABLE TRIGGER prevent_intelligence_v2_delete;
  ALTER TABLE feature_values         ENABLE TRIGGER feature_values_immutable;

  RETURN res || jsonb_build_object('keep_days', keep_days, 'cutoff', cutoff);
END;
$$;

REVOKE ALL ON FUNCTION prune_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_history(INT) TO aureus_app;
