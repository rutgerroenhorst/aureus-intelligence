-- 0036_prune_rule_evaluations.sql: the hosted (Supabase Free, 500 MB) copy also drops superseded rule evaluations.
--
-- Found 2026-10-11 when the site began to scan around the clock: rule_evaluations (an append-only log, one row per rule per evaluation) was the one big
-- history table that prune_history() (0026) left alone. On the hosted database it held 66,000 rows / 27 MB after three days and grew about 14 MB a day
-- without a limit, while everything else is cut off at RETENTION_DAYS. The log exists for the full research record, and that is the laptop database,
-- which is never pruned (nothing calls prune_history there). The hosted copy only needs the verdict that is current, and that lives in
-- rule_evaluations_current (0013), which is not touched.
--
-- What changes: prune_history() now also deletes rule_evaluations rows older than keep_days IF a newer row exists for the same (candidate, rule), so the
-- newest verdict of every rule of every candidate is always kept, however old (exactly the rule the other tables follow). The row guard
-- (rule_evaluations_immutable, 0004) is lifted for the duration of this one transaction only, like the two ledgers 0026 already handles: ALTER TABLE ... DISABLE
-- TRIGGER is transactional and takes a lock, so nobody else can write to the table meanwhile, and it is switched back on before the function returns.
--
-- Nothing else is altered: same signature, same grants, same results for the six tables it already handled, one more key in the JSON it returns. Safe to run
-- again. Still NOTHING CALLS IT ON ITS OWN: the web app runs it only when RETENTION_DAYS is set (the Vercel project only).

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

  -- The immutable ledgers: guard off, delete, guard on, all inside this transaction.
  ALTER TABLE intelligence_v2_scores DISABLE TRIGGER prevent_intelligence_v2_delete;
  ALTER TABLE feature_values         DISABLE TRIGGER feature_values_immutable;
  ALTER TABLE rule_evaluations       DISABLE TRIGGER rule_evaluations_immutable;
  DELETE FROM intelligence_v2_scores s WHERE s.computed_at < cutoff
     AND EXISTS (SELECT 1 FROM intelligence_v2_scores x WHERE x.candidate_id = s.candidate_id AND x.computed_at > s.computed_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('intelligence_v2_scores', cnt);
  DELETE FROM feature_values f WHERE f.calculated_at < cutoff
     AND EXISTS (SELECT 1 FROM feature_values x
                  WHERE x.candidate_id = f.candidate_id AND x.feature_id = f.feature_id AND x.calculated_at > f.calculated_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('feature_values', cnt);
  DELETE FROM rule_evaluations e WHERE e.evaluated_at < cutoff
     AND EXISTS (SELECT 1 FROM rule_evaluations x WHERE x.candidate_id = e.candidate_id AND x.rule_id = e.rule_id AND x.evaluated_at > e.evaluated_at);
  GET DIAGNOSTICS cnt = ROW_COUNT; res := res || jsonb_build_object('rule_evaluations', cnt);
  ALTER TABLE intelligence_v2_scores ENABLE TRIGGER prevent_intelligence_v2_delete;
  ALTER TABLE feature_values         ENABLE TRIGGER feature_values_immutable;
  ALTER TABLE rule_evaluations       ENABLE TRIGGER rule_evaluations_immutable;

  RETURN res || jsonb_build_object('keep_days', keep_days, 'cutoff', cutoff);
END;
$$;

REVOKE ALL ON FUNCTION prune_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_history(INT) TO aureus_app;
