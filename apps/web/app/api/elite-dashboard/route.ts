import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function getEliteDashboard() {
  const pool = getPool();

  try {
    // Get top opportunities
    const topOps = await pool.query(`
      SELECT 
        c.mint, c.symbol,
        cr.overall_risk_score, cr.risk_rating,
        sc.recommendation, sc.consensus_confidence,
        ews.pump_probability_2h
      FROM coin_qualifications c
      LEFT JOIN coin_risk_analysis cr ON cr.mint = c.mint
      LEFT JOIN signal_consensus sc ON sc.mint = c.mint
      LEFT JOIN early_warning_signals ews ON ews.mint = c.mint AND ews.is_active = true
      WHERE cr.tradeable = true
      ORDER BY sc.recommendation DESC, sc.consensus_confidence DESC
      LIMIT 10
    `);

    // Get whale activity
    const whaleActivity = await pool.query(`
      SELECT COUNT(*) as tracked_whales,
             AVG(win_rate) as avg_win_rate
      FROM whale_wallets
      WHERE is_active = true
    `);

    // Get risk distribution
    const riskDist = await pool.query(`
      SELECT risk_rating, COUNT(*) as count
      FROM coin_risk_analysis
      GROUP BY risk_rating
    `);

    // Get early warnings
    const warnings = await pool.query(`
      SELECT COUNT(*) as active_warnings,
             AVG(pump_probability_2h) as avg_pump_prob
      FROM early_warning_signals
      WHERE is_active = true
    `);

    // System stats
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM coin_qualifications) as total_coins_tracked,
        (SELECT COUNT(*) FROM whale_wallets WHERE is_active) as tracked_whales,
        (SELECT COUNT(*) FROM coin_risk_analysis WHERE tradeable) as tradeable_coins,
        (SELECT COUNT(*) FROM early_warning_signals WHERE is_active) as active_warnings
    `);

    return {
      timestamp: new Date().toISOString(),
      system_stats: stats.rows[0],
      whale_stats: whaleActivity.rows[0],
      warning_stats: warnings.rows[0],
      top_opportunities: topOps.rows,
      risk_distribution: riskDist.rows,
      status: "elite_system_online",
    };
  } catch (err) {
    console.error("[elite-dashboard] Error:", err);
    throw err;
  }
}

export async function GET() {
  try {
    const dashboard = await getEliteDashboard();
    return NextResponse.json(dashboard);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
