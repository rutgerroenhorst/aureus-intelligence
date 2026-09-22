import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 50
    `);
    
    return NextResponse.json({
      candidates: result.rows.map((c: any) => ({
        ...c,
        phase: "active",
        strength: "moderate",
        confidence: 50,
      })),
    });
  } catch {
    return NextResponse.json({ candidates: [] });
  }
}
