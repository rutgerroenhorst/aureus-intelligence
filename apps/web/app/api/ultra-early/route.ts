import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();

    const result = await pool.query(`
      WITH txn_windows AS (
        SELECT 
          pool_id,
          COUNT(DISTINCT CASE WHEN observed_at > now() - interval '5 minutes' THEN 1 END) as recent_buys
        FROM transaction_aggregates
        GROUP BY pool_id
      ),
      txn_analysis AS (
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
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE(tw.recent_buys, 0)::int as buy_consistency_score,
        COALESCE(ta.micro_trade_ratio, 0)::float as micro_trade_ratio,
        COALESCE(ta.unique_buyers, 1)::int as unique_buyers,
        COALESCE(ta.total_txns, 1)::int as total_txns
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      LEFT JOIN txn_windows tw ON tw.pool_id = c.pool_id
      LEFT JOIN txn_analysis ta ON ta.pool_id = c.pool_id
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld;
        const buyRatio = Number(c.buy_ratio || 0.5);
        const microTradeRatio = Number(c.micro_trade_ratio || 0);
        const uniqueBuyers = Number(c.unique_buyers || 1);
        const totalTxns = Number(c.total_txns || 1);
        
        // Pump pattern rejection
        if (growthRate > 5000 && minutesOld < 10) return false;
        if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
        if (mcap > 100000 && liqRatio > 100) return false;
        
        // Early dump indicator
        if (buyRatio < 0.4 && minutesOld < 30) return false;
        
        // Whale-only (low holder count = concentrated)
        if (Number(c.holder_count || 0) < 3 && minutesOld > 10) return false;
        
        // WASH TRADE DETECTION
        if (microTradeRatio > 0.8 && minutesOld < 60) return false;
        if (totalTxns > 100 && uniqueBuyers < 5) return false;
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        
        const buyRatio = Number(c.buy_ratio || 0.5);
        if (buyRatio > 0.75) score += 20;
        else if (buyRatio > 0.65) score += 15;
        else if (buyRatio > 0.5) score += 10;
        
        const holderCount = Number(c.holder_count || 0);
        if (holderCount > 30) score += 20;
        else if (holderCount > 10) score += 12;
        else if (holderCount > 3) score += 5;
        else score -= 20;
        
        const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
        if (hasNoAuthority) score += 25;
        else score -= 10;
        
        const holderTop10 = c.holder_top10_pct || 50;
        if (holderTop10 < 3) score += 20;
        else if (holderTop10 < 5) score += 12;
        else score -= 5;
        
        return {
          ...c,
          tier: "EARLY",
          score: Math.max(0, score),
        };
      });

    return NextResponse.json(
      { candidates: candidates.filter((c: any) => c.score >= 15).sort((a: any, b: any) => b.score - a.score) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Ultra-early error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
