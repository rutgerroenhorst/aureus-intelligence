import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

/**
 * The base list every tab is built from. One Radar build asked for it five times (the bundle itself, the safety gate, the elite validator, the signals and CATE routes): 206 rows and 58 KB each, 290 KB of the 330 to 410 KB
 * a build read from the hosted database, which used the day's egress allowance up by the afternoon and put the Radar on its five-minute brake (2026-10-16: "I no longer see coins leave or arrive"). The list only changes when
 * a scan has run (hourly on the site, every ten minutes or so when the laptop scans), so it is read once and shared: 3 minutes on the site, 15 seconds on the laptop.
 * The tabs' live gates (lib/liveGate.ts) still look at the market every minute; only this slow part is kept.
 */
const TTL_MS = process.env.VERCEL ? 180_000 : 15_000;
let memo: { at: number; rows: Promise<any[]> } | null = null;

const SQL = `
      SELECT
        c.id, t.symbol_label as symbol, t.mint, c.discovered_at,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.current_state <> 'EXPIRED'
        AND COALESCE(pr.market_cap_usd, 0) >= 10000
      ORDER BY c.discovered_at DESC
      LIMIT 500
    `;

export async function GET() {
  try {
    // callers that ask at the same moment share one read (the promise is kept), and a read that failed is not kept
    let current = memo;
    if (!current || Date.now() - current.at > TTL_MS) {
      const read = getPool().query(SQL).then((r) => r.rows);
      const mine = { at: Date.now(), rows: read };
      memo = current = mine;
      read.catch(() => {
        if (memo === mine) memo = null;
      });
    }
    const rows = await current.rows;

    return NextResponse.json({
      candidates: rows.map((c: any) => ({
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
