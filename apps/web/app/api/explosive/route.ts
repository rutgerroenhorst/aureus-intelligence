import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/3600::int as hours_old,
        COALESCE(pr.price_usd, 0) as price_usd,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1)::numeric / 
                 NULLIF((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '1 hour' ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as volume_velocity,
        COALESCE(pr.price_usd::numeric / NULLIF((SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as price_velocity,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '6 hours' ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '6 hours' ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '48 hours' AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);
    
    const scored = result.rows.map((c: any) => {
      let score = 0;
      if (c.hours_old < 6) score += 30; else if (c.hours_old < 12) score += 25; else if (c.hours_old < 24) score += 20; else if (c.hours_old < 48) score += 10;
      if (c.volume_velocity > 5) score += 35; else if (c.volume_velocity > 3) score += 28; else if (c.volume_velocity > 2) score += 20; else if (c.volume_velocity > 1) score += 10;
      if (c.price_velocity > 5) score += 25; else if (c.price_velocity > 3) score += 20; else if (c.price_velocity > 2) score += 12;
      if (c.buy_ratio > 0.75) score += 20; else if (c.buy_ratio > 0.65) score += 15; else if (c.buy_ratio > 0.55) score += 8;
      if (!c.mint_auth && !c.freeze_auth) score += 15;
      if (c.holder_top10 < 1) score += 10; else if (c.holder_top10 < 2) score += 6;
      
      let tier = "COLD", mult = 1;
      if (score >= 120 && c.volume_velocity > 5 && c.hours_old < 12) { tier = "MEGA"; mult = 100; }
      else if (score >= 100 && c.volume_velocity > 3 && c.hours_old < 24) { tier = "HUGE"; mult = 50; }
      else if (score >= 80 && c.volume_velocity > 2) { tier = "BIG"; mult = 10; }
      else if (score >= 50) { tier = "WARM"; mult = 3; }
      
      return {...c, score, tier, mult, time_remaining: Math.max(0, 48 - c.hours_old)};
    });
    
    return NextResponse.json({ candidates: scored.sort((a: any, b: any) => {
      const order: Record<string, number> = { MEGA: 0, HUGE: 1, BIG: 2, WARM: 3, COLD: 4 };
      return ((order[a.tier] || 999) - (order[b.tier] || 999)) || (b.score - a.score);
    })}, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Explosive error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
