import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '7 days' AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC LIMIT 150
    `);
    
    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        
        if (mcap > 40000 && liq < 1000) return false;
        if (mcap > 30000 && liq < 5000 && minutesOld < 120) return false;
        if (holderCount < 5) return false;
        
        return true;
      })
      .map((c: any) => {
        let score = 0;
        
        const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
        const hasOneAuthority = (c.mint_auth && !c.freeze_auth) || (!c.mint_auth && c.freeze_auth);
        if (hasNoAuthority) score += 50;
        else if (hasOneAuthority) score += 10;
        else score -= 25;
        
        const holderTop10 = c.holder_top10_pct || 50;
        if (holderTop10 < 3) score += 40;
        else if (holderTop10 < 5) score += 20;
        else score -= 15;
        
        const buyRatio = Number(c.buy_ratio || 0.5);
        if (buyRatio > 0.7) score += 18;
        else if (buyRatio > 0.5) score += 8;
        
        return {...c, score, signal: "SIGNAL"};
      });
    
    return NextResponse.json(
      { candidates: candidates.filter((c: any) => c.score >= 90).sort((a: any, b: any) => b.score - a.score) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Signals error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
