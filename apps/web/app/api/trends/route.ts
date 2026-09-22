import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT DISTINCT ON (c.id)
        c.id, t.symbol_label as symbol, t.mint,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.id, c.discovered_at DESC
      LIMIT 100
    `);
    
    const candidates = result.rows.map((c: any) => ({
      ...c,
      signal: "TRENDING",
    }));
    
    return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
