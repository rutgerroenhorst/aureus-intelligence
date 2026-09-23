import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query(`
      WITH txn_windows AS (
        SELECT pool_id, COUNT(DISTINCT CASE WHEN observed_at > now() - interval '5 minutes' THEN 1 END) as recent_buys
        FROM transaction_aggregates GROUP BY pool_id
      )
      SELECT c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE(pr.market_cap_usd, 0)::numeric / NULLIF(COALESCE(lq.liquidity_usd, 1), 0) as liq_ratio,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE(tw.recent_buys, 0)::int as buy_consistency_score,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE transaction_aggregates.pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_sells
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      LEFT JOIN txn_windows tw ON tw.pool_id = c.pool_id
      WHERE c.discovered_at > now() - interval '7 days' AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC LIMIT 100
    `);

    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld;
        const buyRatio = Number(c.buy_ratio || 0.5);
        const holderCount = Number(c.holder_count || 0);
        const txnCount = (c.total_buys || 0) + (c.total_sells || 0);
        
        if (growthRate > 5000 && minutesOld < 10) return false;
        if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
        if (mcap > 100000 && liqRatio > 100) return false;
        if (buyRatio < 0.4 && minutesOld < 30) return false;
        if (holderCount < 3 && minutesOld > 10) return false;
        if (minutesOld <= 2 && (txnCount > 50 || holderCount > 100)) return false;
        if (minutesOld <= 5 && (txnCount > 200 || holderCount > 500)) return false;
        if (mcap > 40000 && liq < 1000) return false;
        if (mcap > 30000 && liq < 5000 && minutesOld < 120) return false;
        if (mcap > 50000 && holderCount < 20 && minutesOld < 60) return false;
        
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
        
        return {...c, tier: "EARLY", score: Math.max(0, score)};
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
