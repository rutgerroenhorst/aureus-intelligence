import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 50
    `);
    
    const signals = result.rows.map((c: any) => ({
      id: c.id,
      symbol: c.symbol,
      mint: c.mint,
      signal: "ACTIVITY",
      market_cap_usd: c.market_cap_usd,
      liquidity_usd: c.liquidity_usd,
    }));
    
    return NextResponse.json({
      buy_signals: signals,
      sell_signals: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Signals error:", err);
    return NextResponse.json({
      buy_signals: [],
      sell_signals: [],
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  }
}
