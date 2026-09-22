import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      WITH txn_analysis AS (
        SELECT 
          pool_id,
          COUNT(*) as total_txns,
          COUNT(DISTINCT buyer) as unique_buyers,
          COUNT(CASE WHEN COALESCE(amount, 1) < 0.1 THEN 1 END)::float / NULLIF(COUNT(*), 0) as micro_trade_ratio
        FROM transaction_detail
        WHERE observed_at > now() - interval '30 minutes'
        GROUP BY pool_id
      )
      SELECT 
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE(pr.market_cap_usd, 0)::numeric / NULLIF(COALESCE(lq.liquidity_usd, 1), 0) as liq_ratio,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE pool_id = c.pool_id), 0)::int as txn_count,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE pool_id = c.pool_id), 0)::int as holder_count,
        COALESCE(ta.micro_trade_ratio, 0)::float as micro_trade_ratio,
        COALESCE(ta.unique_buyers, 1)::int as unique_buyers,
        COALESCE(ta.total_txns, 1)::int as total_txns
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      LEFT JOIN txn_analysis ta ON ta.pool_id = c.pool_id
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 150
    `);
    
    const signals = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld;
        const txnCount = Number(c.txn_count || 0);
        const holderCount = Number(c.holder_count || 0);
        const microTradeRatio = Number(c.micro_trade_ratio || 0);
        const uniqueBuyers = Number(c.unique_buyers || 1);
        const totalTxns = Number(c.total_txns || 1);
        
        // Reject fast pumps
        if (growthRate > 5000 && minutesOld < 10) return false;
        if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
        if (mcap > 100000 && liqRatio > 100) return false;
        
        // REJECT: Claims 0m old but has significant activity = fake new discovery
        if (minutesOld <= 2 && (txnCount > 50 || holderCount > 100)) return false;
        if (minutesOld <= 5 && (txnCount > 200 || holderCount > 500)) return false;
        
        // WASH TRADE DETECTION
        if (microTradeRatio > 0.8 && minutesOld < 60) return false;
        if (totalTxns > 100 && uniqueBuyers < 5) return false;
        
        return true;
      })
      .map((c: any) => ({
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        signal: "ACTIVITY",
        market_cap_usd: c.market_cap_usd,
        liquidity_usd: c.liquidity_usd,
      }));
    
    return NextResponse.json({
      buy_signals: signals,
      sell_signals: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Signals error:", err);
    return NextResponse.json({
      buy_signals: [],
      sell_signals: [],
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  }
}
