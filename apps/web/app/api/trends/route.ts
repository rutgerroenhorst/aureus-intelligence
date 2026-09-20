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
        COALESCE(pr.price_usd, 0) as price_usd,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as sells_5m,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '10 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_10m,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((oe.intel->'holders'->>'count')::int, 0) as holder_count
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      WHERE c.discovered_at > now() - interval '30 minutes'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const analyzed = result.rows.map((c: any) => {
      const buys5m = c.buys_5m || 0;
      const sells5m = c.sells_5m || 0;
      const buys10m = c.buys_10m || 0;
      const minutesOld = c.minutes_old || 0;
      const holderCount = c.holder_count || 0;

      // Momentum trend
      const volumeTrend = buys10m > buys5m ? "bullish" : buys10m < buys5m ? "bearish" : "neutral";

      // Velocity acceleration
      const buyVelocity = minutesOld > 0 ? buys5m / Math.max(1, minutesOld) : 0;
      const acceleration = buyVelocity > 2 ? "spike" : buyVelocity > 1 ? "strong" : buyVelocity > 0.3 ? "moderate" : "slow";

      // Holder momentum
      const holderVelocity = minutesOld > 0 ? holderCount / minutesOld : 0;
      const holderTrend = holderVelocity > 10 ? "explosive" : holderVelocity > 5 ? "strong" : holderVelocity > 1 ? "steady" : "stalled";

      // Sell pressure check
      const sellPressure = sells5m > 0 ? (sells5m / (buys5m + sells5m)) * 100 : 0;
      const pressureLevel = sellPressure > 40 ? "high" : sellPressure > 20 ? "moderate" : "low";

      const trendScore =
        (volumeTrend === "bullish" ? 30 : volumeTrend === "bearish" ? -30 : 0) +
        (acceleration === "spike" ? 25 : acceleration === "strong" ? 15 : acceleration === "moderate" ? 5 : -10) +
        (holderTrend === "explosive" ? 25 : holderTrend === "strong" ? 15 : holderTrend === "steady" ? 5 : -15) +
        (pressureLevel === "low" ? 20 : pressureLevel === "moderate" ? 0 : -20);

      const signal = trendScore >= 60 ? "STRONG_REVERSAL" : trendScore >= 30 ? "BULLISH" : trendScore <= -30 ? "BEARISH" : "NEUTRAL";

      return {
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        minutes_old: minutesOld,
        market_cap_usd: c.market_cap_usd,
        buys_5m: buys5m,
        buys_10m: buys10m,
        sells_5m: sells5m,
        holder_count: holderCount,
        volume_trend: volumeTrend,
        acceleration,
        holder_trend: holderTrend,
        sell_pressure: parseFloat(sellPressure.toFixed(1)),
        trend_score: trendScore,
        signal,
        confidence: Math.min(100, Math.abs(trendScore)),
      };
    });

    const reversals = analyzed.filter((c: any) => c.signal === "STRONG_REVERSAL");
    const bullish = analyzed.filter((c: any) => c.signal === "BULLISH");

    return NextResponse.json({
      candidates: analyzed.sort((a: any, b: any) => b.trend_score - a.trend_score),
      reversals,
      bullish,
      total: analyzed.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Trends error:", err);
    return NextResponse.json({
      candidates: [],
      reversals: [],
      bullish: [],
      total: 0,
    }, { status: 200 });
  }
}
