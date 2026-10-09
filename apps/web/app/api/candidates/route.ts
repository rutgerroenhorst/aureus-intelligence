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
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.current_state <> 'EXPIRED'
        AND COALESCE(pr.market_cap_usd, 0) >= 10000
      ORDER BY c.discovered_at DESC
      LIMIT 500
    `);
    
    return NextResponse.json({ 
      candidates: result.rows.map((c: any) => ({
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        discovered_at: c.discovered_at,
        marketCapUsd: c.market_cap_usd,
        liquidityUsd: c.liquidity_usd,
        topHolders: [], // Will be populated by CATE hunter separately
        v2StructuralStatus: null,
        v2StructuralConfidence: null,
      }))
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Candidates error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
