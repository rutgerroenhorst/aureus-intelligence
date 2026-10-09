import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { AGE_BUCKETS, bucketCaseSql } from "@/lib/learning-stats";

export const dynamic = "force-dynamic";

interface TabLearning {
  tab_name: string;
  total_coins: number;
  winners: number;
  mega_winners: number;
  rugpulls: number;
  dead_coins: number;
  losers: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  avg_peak_return: number;
  last_tracked_at: string | null;
  last_checked_at: string | null;
  by_age_bucket: Record<string, { total: number; winners: number; win_rate: number; avg_return: number }>;
}

// Postgres returns NUMERIC/BIGINT as strings; the page calls .toFixed() on these, so hand it real numbers.
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : 0;
};
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

async function analyzeLearning() {
  const pool = getPool();

  const tabs = await pool.query(`
    SELECT tab_name,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome_status = 'winner') AS winners,
           COUNT(*) FILTER (WHERE outcome_status = 'winner' AND peak_return_multiplier >= 5) AS mega,
           COUNT(*) FILTER (WHERE outcome_status = 'rugpull') AS rugpulls,
           COUNT(*) FILTER (WHERE outcome_status = 'dead') AS dead,
           COUNT(*) FILTER (WHERE outcome_status = 'loser') AS losers,
           COUNT(*) FILTER (WHERE outcome_status = 'pending') AS pending,
           AVG(return_multiplier) FILTER (WHERE outcome_status <> 'pending') AS avg_return,
           AVG(peak_return_multiplier) FILTER (WHERE outcome_status <> 'pending') AS avg_peak,
           -- these columns are TIMESTAMP without a zone; the cast reads them in the session zone, which is how now() wrote them
           MAX(qualified_at)::timestamptz AS last_tracked, MAX(last_updated_at)::timestamptz AS last_checked
      FROM coin_qualifications
     GROUP BY tab_name
     ORDER BY COUNT(*) DESC`);

  const buckets = await pool.query(`
    SELECT tab_name, ${bucketCaseSql("age_minutes_at_qualification")} AS bucket,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome_status = 'winner') AS winners,
           AVG(return_multiplier) AS avg_return
      FROM coin_qualifications
     WHERE outcome_status <> 'pending'
     GROUP BY 1, 2`);

  const perTab: Record<string, TabLearning> = {};
  for (const r of tabs.rows) {
    const total = n(r.total), winners = n(r.winners), pending = n(r.pending);
    const graded = total - pending;
    perTab[r.tab_name] = {
      tab_name: r.tab_name,
      total_coins: total,
      winners,
      mega_winners: n(r.mega),
      rugpulls: n(r.rugpulls),
      dead_coins: n(r.dead),
      losers: n(r.losers),
      pending,
      // Rugpulls and dead coins are losses too: leaving them out would make every tab look better than it is.
      win_rate: graded > 0 ? (winners / graded) * 100 : 0,
      avg_return: n(r.avg_return),
      avg_peak_return: n(r.avg_peak),
      last_tracked_at: iso(r.last_tracked),
      last_checked_at: iso(r.last_checked),
      by_age_bucket: {},
    };
  }
  // Buckets in age order, not alphabetical.
  for (const b of AGE_BUCKETS) {
    for (const r of buckets.rows.filter((x) => x.bucket === b.name)) {
      const t = perTab[r.tab_name];
      if (!t) continue;
      const total = n(r.total), winners = n(r.winners);
      t.by_age_bucket[b.name] = { total, winners, win_rate: total > 0 ? (winners / total) * 100 : 0, avg_return: n(r.avg_return) };
    }
  }

  const suggestionRows = await pool.query(`
    SELECT tab_name, age_bucket_min, age_bucket_max, metric_name, current_threshold, suggested_threshold,
           suggested_direction, confidence_score, win_rate_with_suggestion, win_rate_without_suggestion,
           sample_size, status, created_at
      FROM filter_suggestions
     WHERE status NOT IN ('rejected', 'superseded')
     ORDER BY confidence_score DESC, created_at DESC
     LIMIT 20`);
  const suggestions = suggestionRows.rows.map((s) => ({
    ...s,
    age_bucket_min: n(s.age_bucket_min),
    age_bucket_max: n(s.age_bucket_max),
    current_threshold: n(s.current_threshold),
    suggested_threshold: n(s.suggested_threshold),
    confidence_score: n(s.confidence_score),
    win_rate_with_suggestion: n(s.win_rate_with_suggestion),
    win_rate_without_suggestion: n(s.win_rate_without_suggestion),
    sample_size: n(s.sample_size),
  }));

  const all = Object.values(perTab);
  const totalWinners = all.reduce((s, t) => s + t.winners, 0);
  const totalGraded = all.reduce((s, t) => s + t.total_coins - t.pending, 0);
  const lastTracked = all.map((t) => t.last_tracked_at).filter(Boolean).sort().pop() ?? null;
  const lastChecked = all.map((t) => t.last_checked_at).filter(Boolean).sort().pop() ?? null;

  return {
    learning_active: true,
    last_analyzed_at: new Date().toISOString(),
    per_tab: perTab,
    suggestions,
    analysis_summary: {
      total_tabs: all.length,
      total_coins_tracked: all.reduce((s, t) => s + t.total_coins, 0),
      total_graded: totalGraded,
      total_pending: all.reduce((s, t) => s + t.pending, 0),
      overall_win_rate: totalGraded > 0 ? (totalWinners / totalGraded) * 100 : 0,
      active_suggestions: suggestions.filter((s) => s.status === "pending_review").length,
      last_tracked_at: lastTracked,
      last_checked_at: lastChecked,
    },
    rules: {
      winner: "reached 2x its market cap at qualification at any check",
      rugpull: "fell below 0.5x, or its liquidity was pulled, without ever reaching 2x",
      loser: "still between 0.5x and 2x after the watch period",
      dead: "no pool left, or nothing traded",
      watch_hours: Number(process.env.LEARNING_HORIZON_HOURS ?? 6),
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await analyzeLearning(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[learning-analysis] Error:", err);
    return NextResponse.json({ error: "Failed to analyze learning", details: String(err) }, { status: 500 });
  }
}
