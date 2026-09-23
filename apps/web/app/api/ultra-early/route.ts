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
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '2 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_2m
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '15 minutes' AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC LIMIT 200
    `);

    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 0.1;
        if (c.mint_auth || c.freeze_auth) return false;
        if ((c.holder_top10_pct || 100) > 5) return false;
        if ((c.holder_count || 0) < 3) return false;
        if (minutesOld > 15) return false;
        const mcap = Number(c.market_cap_usd || 0);
        if (mcap < 5000 || mcap > 100000) return false;
        return true;
      })
      .map((c: any) => {
        let score = 0;
        const minutesOld = c.minutes_old || 0.1;
        
        if (minutesOld < 1) score += 120;
        else if (minutesOld < 2) score += 100;
        else if (minutesOld < 5) score += 70;
        else if (minutesOld < 10) score += 40;
        else score += 15;
        
        if (!c.mint_auth && !c.freeze_auth) score += 80;
        
        const holderTop10 = c.holder_top10_pct || 100;
        if (holderTop10 < 3) score += 70;
        else if (holderTop10 < 5) score += 40;
        
        const holderCount = Number(c.holder_count || 0);
        if (holderCount > 20) score += 50;
        else if (holderCount > 10) score += 30;
        
        const buyRatio = Number(c.buy_ratio || 0.5);
        if (buyRatio > 0.8) score += 60;
        else if (buyRatio > 0.7) score += 40;
        
        const buys_2m = Number(c.buys_2m || 0);
        if (buys_2m > 20) score += 60;
        else if (buys_2m > 10) score += 35;
        
        const mcap = Number(c.market_cap_usd || 0);
        if (mcap < 15000) score += 50;
        else if (mcap < 30000) score += 30;
        
        return {...c, tier: score >= 300 ? "EARLY" : "COLD", score: Math.max(0, score)};
      });

    return NextResponse.json(
      { candidates: candidates.filter((c: any) => c.score >= 150).sort((a: any, b: any) => b.score - a.score) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Ultra-early error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
