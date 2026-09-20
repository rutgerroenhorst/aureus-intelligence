/**
 * Universal verdict outcome tracking.
 *
 * The pipeline used to measure only the candidates it liked. Everything it
 * rejected went dormant immediately, so we could never answer the question that
 * actually decides whether this system is worth anything: *were the rejections
 * right?* A filter that rejects all 240 candidates has perfect precision and zero
 * value, and without the rejected cohort those two cases look identical.
 *
 * So: record an anchor the first time a candidate enters any verdict, keep
 * observing it cheaply for a learning window, and measure forward returns from the
 * price series we already collect.
 *
 * This is measurement only. Nothing here may ever feed a signal, relax a gate, or
 * influence a status — it exists to grade the system, not to run it.
 */
import type { Pool } from "pg";
import { measureOutcome, type OutcomeSeriesPoint } from "@aureus/outcome-engine";

/** Horizons we grade every verdict on. */
export const VERDICT_HORIZONS = ["m15", "h1", "h6", "h24"] as const;
export type VerdictHorizon = (typeof VERDICT_HORIZONS)[number];

export const HORIZON_MS: Record<VerdictHorizon, number> = {
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  h6: 6 * 60 * 60_000,
  h24: 24 * 60 * 60_000,
};

/** How long we keep observing a candidate after a terminal verdict, to grade it. */
export const LEARNING_TAIL_MS = 24 * 60 * 60_000;
/** Cheap cadence during the learning tail — enough to measure, cheap enough to ignore. */
export const LEARNING_TAIL_CADENCE_MS = 10 * 60_000;

const TERMINAL = new Set(["REJECTED", "INVALIDATED", "EXPIRED", "TOO_EXTENDED"]);

/**
 * Group a blocker into a coarse family so cohorts are comparable.
 *
 * Matched against the DISTINCTIVE PHRASE each blocker is emitted with, in the same
 * fixed priority order canonicalBlocker() uses — never against a bare keyword.
 * A bare keyword match is how "core safety incomplete — missing: liquidity_drain"
 * ends up graded as a liquidity drain: the word appears in the *dataset name*, not
 * as a verdict. Order and phrase specificity are both load-bearing here.
 */
/**
 * Covers BOTH blocker vocabularies, because two engines emit them:
 *   - fundamentalWatch()  in packages/watch-engine/src/index.ts (the persisted one)
 *   - canonicalBlocker()  in apps/web/lib/decisionRules.ts (the displayed one)
 * Keep this exhaustive against both; an unmapped reason silently collapses a whole
 * cohort into "other" and the grading for it becomes meaningless.
 */
const REASON_FAMILIES: Array<[RegExp, string]> = [
  // Structural verdicts first — these NAME a dataset and would otherwise be
  // captured by the dataset-keyword patterns further down.
  [/core safety (incomplete|pending|not yet complete)/, "core_safety_incomplete"],
  [/critical safety fail|hard safety/, "safety_fail"],
  [/pool liquidity removed|pool is dead/, "pool_gone"],
  [/market frozen|no new trades/, "frozen_market"],
  [/stale market data/, "stale_data"],
  [/sellability|sell route|insufficient liquidity to sell/, "sellability"],
  [/liquidity drain|liquidity contracting/, "liquidity_drain"],
  [/insider concentration/, "insider_concentration"],
  [/holder concentration/, "holder_concentration"],
  [/authorities not renounced|mint authority|freeze authority/, "authority_active"],
  [/liquidity below minimum|exit not feasible|below \$|below the \$/, "too_illiquid"],
  [/entry structure|no structure|consolidation/, "no_structure"],
  [/overextended|chase/, "overextended"],
  [/slippage/, "slippage"],
  [/confirmation scans/, "awaiting_confirmation"],
  [/entry levels not usable/, "plan_unusable"],
];

export function reasonFamily(reason: string | null | undefined): string {
  const r = (reason ?? "").toLowerCase().trim();
  if (!r) return "unknown";
  for (const [re, family] of REASON_FAMILIES) if (re.test(r)) return family;
  return "other";
}

export interface VerdictAnchor {
  candidateId: string;
  verdict: string;
  reason: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  pairAgeMs: number | null;
  coreSafety: string | null;
  entryProximity: string | null;
  qualityRank: number | null;
  entryRank: number | null;
  evidence?: Record<string, unknown>;
}

/**
 * Coarse top-10 concentration band, recorded on every verdict so the grading pass can
 * answer a question n=10 cannot: does the 30–55% band actually underperform?
 *
 * Published trader practice puts the red flag at 20–30%. Our hard gate is 55%. In the
 * graduated universe the observed median is 21% and p75 is 30%, so a 30% gate now looks
 * defensible where it would have rejected ~85% of the old launch firehose. That is a
 * direction, not a number — fitting a threshold to ten coins is exactly the mistake that
 * made the original cross-sectional study unreliable. Band it, grade it, then decide.
 */
export function concentrationBand(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "unknown";
  if (pct < 0.10) return "under_10";
  if (pct < 0.20) return "10_20";
  if (pct < 0.30) return "20_30";
  if (pct < 0.55) return "30_55";   // passes today; industry would flag it
  if (pct < 0.75) return "55_75";
  return "over_75";
}

/**
 * Record the first entry into a verdict. Idempotent: the UNIQUE constraint keeps
 * the ORIGINAL anchor, so a candidate that flaps in and out of REJECTED is still
 * graded from the moment we first walked away from it.
 */
export async function recordVerdict(pool: Pool, a: VerdictAnchor, nowMs: number): Promise<boolean> {
  if (a.priceUsd == null || a.priceUsd <= 0) return false; // cannot grade without an anchor price
  const res = await pool.query(
    `INSERT INTO candidate_verdicts
       (candidate_id, verdict, verdict_reason, reason_family, decided_at, price_usd, liquidity_usd,
        market_cap_usd, pair_age_ms, core_safety, entry_proximity, quality_rank, entry_rank, evidence)
     VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (candidate_id, verdict) DO NOTHING
     RETURNING id`,
    [a.candidateId, a.verdict, a.reason, reasonFamily(a.reason), nowMs, a.priceUsd, a.liquidityUsd,
     a.marketCapUsd, a.pairAgeMs, a.coreSafety, a.entryProximity, a.qualityRank, a.entryRank,
     JSON.stringify(a.evidence ?? {})],
  );
  const inserted = (res.rowCount ?? 0) > 0;
  // Terminal verdicts get a learning tail so the outcome is observable at all.
  if (inserted && TERMINAL.has(a.verdict)) {
    await pool.query(
      `UPDATE candidates SET observe_until = GREATEST(COALESCE(observe_until, to_timestamp(0)), to_timestamp($2/1000.0))
       WHERE id=$1`,
      [a.candidateId, nowMs + LEARNING_TAIL_MS],
    );
  }
  return inserted;
}

/** True while a candidate is inside its post-verdict learning window. */
export function inLearningTail(observeUntil: string | Date | null, nowMs: number): boolean {
  if (!observeUntil) return false;
  const t = observeUntil instanceof Date ? observeUntil.getTime() : Date.parse(observeUntil);
  return Number.isFinite(t) && t > nowMs;
}

interface DueRow {
  id: string; candidate_id: string; pool_id: string | null;
  decided_ms: string; price_usd: string | null; liquidity_usd: string | null;
}

/**
 * Measure every verdict/horizon pair whose window has closed and that we have not
 * graded yet. Uses the outcome-engine's anti-look-ahead measurement: only points
 * inside [decidedAt, decidedAt+horizon] are ever considered.
 */
export async function measureVerdictOutcomes(pool: Pool, nowMs: number, limit = 200): Promise<{ measured: number; unobservable: number }> {
  let measured = 0;
  let unobservable = 0;

  for (const horizon of VERDICT_HORIZONS) {
    const offset = HORIZON_MS[horizon];
    const due = await pool.query<DueRow>(
      // Explicit ::numeric casts: two untyped placeholders in `$2 - $3` leave
      // Postgres unable to choose an operator ("operator is not unique"), and the
      // whole grading pass fails.
      `SELECT v.id, v.candidate_id, c.pool_id,
              extract(epoch from v.decided_at)*1000 AS decided_ms,
              v.price_usd, v.liquidity_usd
         FROM candidate_verdicts v
         JOIN candidates c ON c.id = v.candidate_id
        WHERE v.decided_at <= to_timestamp(($2::numeric - $3::numeric)/1000.0)
          AND NOT EXISTS (
            SELECT 1 FROM verdict_outcomes o WHERE o.verdict_id = v.id AND o.horizon = $1
          )
        ORDER BY v.decided_at
        LIMIT $4`,
      [horizon, nowMs, offset, limit],
    );

    for (const row of due.rows) {
      const anchorAtMs = Number(row.decided_ms);
      const anchorPrice = row.price_usd != null ? Number(row.price_usd) : null;
      if (!row.pool_id || anchorPrice == null || anchorPrice <= 0) {
        await pool.query(
          `INSERT INTO verdict_outcomes (verdict_id, horizon, status, window_complete)
           VALUES ($1,$2,'UNOBSERVABLE',true) ON CONFLICT DO NOTHING`,
          [row.id, horizon],
        );
        unobservable++;
        continue;
      }

      const series = await pool.query<{ t: string; p: string; l: string | null }>(
        `SELECT extract(epoch from pr.observed_at)*1000 AS t, pr.price_usd AS p,
                (SELECT ls.liquidity_usd FROM liquidity_snapshots ls
                  WHERE ls.pool_id = pr.pool_id AND ls.observed_at <= pr.observed_at
                  ORDER BY ls.observed_at DESC LIMIT 1) AS l
           FROM prices pr
          WHERE pr.pool_id = $1
            AND pr.observed_at >= to_timestamp($2/1000.0)
            AND pr.observed_at <= to_timestamp($3/1000.0)
          ORDER BY pr.observed_at`,
        [row.pool_id, anchorAtMs, anchorAtMs + offset],
      );

      const points: OutcomeSeriesPoint[] = series.rows.map((r) => ({
        atMs: Number(r.t), priceUsd: Number(r.p),
        liquidityUsd: r.l != null ? Number(r.l) : undefined,
      }));

      // Fewer than 2 points inside the window means we stopped watching, NOT that
      // the price stayed flat. Recording that as a 0% return would manufacture a
      // result out of a coverage hole.
      if (points.length < 2) {
        await pool.query(
          `INSERT INTO verdict_outcomes (verdict_id, horizon, status, window_complete, observations)
           VALUES ($1,$2,'UNOBSERVABLE',true,$3) ON CONFLICT DO NOTHING`,
          [row.id, horizon, points.length],
        );
        unobservable++;
        continue;
      }

      const m = measureOutcome({
        anchorAtMs, horizon: horizon as never, nowMs,
        series: points, simEntryPrice: anchorPrice,
      });

      await pool.query(
        `INSERT INTO verdict_outcomes
           (verdict_id, horizon, ret, mfe, mae, liquidity_loss, window_complete, observations, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MEASURED')
         ON CONFLICT (verdict_id, horizon) DO NOTHING`,
        [row.id, horizon, m.ret, m.mfe, m.mae, m.liquidityLossPct, m.windowComplete, points.length],
      );
      measured++;
    }
  }
  return { measured, unobservable };
}
