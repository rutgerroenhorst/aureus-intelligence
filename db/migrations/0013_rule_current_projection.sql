-- Current-rule projection over the append-only rule_evaluations log.
--
-- THE PROBLEM, measured. rule_evaluations keeps every re-evaluation forever, and the
-- worker rewrites the same 18 rules on every scan (every 20-60s). One candidate held
-- 5,550 rows for 18 distinct results. Reading "the current verdict per rule" therefore
-- scanned 92,069 rows to return 5,984 — 15x waste that grows every hour. It cost 4.85s
-- of a ~6s page and had begun returning 500s against the 10s query timeout.
--
-- WHY NOT RETENTION. rule_evaluations carries a forbid_mutation() trigger: it is
-- append-only by design, and that is worth keeping. Deleting superseded rows would have
-- meant disabling an intentional integrity guard to win a page load.
--
-- THE SHAPE. Append-only log + derived current-state projection. The log stays
-- immutable and complete; this table holds exactly one row per (candidate, rule) and is
-- upserted on the same write. Readers that want "now" read here; anything wanting
-- history still reads the log.
--
-- Reads stay correct if the projection is ever behind: it is written in the same
-- statement batch as the log, and a missing row surfaces as an absent rule (INCOMPLETE)
-- rather than a stale PASS.

CREATE TABLE IF NOT EXISTS rule_evaluations_current (
  candidate_id  uuid        NOT NULL,
  rule_id       text        NOT NULL,
  family        text        NOT NULL,
  result        text        NOT NULL,
  severity      text,
  rule_version  text,
  -- Full rule detail, not just the verdict: the candidate detail page needs the
  -- explanation and evidence too, and a projection that answers only half the question
  -- means the other half keeps hitting the log.
  explanation   text,
  invalidation  text,
  evidence      jsonb,
  evidence_hash text,
  evaluated_at  timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, rule_id)
);

CREATE INDEX IF NOT EXISTS rule_current_cand_idx ON rule_evaluations_current (candidate_id);

-- Backfill from the log. DISTINCT ON is expensive exactly once, here, rather than on
-- every page load.
INSERT INTO rule_evaluations_current
  (candidate_id, rule_id, family, result, severity, rule_version, explanation, invalidation, evidence, evidence_hash, evaluated_at)
SELECT DISTINCT ON (candidate_id, rule_id)
       candidate_id, rule_id, family::text, result::text, severity::text, rule_version,
       explanation, invalidation, evidence, evidence_hash, evaluated_at
  FROM rule_evaluations
 ORDER BY candidate_id, rule_id, evaluated_at DESC
ON CONFLICT (candidate_id, rule_id) DO NOTHING;

-- Reconciliation, run periodically by the worker.
--
-- The projection is written next to the log on every rule write, but that is two
-- statements, not one transaction: a crash between them, or any worker running code
-- older than this migration, leaves the projection behind. Drift then PERSISTS, because
-- a rule whose result never changes is never rewritten — the stale row would simply
-- stay stale, and a stale rule result is a wrong safety verdict, not a cosmetic bug.
--
-- This makes drift self-healing rather than permanent.
CREATE OR REPLACE FUNCTION reconcile_rule_current()
RETURNS bigint AS $$
DECLARE
  fixed bigint;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (candidate_id, rule_id)
           candidate_id, rule_id, family::text f, result::text r, severity::text s, rule_version,
           explanation, invalidation, evidence, evidence_hash, evaluated_at
      FROM rule_evaluations
     ORDER BY candidate_id, rule_id, evaluated_at DESC
  ), upserted AS (
    INSERT INTO rule_evaluations_current
      (candidate_id, rule_id, family, result, severity, rule_version, explanation, invalidation, evidence, evidence_hash, evaluated_at)
    SELECT candidate_id, rule_id, f, r, s, rule_version, explanation, invalidation, evidence, evidence_hash, evaluated_at FROM latest
    ON CONFLICT (candidate_id, rule_id) DO UPDATE
      SET family=EXCLUDED.family, result=EXCLUDED.result, severity=EXCLUDED.severity,
          rule_version=EXCLUDED.rule_version, explanation=EXCLUDED.explanation, invalidation=EXCLUDED.invalidation,
          evidence=EXCLUDED.evidence, evidence_hash=EXCLUDED.evidence_hash,
          evaluated_at=EXCLUDED.evaluated_at
    -- Only touch rows that actually differ, so the count means "drift repaired"
    -- rather than "rows seen".
    WHERE rule_evaluations_current.result IS DISTINCT FROM EXCLUDED.result
       OR rule_evaluations_current.evaluated_at IS DISTINCT FROM EXCLUDED.evaluated_at
    RETURNING 1
  )
  SELECT count(*) INTO fixed FROM upserted;
  RETURN fixed;
END;
$$ LANGUAGE plpgsql;
