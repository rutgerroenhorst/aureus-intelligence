import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

// Calculate holder velocity and growth signals (without RPC for now, use existing data)
function calculateHolderVelocity(
  poolId: string,
  holderTop10: number,
  minutesOld: number
): { velocity: number; trend: string; risk: number } {
  const daysOld = minutesOld / (60 * 24);

  // HOLDER VELOCITY INDICATORS (inferred from existing metrics)
  // In a real system, we'd track snapshots over time via Solana RPC

  // For now: infer velocity from top10% concentration + age
  // High quality coins show: top10% decreasing as more holders join

  let velocity = 0; // 0-100 scale: how fast are holders growing?
  let trend = "stable";
  let risk = 50; // 0-100: risk from whale concentration

  // INFERENCE RULES (based on research findings):
  // Slopcannon winners: top10 < 3%, age 3-8d, stable/decreasing top10
  // Dead coins: top10 > 10%, age 3-8d, stagnant holders

  if (holderTop10 < 2) {
    velocity = 75; // Strong retail distribution = likely accumulating
    trend = "growing";
    risk = 15; // Very low whale concentration
  } else if (holderTop10 < 5) {
    velocity = 50; // Moderate distribution
    trend = "stable";
    risk = 35;
  } else if (holderTop10 < 10) {
    velocity = 25; // Poor distribution
    trend = "concerning";
    risk = 60;
  } else {
    velocity = 10; // Very concentrated
    trend = "dangerous";
    risk = 85; // High whale concentration
  }

  // Age adjustment: coins 5-8d old with high velocity are about to explode
  if (daysOld >= 5 && daysOld <= 8 && velocity >= 50) {
    velocity += 25; // Boost score for peak accumulation window
  }

  return { velocity, trend, risk };
}

export async function GET() {
  try {
    const pool = getPool();

    const result = await pool.query(`
      SELECT
        c.id,
        t.symbol_label as symbol,
        c.pool_id,
        c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10,
        COALESCE((SELECT COUNT(*) FROM (
          SELECT holder_count
          FROM candidates
          WHERE discovered_at > now() - interval '7 days'
          GROUP BY holder_count
        ) sub), 50)::int as avg_holder_count
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const analytics = result.rows.map((row: any) => {
      const { velocity, trend, risk } = calculateHolderVelocity(
        row.pool_id,
        row.holder_top10 || 50,
        row.minutes_old
      );

      return {
        mint: row.pool_id,
        symbol: row.symbol,
        holderTop10: row.holder_top10,
        velocity,
        trend,
        concentrationRisk: risk,
        minutesOld: row.minutes_old,
        ageInDays: (row.minutes_old / (60 * 24)).toFixed(1),
        verdict: trend === "growing" ? "✅ Accumulating" :
                 trend === "dangerous" ? "🔴 Whale Concentration" :
                 "⚠️ Monitoring"
      };
    });

    return NextResponse.json({
      analytics,
      summary: {
        total: analytics.length,
        accumulating: analytics.filter((a: any) => a.trend === "growing").length,
        dangerous: analytics.filter((a: any) => a.trend === "dangerous").length
      },
      timestamp: new Date().toISOString()
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Holder analytics error:", err);
    return NextResponse.json({
      analytics: [],
      error: "Failed to compute holder analytics",
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
}
