import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();

    const result = await pool.query(`
      SELECT
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE((SELECT COUNT(DISTINCT from_addr) FROM transaction_detail WHERE pool_id = c.pool_id AND is_buy = true AND observed_at > now() - interval '5 minutes'), 0)::int as unique_buyers_5m,
        COALESCE((SELECT COUNT(DISTINCT from_addr) FROM transaction_detail WHERE pool_id = c.pool_id AND is_buy = true AND observed_at > now() - interval '10 minutes'), 0)::int as unique_buyers_10m,
        COALESCE((SELECT SUM(CASE WHEN is_buy THEN 1 ELSE 0 END) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '1 minute'), 0)::int as buys_1m,
        COALESCE((SELECT SUM(CASE WHEN is_buy THEN 1 ELSE 0 END) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '5 minutes'), 0)::int as buys_5m
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      WHERE c.discovered_at > now() - interval '30 minutes'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const momentum = result.rows.map((c: any) => {
      const buys1m = c.buys_1m || 0;
      const buys5m = c.buys_5m || 0;
      const buyers5m = c.unique_buyers_5m || 0;
      const buyers10m = c.unique_buyers_10m || 0;
      const minutesOld = c.minutes_old || 0;
      const mcap = c.market_cap_usd || 0;

      // Momentum metrics
      const avgBuySize = buyers5m > 0 ? buys5m / buyers5m : 0;
      const buyerGrowth = buyers10m > 0 ? ((buyers5m - (buyers10m - buyers5m)) / Math.max(1, buyers10m - buyers5m)) * 100 : 0;
      const velocityRatio = buys1m > 0 ? (buys5m / (buys1m * 5)) : 0; // Comparing 1m rate to 5m average

      // Momentum phases
      let phase = "accumulating";
      if (buys1m >= 5 && velocityRatio > 1.5) phase = "acceleration";
      else if (buys1m >= 10) phase = "explosion";
      else if (buys1m < 1) phase = "pause";

      // Confidence score
      let confidence = 0;
      if (buyers5m >= 20) confidence += 30;
      else if (buyers5m >= 10) confidence += 20;
      else if (buyers5m >= 5) confidence += 10;

      if (buyerGrowth > 50) confidence += 25;
      else if (buyerGrowth > 0) confidence += 15;

      if (avgBuySize > 0.5) confidence += 20;
      else if (avgBuySize > 0.2) confidence += 10;

      const strength = confidence >= 70 ? "elite" : confidence >= 50 ? "strong" : confidence >= 30 ? "moderate" : "weak";

      return {
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        minutes_old: minutesOld,
        market_cap_usd: mcap,
        buys_1m: buys1m,
        buys_5m: buys5m,
        unique_buyers_5m: buyers5m,
        avg_buy_size: parseFloat(avgBuySize.toFixed(3)),
        buyer_growth_pct: parseFloat(buyerGrowth.toFixed(1)),
        velocity_ratio: parseFloat(velocityRatio.toFixed(2)),
        phase,
        strength,
        confidence: Math.min(100, confidence),
      };
    });

    const elite = momentum.filter((m: any) => m.strength === "elite");
    const strong = momentum.filter((m: any) => m.strength === "strong");

    return NextResponse.json({
      candidates: momentum.sort((a: any, b: any) => b.confidence - a.confidence),
      elite_momentum: elite,
      strong_momentum: strong,
      total: momentum.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Momentum error:", err);
    return NextResponse.json({
      candidates: [],
      elite_momentum: [],
      strong_momentum: [],
      total: 0,
    }, { status: 200 });
  }
}
