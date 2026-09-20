-- Phase 8 — enrichment/reevaluation LIVE validation report (READ-ONLY).
-- Run against your live DB after the worker has run ~20 min with Helius LIVE:
--   docker exec -i aureus_postgres psql -U aureus -d aureus -v ON_ERROR_STOP=1 -f - < scripts/phase8-validation.sql
-- (or: docker exec -i aureus_postgres psql -U aureus -d aureus < scripts/phase8-validation.sql)
-- Nothing here writes, promotes, or changes thresholds. It only reports what the
-- deterministic engines already recorded. "Before/after" is reconstructed from the
-- change-based history (feature_values / rule_evaluations / decision_state_history).

\pset pager off
\timing off

-- The 5+ most-recently enriched PARTIAL candidates (the validation set).
DROP TABLE IF EXISTS _pset;
CREATE TEMP TABLE _pset AS
SELECT c.id AS candidate_id, c.candidate_code, oe.computed_at AS enriched_at
FROM candidates c
JOIN onchain_enrichment oe ON oe.candidate_id = c.id
WHERE c.enrichment_status = 'PARTIAL'
ORDER BY oe.computed_at DESC
LIMIT 8;

\echo '========================================================================'
\echo ' VALIDATION SET (most-recent PARTIAL candidates)'
\echo '========================================================================'
SELECT candidate_code, candidate_id, enriched_at FROM _pset ORDER BY enriched_at DESC;

\echo ''
\echo '=== (1) Helius datasets per candidate: OK = fetched, INCOMPLETE = still missing (5) ==='
SELECT p.candidate_code,
       ds.key   AS dataset,
       ds.value->>'status' AS status,
       ds.value->>'reason' AS reason
FROM _pset p
JOIN onchain_enrichment oe ON oe.candidate_id = p.candidate_id
CROSS JOIN LATERAL jsonb_each(oe.datasets) AS ds(key, value)
ORDER BY p.candidate_code, (ds.value->>'status') DESC, ds.key;

\echo ''
\echo '=== (2) Features UNAVAILABLE/MISSING -> OK/PARTIAL after enrichment ==='
WITH fv AS (
  SELECT f.candidate_id, f.feature_id, f.status, f.value, f.calculated_at,
         LAG(f.status) OVER (PARTITION BY f.candidate_id, f.feature_id ORDER BY f.calculated_at) AS prev_status,
         LAG(f.calculated_at) OVER (PARTITION BY f.candidate_id, f.feature_id ORDER BY f.calculated_at) AS prev_at
  FROM feature_values f
  JOIN _pset p ON p.candidate_id = f.candidate_id
)
SELECT pset.candidate_code, fv.feature_id,
       fv.prev_status AS before_status, fv.status AS after_status, fv.value AS after_value,
       fv.prev_at AS before_at, fv.calculated_at AS after_at
FROM fv JOIN _pset pset ON pset.candidate_id = fv.candidate_id
WHERE fv.prev_status IN ('UNAVAILABLE','MISSING')
  AND fv.status IN ('OK','PARTIAL')
  AND fv.calculated_at >= pset.enriched_at
ORDER BY pset.candidate_code, fv.feature_id;

\echo ''
\echo '=== (3) Rules INCOMPLETE -> PASS/FAIL after enrichment ==='
WITH re AS (
  SELECT r.candidate_id, r.rule_id, r.family, r.result, r.evaluated_at,
         LAG(r.result) OVER (PARTITION BY r.candidate_id, r.rule_id ORDER BY r.evaluated_at) AS prev_result,
         LAG(r.evaluated_at) OVER (PARTITION BY r.candidate_id, r.rule_id ORDER BY r.evaluated_at) AS prev_at
  FROM rule_evaluations r
  JOIN _pset p ON p.candidate_id = r.candidate_id
)
SELECT pset.candidate_code, re.rule_id, re.family,
       re.prev_result AS before, re.result AS after,
       re.prev_at AS before_at, re.evaluated_at AS after_at
FROM re JOIN _pset pset ON pset.candidate_id = re.candidate_id
WHERE re.prev_result = 'INCOMPLETE'
  AND re.result IN ('PASS','FAIL')
  AND re.evaluated_at >= pset.enriched_at
ORDER BY pset.candidate_code, re.rule_id;

\echo ''
\echo '=== (4) Rules STILL INCOMPLETE (latest evaluation) ==='
WITH latest AS (
  SELECT DISTINCT ON (r.candidate_id, r.rule_id)
         r.candidate_id, r.rule_id, r.family, r.result, r.explanation, r.evaluated_at
  FROM rule_evaluations r
  JOIN _pset p ON p.candidate_id = r.candidate_id
  ORDER BY r.candidate_id, r.rule_id, r.evaluated_at DESC
)
SELECT pset.candidate_code, l.rule_id, l.family, l.explanation
FROM latest l JOIN _pset pset ON pset.candidate_id = l.candidate_id
WHERE l.result = 'INCOMPLETE'
ORDER BY pset.candidate_code, l.rule_id;

\echo ''
\echo '=== (5) Exact datasets still missing that block those rules (per candidate) ==='
SELECT p.candidate_code, ds.key AS missing_dataset, ds.value->>'reason' AS reason
FROM _pset p
JOIN onchain_enrichment oe ON oe.candidate_id = p.candidate_id
CROSS JOIN LATERAL jsonb_each(oe.datasets) AS ds(key, value)
WHERE ds.value->>'status' = 'INCOMPLETE'
ORDER BY p.candidate_code, ds.key;

\echo ''
\echo '=== (6/7) State + reason BEFORE and AFTER reevaluation ==='
-- If a reeval changed state, a decision_state_history row exists at/after enriched_at
-- (from_state/reason of that row = "before", to_state/reason = "after").
-- If no such row, state was unchanged by the reeval -> before == after == current_state.
SELECT p.candidate_code,
       COALESCE(h.from_state::text, c.current_state::text) AS state_before,
       COALESCE(h.to_state::text,   c.current_state::text) AS state_after,
       COALESCE(prev.reason, '(unchanged since enrichment)') AS reason_before,
       COALESCE(h.reason, c.current_state || ' — no transition on reeval') AS reason_after,
       CASE WHEN h.id IS NULL THEN 'NO STATE CHANGE' ELSE 'STATE CHANGED' END AS verdict
FROM _pset p
JOIN candidates c ON c.id = p.candidate_id
LEFT JOIN LATERAL (
  SELECT * FROM decision_state_history dh
  WHERE dh.candidate_id = p.candidate_id AND dh.at >= p.enriched_at
  ORDER BY dh.at ASC LIMIT 1
) h ON TRUE
LEFT JOIN LATERAL (
  SELECT reason FROM decision_state_history dh2
  WHERE dh2.candidate_id = p.candidate_id AND dh2.at < COALESCE(h.at, now())
  ORDER BY dh2.at DESC LIMIT 1
) prev ON TRUE
ORDER BY p.candidate_code;

\echo ''
\echo '=== (8) Monitoring tier (CURRENT). NOTE: tier is not historized in the DB.'
\echo '        The BEFORE tier must be read from the worker log (cycle/candidate/reevaluated stage). ==='
SELECT p.candidate_code, c.monitoring_tier AS tier_now, c.enrichment_status, c.next_scan_at
FROM _pset p JOIN candidates c ON c.id = p.candidate_id
ORDER BY p.candidate_code;

\echo ''
\echo '=== (9) Enrichment -> reevaluation latency (DB approximation) ==='
-- Approx latency = first engine write at/after enrichment  -  enrichment computed_at.
-- (The exact per-job latency comes from the log analyzer: acked -> reevaluated.)
SELECT p.candidate_code,
       p.enriched_at,
       LEAST(
         COALESCE(MIN(fv.calculated_at) FILTER (WHERE fv.calculated_at >= p.enriched_at), 'infinity'),
         COALESCE(MIN(re.evaluated_at)  FILTER (WHERE re.evaluated_at  >= p.enriched_at), 'infinity')
       ) AS reeval_at,
       ROUND(EXTRACT(EPOCH FROM (
         LEAST(
           COALESCE(MIN(fv.calculated_at) FILTER (WHERE fv.calculated_at >= p.enriched_at), 'infinity'),
           COALESCE(MIN(re.evaluated_at)  FILTER (WHERE re.evaluated_at  >= p.enriched_at), 'infinity')
         ) - p.enriched_at))::numeric, 2) AS latency_seconds
FROM _pset p
LEFT JOIN feature_values   fv ON fv.candidate_id = p.candidate_id
LEFT JOIN rule_evaluations re ON re.candidate_id = p.candidate_id
GROUP BY p.candidate_code, p.enriched_at
ORDER BY p.candidate_code;

\echo ''
\echo '========================================================================'
\echo ' AGGREGATES (last 20 min)'
\echo '========================================================================'
\echo '--- features that became available (UNAVAILABLE/MISSING -> OK/PARTIAL) ---'
WITH fv AS (
  SELECT candidate_id, feature_id, status, calculated_at,
         LAG(status) OVER (PARTITION BY candidate_id, feature_id ORDER BY calculated_at) AS prev
  FROM feature_values WHERE calculated_at > now() - interval '20 minutes'
)
SELECT count(*) AS features_became_available
FROM fv WHERE prev IN ('UNAVAILABLE','MISSING') AND status IN ('OK','PARTIAL');

\echo '--- rules INCOMPLETE -> PASS/FAIL ---'
WITH re AS (
  SELECT candidate_id, rule_id, result, evaluated_at,
         LAG(result) OVER (PARTITION BY candidate_id, rule_id ORDER BY evaluated_at) AS prev
  FROM rule_evaluations WHERE evaluated_at > now() - interval '20 minutes'
)
SELECT count(*) AS rules_incomplete_to_resolved
FROM re WHERE prev = 'INCOMPLETE' AND result IN ('PASS','FAIL');

\echo '--- actual state changes ---'
SELECT count(*) AS state_changes
FROM decision_state_history WHERE at > now() - interval '20 minutes';

\echo '--- enrichments persisted (rows touched in window) ---'
SELECT count(*) AS enrichments_updated
FROM onchain_enrichment WHERE computed_at > now() - interval '20 minutes';
