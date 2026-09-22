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
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE(pr.market_cap_usd, 0)::numeric / NULLIF(COALESCE(lq.liquidity_usd, 1), 0) as liq_ratio
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '7 days'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const candidates = result.rows
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liqRatio = Number(c.liq_ratio || 0);
        const growthRate = mcap / minutesOld; // mcap per minute
        
        // REJECT: Old pumped coins (>4h, high mcap, thin liq)
        if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
        
        // REJECT: Very high start (>100k mcap after 2h) - not early
        if (mcap > 100000 && minutesOld > 120) return false;
        
        // REJECT: Abnormal growth rate (>$5k per minute = fast rug pattern)
        // Real early coins grow slow; if $10k mcap in 2 minutes = pump
        if (growthRate > 5000 && minutesOld < 10) return false;
        
        // REJECT: Thin liquidity at high mcap (liq_ratio > 100 = possible rug)
        if (mcap > 80000 && liqRatio > 100) return false;
        
        return true;
      })
      .map((c: any) => ({
        ...c,
        tier: "EARLY",
        score: 50,
      }));

    return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Ultra-early error:", err);
    return NextResponse.json({ candidates: [] }, { status: 200 });
  }
}
