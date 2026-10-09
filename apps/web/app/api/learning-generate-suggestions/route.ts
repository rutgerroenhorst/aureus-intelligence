import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { AGE_BUCKETS, bestThreshold, bucketCaseSql, type Direction } from "@/lib/learning-stats";

export const dynamic = "force-dynamic";

// Each metric is tested as "a coin should have at least / at most this much at qualification". Price momentum has
// no obvious direction (chasing a pump vs buying a dip), so both are tried; the confidence correction pays for it.
const METRICS: Array<{ name: string; column: string; direction: Direction }> = [
  { name: "buy_ratio", column: "buy_ratio_at_qualification", direction: "higher" },
  { name: "holder_top10", column: "holder_top10_at_qualification", direction: "lower" },
  { name: "danger_score", column: "danger_score_at_qualification", direction: "lower" },
  { name: "volume_velocity", column: "volume_velocity_at_qualification", direction: "higher" },
  { name: "price_velocity", column: "price_velocity_at_qualification", direction: "higher" },
  { name: "price_velocity", column: "price_velocity_at_qualification", direction: "lower" },
  { name: "score", column: "score_at_qualification", direction: "higher" },
  { name: "liquidity_usd", column: "liquidity_usd_at_qualification", direction: "higher" },
];

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Looks for a cut-off on each metric that would have improved a tab's win rate within an age bucket.
 * Everything that is not a winner (loser, rugpull, dead) counts against it, and the comparison is against the
 * group's own win rate, i.e. "what you get with no extra filter". Suggestions are only proposals (pending_review).
 */
async function generateSuggestions() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT tab_name, ${bucketCaseSql("age_minutes_at_qualification")} AS bucket,
            (outcome_status = 'winner') AS win,
            ${[...new Set(METRICS.map((m) => m.column))].join(", ")}
       FROM coin_qualifications
      WHERE outcome_status IN ('winner', 'loser', 'rugpull', 'dead')`,
  );

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.tab_name}|${r.bucket}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const found: any[] = [];
  let considered = 0;
  for (const [key, members] of groups) {
    const [tab, bucketName] = key.split("|") as [string, string];
    const bucket = AGE_BUCKETS.find((b) => b.name === bucketName)!;
    for (const metric of METRICS) {
      considered++;
      const samples = members
        .filter((m) => m[metric.column] != null)
        .map((m) => ({ value: Number(m[metric.column]), win: Boolean(m.win) }));
      const s = bestThreshold(samples, metric.direction);
      const dir = metric.direction === "higher" ? "increase" : "decrease";
      const threshold = s ? round(s.threshold) : null;

      // Whatever was suggested earlier for this combination and is no longer the current answer is retired,
      // not deleted: the table is append-only for this role, and the history is worth keeping.
      await pool.query(
        `UPDATE filter_suggestions SET status = 'superseded', last_updated_at = now()
          WHERE tab_name = $1 AND age_bucket_min = $2 AND age_bucket_max = $3 AND metric_name = $4
            AND suggested_direction = $5 AND status = 'pending_review'
            AND ($6::numeric IS NULL OR suggested_threshold <> $6::numeric)`,
        [tab, bucket.minH, bucket.maxH, metric.name, dir, threshold],
      );
      // The columns are NUMERIC(10,4): a value outside that range would fail the insert, so skip it rather than lose the run.
      if (!s || Math.abs(s.threshold) >= 999_999 || Math.abs(s.currentEdge) >= 999_999) continue;

      await pool.query(
        `INSERT INTO filter_suggestions (
            tab_name, age_bucket_min, age_bucket_max, metric_name, current_threshold, suggested_threshold,
            suggested_direction, confidence_score, win_rate_with_suggestion, win_rate_without_suggestion,
            sample_size, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
         ON CONFLICT (tab_name, age_bucket_min, age_bucket_max, metric_name, suggested_threshold)
           DO UPDATE SET last_updated_at = now(), confidence_score = EXCLUDED.confidence_score,
                         suggested_direction = EXCLUDED.suggested_direction,
                         win_rate_with_suggestion = EXCLUDED.win_rate_with_suggestion,
                         win_rate_without_suggestion = EXCLUDED.win_rate_without_suggestion,
                         sample_size = EXCLUDED.sample_size, current_threshold = EXCLUDED.current_threshold,
                         status = CASE WHEN filter_suggestions.status = 'superseded' THEN 'pending_review' ELSE filter_suggestions.status END`,
        [
          tab, bucket.minH, bucket.maxH, metric.name, round(s.currentEdge), threshold, dir,
          Math.round(s.confidence), round(s.passRate, 1), round(s.baseRate, 1), s.passers,
        ],
      );
      found.push({
        tab_name: tab, age_bucket: bucket.name, metric_name: metric.name, direction: dir,
        suggested_threshold: threshold, win_rate_with: round(s.passRate, 1), win_rate_without: round(s.baseRate, 1),
        coins_passing: s.passers, coins_total: s.total, confidence: Math.round(s.confidence),
      });
    }
  }

  found.sort((a, b) => b.confidence - a.confidence);
  return {
    generated_count: found.length,
    suggestions: found.slice(0, 10),
    groups_checked: groups.size,
    combinations_checked: considered,
    graded_coins: rows.length,
    analysis_timestamp: new Date().toISOString(),
  };
}

export async function POST() {
  try {
    return NextResponse.json(await generateSuggestions());
  } catch (err) {
    console.error("[learning-generate-suggestions] Error:", err);
    return NextResponse.json({ error: "Failed to generate suggestions", details: String(err) }, { status: 500 });
  }
}
