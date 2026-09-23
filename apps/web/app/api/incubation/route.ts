import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

/**
 * INCUBATION: Ultra-early 50x hunter
 * - Catches coins 0-5 minutes old (before big moves)
 * - Analyzes momentum acceleration
 * - Detects volume breakout patterns
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
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_sells,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '1 minute' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_1m,
        COALESCE((SELECT (buys + sells) FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '1 minute' ORDER BY observed_at DESC LIMIT 1), 1)::int as volume_1m
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '30 minutes'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 200
    `);
    
    const scored = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 0.1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const buyRatio = Number(c.buy_ratio || 0.5);
        const totalBuys = Number(c.total_buys || 0);
        const totalSells = Number(c.total_sells || 0);
        const volume_1m = Number(c.volume_1m || 1);
        
        // MUST HAVE: NO authorities
        if (c.mint_auth || c.freeze_auth) return false;
        
        // MUST HAVE: Distributed holders
        if (holderTop10 > 5) return false;
        if (holderCount < 5) return false;  // Lower bar for ultra-early
        
        // MUST HAVE: Some liquidity
        if (liq < 500) return false;  // Can be thin at discovery
        
        // MUST HAVE: Real buy pressure
        if (buyRatio < 0.6) return false;
        
        // ULTRA-EARLY ONLY: <30 minutes
        if (minutesOld > 30) return false;
        
        // MUST BE: Micro-cap
        if (mcap < 5000 || mcap > 100000) return false;
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        
        const minutesOld = c.minutes_old || 0.1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const buyRatio = Number(c.buy_ratio || 0.5);
        const totalBuys = Number(c.total_buys || 0);
        const totalSells = Number(c.total_sells || 0);
        const buys_1m = Number(c.buys_1m || 0);
        const volume_1m = Number(c.volume_1m || 1);
        
        // CRITICAL: Discovery timing (generational wealth caught 0-2 min old)
        if (minutesOld < 0.33) score += 200;  // < 20 seconds = LEGENDARY
        else if (minutesOld < 0.5) score += 180;  // 20-30 sec
        else if (minutesOld < 1) score += 150;  // < 1 min = PRIME
        else if (minutesOld < 2) score += 120;  // < 2 min = EXCELLENT
        else if (minutesOld < 5) score += 70;
        else if (minutesOld < 10) score += 35;
        else score += 5;
        
        // AUTHORITIES: No authorities critical
        if (!c.mint_auth && !c.freeze_auth) score += 100;
        else return {...c, score: 0, tier: "COLD"};  // Reject if authorities exist
        
        // HOLDER DISTRIBUTION: Ultra-concentrated = high upside
        if (holderTop10 < 2) score += 90;
        else if (holderTop10 < 3) score += 70;
        else if (holderTop10 < 5) score += 40;
        
        // HOLDER COUNT: Larger = more organic
        if (holderCount > 30) score += 60;
        else if (holderCount > 15) score += 35;
        else if (holderCount > 5) score += 15;
        
        // BUY RATIO: Strong buyers
        if (buyRatio > 0.85) score += 70;
        else if (buyRatio > 0.75) score += 50;
        else if (buyRatio > 0.65) score += 30;
        
        // MOMENTUM ACCELERATION: Recent buy velocity
        if (buys_1m > 20) score += 80;  // Massive recent activity
        else if (buys_1m > 10) score += 50;
        else if (buys_1m > 3) score += 25;
        
        // VOLUME BREAKOUT: High volume/buy ratio = momentum
        const buyRatio_1m = buys_1m / Math.max(1, volume_1m);
        if (buyRatio_1m > 0.8) score += 70;
        else if (buyRatio_1m > 0.7) score += 45;
        else if (buyRatio_1m > 0.6) score += 25;
        
        // TOTAL BUY COUNT: Sustained volume
        if (totalBuys > 100) score += 50;
        else if (totalBuys > 50) score += 30;
        else if (totalBuys > 20) score += 15;
        
        // MICRO-CAP STAGE: Smallest = highest % upside
        if (mcap < 15000) score += 60;
        else if (mcap < 30000) score += 40;
        else if (mcap < 50000) score += 20;
        else score += 10;
        
        // LIQUIDITY ADEQUACY: Enough to move
        const liqRatio = liq / Math.max(1, mcap);
        if (liqRatio > 0.15) score += 40;
        else if (liqRatio > 0.08) score += 20;
        else score += 5;
        
        let tier = "COLD";
        if (score >= 520) tier = "ELITE";  // Raised from 450: must catch within 30sec + all quality metrics
        else if (score >= 400) tier = "HOT";  // Raised from 350
        else if (score >= 280) tier = "WARM";  // Raised from 250
        
        return {...c, score, tier, momentum: buys_1m, acceleration: buyRatio_1m};
      });
    
    const filtered = scored.filter((c: any) => c.score >= 280);
    
    return NextResponse.json(
      {
        candidates: filtered
          .sort((a: any, b: any) => {
            const order: Record<string, number> = { ELITE: 0, HOT: 1, WARM: 2, COLD: 3 };
            return ((order[a.tier] ?? 999) - (order[b.tier] ?? 999)) || (b.score - a.score);
          })
          .slice(0, 50)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Incubation error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
