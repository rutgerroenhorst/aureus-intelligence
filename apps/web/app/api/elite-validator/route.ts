import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

/**
 * ELITE VALIDATOR: Only coins with 50x+ winning characteristics
 * Criteria: NO authorities, <3% holder concentration, sustained volume, early discovery
 */
export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        COALESCE(pr.price_usd, 0) as price_usd,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 300
    `);
    
    // STRICT PRE-FILTERS: Must pass ALL criteria
    const elite = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        
        // MUST BE: No authorities
        if (c.mint_auth || c.freeze_auth) return false;
        
        // MUST BE: Distributed holders
        if (holderTop10 > 5) return false;  // Top 10% must be <5%
        if (holderCount < 10) return false;  // Need at least 10 holders
        
        // MUST BE: Real liquidity
        if (mcap > 0 && liq < Math.max(1000, mcap * 0.05)) return false;  // Liq at least 5% of mcap
        
        // MUST BE: Real buy pressure
        const buyRatio = Number(c.buy_ratio || 0.5);
        if (buyRatio < 0.6) return false;  // Must be 60%+ buys
        
        // MUST BE: Not too old
        if (minutesOld > 120) return false;  // Last 2 hours only
        
        // MUST BE: Real market
        if (mcap < 10000 || mcap > 100000) return false;  // $10k-$100k range = discovery zone
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const buyRatio = Number(c.buy_ratio || 0.5);
        const holderTop10 = c.holder_top10_pct || 100;
        const holderCount = Number(c.holder_count || 0);
        const totalBuys = Number(c.total_buys || 0);
        
        // SCORE BY INTENSITY (separate from filtering)
        
        // Ultra-concentrated holder distribution = highest potential for 50x
        if (holderTop10 < 2) score += 100;
        else if (holderTop10 < 3) score += 80;
        else if (holderTop10 < 4) score += 50;
        else score += 20;
        
        // Strong buy ratio = sustained momentum
        if (buyRatio > 0.85) score += 50;
        else if (buyRatio > 0.75) score += 35;
        else if (buyRatio > 0.65) score += 20;
        
        // Large holder base = network effect potential
        if (holderCount > 100) score += 40;
        else if (holderCount > 50) score += 25;
        else if (holderCount > 20) score += 15;
        
        // Recent volume velocity
        if (totalBuys > 100) score += 30;
        else if (totalBuys > 50) score += 18;
        else if (totalBuys > 20) score += 10;
        
        // Micro-cap stage = highest upside potential
        if (mcap < 30000) score += 40;
        else if (mcap < 50000) score += 25;
        else score += 10;
        
        // VERY EARLY = highest ROI (first 10 minutes critical)
        if (minutesOld < 3) score += 60;
        else if (minutesOld < 10) score += 40;
        else if (minutesOld < 30) score += 20;
        else if (minutesOld < 60) score += 10;
        
        return {
          ...c,
          score,
          tier: "ELITE",
          potential_category: score > 300 ? "EXTREME" : score > 250 ? "VERY_HIGH" : "HIGH"
        };
      });
    
    // ONLY return elite coins with highest potential
    return NextResponse.json(
      {
        candidates: elite
          .filter((c: any) => c.score >= 200)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 20)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Elite validator error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
