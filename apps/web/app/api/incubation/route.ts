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
    
    const scored = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const buyRatio = Number(c.buy_ratio || 0.5);
        
        if (c.mint_auth || c.freeze_auth) return false;
        if (holderTop10 > 4) return false;
        if (holderCount < 15) return false;
        if (liq < 3000) return false;
        if (mcap > 0 && liq < mcap * 0.08) return false;
        if (buyRatio < 0.65) return false;
        if (minutesOld > 60) return false;
        if (mcap < 15000 || mcap > 80000) return false;
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const holderCount = Number(c.holder_count || 0);
        const buyRatio = Number(c.buy_ratio || 0.5);
        const totalBuys = Number(c.total_buys || 0);
        
        if (minutesOld < 2) score += 100;
        else if (minutesOld < 5) score += 80;
        else if (minutesOld < 15) score += 50;
        else if (minutesOld < 30) score += 30;
        else score += 10;
        
        if (holderTop10 < 2) score += 80;
        else if (holderTop10 < 3) score += 60;
        else if (holderTop10 < 4) score += 40;
        
        if (holderCount > 100) score += 60;
        else if (holderCount > 50) score += 40;
        else if (holderCount > 20) score += 20;
        
        if (buyRatio > 0.9) score += 60;
        else if (buyRatio > 0.8) score += 40;
        else if (buyRatio > 0.7) score += 20;
        
        if (totalBuys > 150) score += 50;
        else if (totalBuys > 80) score += 30;
        else if (totalBuys > 40) score += 15;
        
        if (mcap < 25000) score += 40;
        else if (mcap < 40000) score += 25;
        else score += 10;
        
        const liqRatio = liq / Math.max(1, mcap);
        if (liqRatio > 0.2) score += 40;
        else if (liqRatio > 0.12) score += 25;
        else score += 10;
        
        let tier = "COLD";
        if (score >= 300) tier = "ELITE";
        else if (score >= 250) tier = "HOT";
        else if (score >= 180) tier = "WARM";
        
        return {...c, score, tier};
      });
    
    const filtered = scored.filter((c: any) => c.score >= 180);
    return NextResponse.json(
      {candidates: filtered.sort((a: any, b: any) => {const order: Record<string, number> = { ELITE: 0, HOT: 1, WARM: 2, COLD: 3 }; return ((order[a.tier] ?? 999) - (order[b.tier] ?? 999)) || (b.score - a.score);}).slice(0, 30)},
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Incubation error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
