-- 0011 — Universal verdict outcome tracking.
--
-- Why: until now the system only ever measured what it liked. Rejected candidates
-- were set dormant immediately, so the pipeline was structurally incapable of
-- learning whether a rejection was correct. A filter that rejects everything has
-- perfect precision and zero value; without the rejected cohort we cannot tell the
-- two apart.
--
-- This records an anchor the first time a candidate enters any verdict, then
-- measures forward returns from the price series we already collect. Nothing here
-- feeds a signal — it is measurement only, and it must never gate a decision.

CREATE TABLE IF NOT EXISTS candidate_verdicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES candidates(id),
  verdict         text NOT NULL,          -- action status at the moment of decision
  verdict_reason  text,                   -- canonical blocker / rejection reason
  reason_family   text,                   -- coarse bucket for cohort grouping
  decided_at      timestamptz NOT NULL DEFAULT now(),
  -- anchor market state (what we would have paid / what we walked away from)
  price_usd       numeric,
  liquidity_usd   numeric,
  market_cap_usd  numeric,
  pair_age_ms     bigint,
  core_safety     text,
  entry_proximity text,
  quality_rank    integer,
  entry_rank      integer,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- one anchor per candidate per verdict: the FIRST time it entered that verdict
  UNIQUE (candidate_id, verdict)
);

CREATE INDEX IF NOT EXISTS candidate_verdicts_verdict_idx ON candidate_verdicts (verdict, decided_at DESC);
CREATE INDEX IF NOT EXISTS candidate_verdicts_family_idx  ON candidate_verdicts (reason_family, decided_at DESC);
CREATE INDEX IF NOT EXISTS candidate_verdicts_cand_idx    ON candidate_verdicts (candidate_id);

CREATE TABLE IF NOT EXISTS verdict_outcomes (
  verdict_id      uuid NOT NULL REFERENCES candidate_verdicts(id) ON DELETE CASCADE,
  horizon         text NOT NULL,          -- m15 | h1 | h6 | h24
  measured_at     timestamptz NOT NULL DEFAULT now(),
  -- measured strictly inside [decided_at, decided_at + horizon]; never look-ahead
  ret             numeric,                -- terminal return vs anchor price
  mfe             numeric,                -- max favourable excursion in window
  mae             numeric,                -- max adverse excursion in window
  liquidity_loss  numeric,
  window_complete boolean NOT NULL DEFAULT false,
  observations    integer NOT NULL DEFAULT 0,
  -- UNOBSERVABLE means we stopped watching, not that nothing happened. Keeping the
  -- distinction is what stops a coverage hole from reading as a flat result.
  status          text NOT NULL DEFAULT 'MEASURED',
  PRIMARY KEY (verdict_id, horizon)
);

CREATE INDEX IF NOT EXISTS verdict_outcomes_horizon_idx ON verdict_outcomes (horizon, status);

-- Learning tail: how long we keep cheaply observing a candidate after a terminal
-- verdict purely so its outcome becomes measurable. Never used for signalling.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS observe_until timestamptz;
CREATE INDEX IF NOT EXISTS candidates_observe_until_idx ON candidates (observe_until)
  WHERE observe_until IS NOT NULL;
