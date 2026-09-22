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
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m_now,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '10 minutes' AND observed_at <= now() - interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m_prev,
        COALESCE((oe.intel->'holders'->>'count')::int, 0) as holder_count_now
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '30 minutes' 
        AND COALESCE(pr.market_cap_usd, 0) >= 5000
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 50
    `);
    
    const signals = result.rows.map((c: any) => {
      const mcap = c.market_cap_usd || 0;
      const liq = c.liquidity_usd || 0;
      const minutesOld = c.minutes_old || 0;
      const buys5mNow = c.buys_5m_now || 0;
      const buys5mPrev = c.buys_5m_prev || 0;
      const holderCount = c.holder_count_now || 0;
      
      const volumeTrend = buys5mNow > 0 && buys5mPrev > 0 
        ? ((buys5mNow - buys5mPrev) / buys5mPrev) * 100 
        : 0;
      
      const holdersPerMin = minutesOld > 0 ? holderCount / minutesOld : 0;
      
      const buySignal = buys5mNow >= 5 && volumeTrend > 0 && holdersPerMin > 1;
      const sellSignal = volumeTrend < -30 || (buySignal === false && buys5mNow < 2);
      
      return {
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        minutes_old: minutesOld,
        market_cap_usd: mcap,
        liquidity_usd: liq,
        buys_5m_now: buys5mNow,
        volume_trend: volumeTrend.toFixed(1),
        holder_count: holderCount,
        holders_per_min: holdersPerMin.toFixed(2),
        buy_signal: buySignal,
        sell_signal: sellSignal,
        signal_strength: buySignal ? "BUY 🟢" : sellSignal ? "SELL 🔴" : "HOLD ⚪",
        confidence: buySignal ? Math.min(100, (buys5mNow * 10 + volumeTrend + holdersPerMin * 20)) : 0,
      };
    });
    
    const buySignals = signals.filter((s: any) => s.buy_signal).sort((a: any, b: any) => b.confidence - a.confidence);
    const sellSignals = signals.filter((s: any) => s.sell_signal);
    
    return NextResponse.json({ 
      candidates: signals,
      buy_signals: buySignals.slice(0, 10),
      sell_signals: sellSignals.slice(0, 10),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Signals error:", err);
    return NextResponse.json({ 
      error: "Failed", 
      candidates: [], 
      buy_signals: [],
      sell_signals: []
    }, { status: 200 });
  }
}
