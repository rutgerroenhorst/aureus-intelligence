import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

// Analyzes winner vs loser patterns and generates filter suggestions
async function generateSuggestions() {
  const pool = getPool();

  const suggestions: any[] = [];

  // Get all tabs with sufficient historical data
  const tabsWithData = await pool.query(`
    SELECT DISTINCT tab_name
    FROM coin_qualifications
    WHERE outcome_status IN ('winner', 'loser')
    GROUP BY tab_name
    HAVING COUNT(*) >= 10
  `);

  for (const { tab_name } of tabsWithData.rows) {
    // Analyze each age bucket separately
    const ageBuckets = [
      { name: "0-1d", min: 0, max: 1 },
      { name: "1-3d", min: 1, max: 3 },
      { name: "3-8d", min: 3, max: 8 },
      { name: "8-30d", min: 8, max: 30 },
      { name: "30d+", min: 30, max: 999 },
    ];

    for (const bucket of ageBuckets) {
      // Get winners and losers in this bucket
      const bucketsResult = await pool.query(
        `
        SELECT
          outcome_status,
          buy_ratio_at_qualification,
          holder_top10_at_qualification,
          danger_score_at_qualification,
          volume_velocity_at_qualification,
          price_velocity_at_qualification
        FROM coin_qualifications
        WHERE tab_name = $1
          AND age_days_at_qualification >= $2
          AND age_days_at_qualification < $3
          AND outcome_status IN ('winner', 'loser')
        `,
        [tab_name, bucket.min, bucket.max]
      );

      if (bucketsResult.rows.length < 10) continue; // Not enough data

      const winners = bucketsResult.rows.filter(
        (r: any) => r.outcome_status === "winner"
      );
      const losers = bucketsResult.rows.filter(
        (r: any) => r.outcome_status === "loser"
      );

      if (winners.length < 5 || losers.length < 5) continue;

      // Analyze each metric
      const metrics = [
        {
          name: "buy_ratio_at_qualification",
          field: "buy_ratio_at_qualification",
          direction: "higher",
        },
        {
          name: "holder_top10_at_qualification",
          field: "holder_top10_at_qualification",
          direction: "lower",
        },
        {
          name: "danger_score_at_qualification",
          field: "danger_score_at_qualification",
          direction: "lower",
        },
        {
          name: "volume_velocity_at_qualification",
          field: "volume_velocity_at_qualification",
          direction: "higher",
        },
      ];

      for (const metric of metrics) {
        const winnerValues = winners
          .map((w: any) => parseFloat(w[metric.field]))
          .filter((v: number) => !isNaN(v));
        const loserValues = losers
          .map((l: any) => parseFloat(l[metric.field]))
          .filter((v: number) => !isNaN(v));

        if (winnerValues.length === 0 || loserValues.length === 0) continue;

        const winnerAvg =
          winnerValues.reduce((a: number, b: number) => a + b, 0) /
          winnerValues.length;
        const loserAvg =
          loserValues.reduce((a: number, b: number) => a + b, 0) /
          loserValues.length;

        // Calculate optimal threshold (midpoint between winner and loser average)
        const optimalThreshold = (winnerAvg + loserAvg) / 2;
        const currentThreshold =
          metric.name === "buy_ratio_at_qualification" ? 0.6 :
          metric.name === "holder_top10_at_qualification" ? 10 :
          metric.name === "danger_score_at_qualification" ? 40 :
          1.5;

        // Estimate win rate improvement
        const winnersAboveThreshold = winnerValues.filter((v: number) =>
          metric.direction === "higher" ? v > optimalThreshold : v < optimalThreshold
        ).length;
        const losersAboveThreshold = loserValues.filter((v: number) =>
          metric.direction === "higher" ? v > optimalThreshold : v < optimalThreshold
        ).length;

        const winRateWithSuggestion =
          winnersAboveThreshold / Math.max(1, winnersAboveThreshold + losersAboveThreshold);

        const winnersAboveCurrentThreshold = winnerValues.filter((v: number) =>
          metric.direction === "higher" ? v > currentThreshold : v < currentThreshold
        ).length;
        const losersAboveCurrentThreshold = loserValues.filter((v: number) =>
          metric.direction === "higher" ? v > currentThreshold : v < currentThreshold
        ).length;

        const winRateWithoutSuggestion =
          winnersAboveCurrentThreshold /
          Math.max(1, winnersAboveCurrentThreshold + losersAboveCurrentThreshold);

        // Only suggest if improvement is significant (>10%) and confidence is high
        const improvement = winRateWithSuggestion - winRateWithoutSuggestion;
        const confidence = Math.min(
          100,
          (winnersAboveThreshold / winners.length) * 100
        );

        if (improvement > 0.1 && confidence > 50) {
          suggestions.push({
            tab_name,
            age_bucket_min: bucket.min,
            age_bucket_max: bucket.max,
            metric_name: metric.name,
            current_threshold: currentThreshold,
            suggested_threshold: optimalThreshold,
            suggested_direction: metric.direction === "higher" ? "increase" : "decrease",
            confidence_score: Math.round(confidence),
            win_rate_with_suggestion: Math.round(winRateWithSuggestion * 100),
            win_rate_without_suggestion: Math.round(winRateWithoutSuggestion * 100),
            sample_size: winnersAboveThreshold + losersAboveThreshold,
          });
        }
      }
    }
  }

  // Store top suggestions (dedup by tab + bucket + metric)
  for (const suggestion of suggestions.slice(0, 20)) {
    await pool.query(
      `
      INSERT INTO filter_suggestions (
        tab_name, age_bucket_min, age_bucket_max, metric_name,
        current_threshold, suggested_threshold, suggested_direction,
        confidence_score, win_rate_with_suggestion, win_rate_without_suggestion,
        sample_size, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
      ON CONFLICT (tab_name, age_bucket_min, age_bucket_max, metric_name, suggested_threshold)
        DO UPDATE SET
          last_updated_at = now(),
          confidence_score = EXCLUDED.confidence_score,
          sample_size = EXCLUDED.sample_size
      `,
      [
        suggestion.tab_name,
        suggestion.age_bucket_min,
        suggestion.age_bucket_max,
        suggestion.metric_name,
        suggestion.current_threshold,
        suggestion.suggested_threshold,
        suggestion.suggested_direction,
        suggestion.confidence_score,
        suggestion.win_rate_with_suggestion,
        suggestion.win_rate_without_suggestion,
        suggestion.sample_size,
      ]
    );
  }

  return {
    generated_count: suggestions.length,
    suggestions: suggestions.slice(0, 10),
    analysis_timestamp: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  try {
    const result = await generateSuggestions();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[learning-generate-suggestions] Error:", err);
    return NextResponse.json(
      { error: "Failed to generate suggestions", details: String(err) },
      { status: 500 }
    );
  }
}
