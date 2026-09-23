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
        COALESCE(pr.market_cap_usd, 0)::numeric / NULLIF(COALESCE(lq.liquidity_usd, 1), 0) as liq_ratio,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id), 0)::int as txn_count,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 150
    `);
    
    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld;
        const txnCount = Number(c.txn_count || 0);
        const holderCount = Number(c.holder_count || 0);
        
        if (growthRate > 5000 && minutesOld < 10) return false;
        if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
        if (mcap > 100000 && liqRatio > 100) return false;
        if (minutesOld <= 2 && (txnCount > 50 || holderCount > 100)) return false;
        if (minutesOld <= 5 && (txnCount > 200 || holderCount > 500)) return false;
        
        if (mcap > 40000 && liq < 1000) return false;
        if (mcap > 30000 && liq < 5000 && minutesOld < 120) return false;
        if (mcap > 50000 && holderCount < 20 && minutesOld < 60) return false;
        
        return true;
      });
      
    return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
