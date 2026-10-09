import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

interface TabLearning {
  tab_name: string;
  total_coins: number;
  winners: number;
  mega_winners: number;
  rugpulls: number;
  dead_coins: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  by_age_bucket: Record<string, any>;
}

// Analyze learning per tab and age bucket
async function analyzeLearning(): Promise<Record<string, any>> {
  const pool = getPool();

  // Get all tabs with their stats
  const tabsResult = await pool.query(`
    SELECT
      tab_name,
      COUNT(*) as total,
      SUM(CASE WHEN outcome_status = 'winner' THEN 1 ELSE 0 END) as winners,
      SUM(CASE WHEN return_multiplier >= 5 AND outcome_status = 'winner' THEN 1 ELSE 0 END) as mega_winners,
      SUM(CASE WHEN outcome_status = 'rugpull' THEN 1 ELSE 0 END) as rugpulls,
      SUM(CASE WHEN outcome_status = 'dead' THEN 1 ELSE 0 END) as dead_coins,
      SUM(CASE WHEN outcome_status = 'pending' THEN 1 ELSE 0 END) as pending,
      AVG(CASE WHEN outcome_status IN ('winner', 'loser') THEN return_multiplier ELSE NULL END) as avg_return,
      AVG(peak_return_multiplier) as avg_peak_return
    FROM coin_qualifications
    GROUP BY tab_name
    ORDER BY total DESC
  `);

  const tabLearnings: Record<string, TabLearning> = {};

  for (const row of tabsResult.rows) {
    const total = parseInt(row.total);
    const winners = parseInt(row.winners) || 0;
    const losers = total - winners - (parseInt(row.pending) || 0);
    const winRate = losers > 0 ? (winners / (winners + losers)) * 100 : 0;

    // Get age bucket breakdown
    const ageBucketsResult = await pool.query(
      `
      SELECT
        CASE
          WHEN age_days_at_qualification < 1 THEN '0-1d'
          WHEN age_days_at_qualification < 3 THEN '1-3d'
          WHEN age_days_at_qualification < 8 THEN '3-8d'
          WHEN age_days_at_qualification < 30 THEN '8-30d'
          ELSE '30d+'
        END as age_bucket,
        COUNT(*) as count,
        SUM(CASE WHEN outcome_status = 'winner' THEN 1 ELSE 0 END) as bucket_winners,
        AVG(return_multiplier) as bucket_avg_return
      FROM coin_qualifications
      WHERE tab_name = $1 AND outcome_status IN ('winner', 'loser')
      GROUP BY age_bucket
      ORDER BY age_bucket
      `,
      [row.tab_name]
    );

    const by_age_bucket: Record<string, any> = {};
    for (const ageBucket of ageBucketsResult.rows) {
      const bucket_total = parseInt(ageBucket.count);
      const bucket_winners = parseInt(ageBucket.bucket_winners) || 0;
      by_age_bucket[ageBucket.age_bucket] = {
        total: bucket_total,
        winners: bucket_winners,
        win_rate: bucket_total > 0 ? (bucket_winners / bucket_total) * 100 : 0,
        avg_return: parseFloat(ageBucket.bucket_avg_return) || 0
      };
    }

    tabLearnings[row.tab_name] = {
      tab_name: row.tab_name,
      total_coins: total,
      winners: winners,
      mega_winners: parseInt(row.mega_winners) || 0,
      rugpulls: parseInt(row.rugpulls) || 0,
      dead_coins: parseInt(row.dead_coins) || 0,
      pending: parseInt(row.pending) || 0,
      win_rate: winRate,
      avg_return: parseFloat(row.avg_return) || 0,
      by_age_bucket
    };
  }

  // Get recent filter suggestions
  const suggestionsResult = await pool.query(`
    SELECT
      tab_name,
      metric_name,
      current_threshold,
      suggested_threshold,
      suggested_direction,
      confidence_score,
      win_rate_with_suggestion,
      win_rate_without_suggestion,
      sample_size,
      status,
      created_at
    FROM filter_suggestions
    WHERE status != 'rejected'
    ORDER BY confidence_score DESC, created_at DESC
    LIMIT 20
  `);

  return {
    learning_active: true,
    last_analyzed_at: new Date().toISOString(),
    per_tab: tabLearnings,
    suggestions: suggestionsResult.rows,
    analysis_summary: {
      total_tabs: Object.keys(tabLearnings).length,
      total_coins_tracked: Object.values(tabLearnings).reduce((sum: number, t: TabLearning) => sum + t.total_coins, 0),
      overall_win_rate: calculateOverallWinRate(tabLearnings),
      active_suggestions: suggestionsResult.rows.filter((s: any) => s.status === 'pending_review').length
    }
  };
}

function calculateOverallWinRate(tabLearnings: Record<string, TabLearning>): number {
  let totalWinners = 0;
  let totalCoins = 0;

  for (const tab of Object.values(tabLearnings)) {
    totalWinners += tab.winners;
    totalCoins += tab.total_coins - tab.pending;
  }

  return totalCoins > 0 ? (totalWinners / totalCoins) * 100 : 0;
}

export async function GET(request: Request) {
  try {
    const analysis = await analyzeLearning();
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[learning-analysis] Error:", err);
    return NextResponse.json(
      { error: "Failed to analyze learning", details: String(err) },
      { status: 500 }
    );
  }
}
