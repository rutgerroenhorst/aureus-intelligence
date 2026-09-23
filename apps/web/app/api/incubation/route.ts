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
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE(pr.market_cap_usd, 0)::numeric / NULLIF(COALESCE(lq.liquidity_usd, 1), 0) as liq_ratio,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as recent_buys,
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
      LIMIT 250
    `);
    
    const scored = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld;
        
        // HARD FILTERS
        if (growthRate > 10000 && minutesOld < 10) return false;  // Explosive growth = rug
        if (mcap > 80000 && liqRatio > 150) return false;
        if (mcap > 40000 && liq < 1000) return false;
        if (mcap > 30000 && liq < 5000 && minutesOld < 120) return false;
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        
        // AUTHORITIES - PRIMARY SIGNAL (60 points)
        const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
        const hasOneAuthority = (c.mint_auth && !c.freeze_auth) || (!c.mint_auth && c.freeze_auth);
        if (hasNoAuthority) score += 70;
        else if (hasOneAuthority) score += 15;
        else score -= 40;
        
        // HOLDER DISTRIBUTION - CRITICAL (50 points)
        const holderTop10 = c.holder_top10_pct || 50;
        if (holderTop10 < 3) score += 60;
        else if (holderTop10 < 5) score += 35;
        else if (holderTop10 < 10) score += 10;
        else score -= 20;
        
        // HOLDER COUNT - NETWORK EFFECT (30 points)
        const holderCount = Number(c.holder_count || 0);
        if (holderCount > 50) score += 35;
        else if (holderCount > 20) score += 18;
        else if (holderCount > 10) score += 8;
        else score -= 25;
        
        // BUY RATIO - REAL VOLUME (25 points)
        const buyRatio = Number(c.buy_ratio || 0.5);
        if (buyRatio > 0.8) score += 25;
        else if (buyRatio > 0.7) score += 18;
        else if (buyRatio > 0.6) score += 12;
        else if (buyRatio > 0.5) score += 5;
        else score -= 15;
        
        // RECENT BUY MOMENTUM - VELOCITY (20 points)
        const recentBuys = Number(c.recent_buys || 0);
        if (recentBuys > 50) score += 20;
        else if (recentBuys > 20) score += 12;
        else if (recentBuys > 5) score += 6;
        
        // LIQUIDITY DEPTH (15 points)
        const liq = Number(c.liquidity_usd || 0);
        if (liq > 10000) score += 15;
        else if (liq > 5000) score += 10;
        else if (liq > 1000) score += 5;
        else score -= 10;
        
        // EARLY ENTRY BONUS (10 points)
        const minutesOld = c.minutes_old || 0;
        if (minutesOld < 5) score += 15;
        else if (minutesOld < 10) score += 8;
        
        let tier = "COLD";
        if (score >= 150) tier = "ELITE";
        else if (score >= 120) tier = "HOT";
        else if (score >= 80) tier = "WARM";
        
        return {...c, score, tier};
      });
    
    // Show top candidates that pass elite gate
    const filtered = scored.filter((c: any) => c.score >= 80);
    return NextResponse.json(
      {candidates: filtered.sort((a: any, b: any) => {
        const order: Record<string, number> = { ELITE: 0, HOT: 1, WARM: 2, COLD: 3 };
        return ((order[a.tier] ?? 999) - (order[b.tier] ?? 999)) || (b.score - a.score);
      })},
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Incubation error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
