import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();

    const result = await pool.query(`
      SELECT
        c.chain,
        COUNT(DISTINCT c.id) as total_candidates,
        COALESCE((SELECT SUM(buys) FROM transaction_aggregates WHERE pool_id IN (SELECT pool_id FROM candidates WHERE chain = c.chain) AND observed_at > now() - interval '1 hour'), 0)::int as buys_1h,
        COALESCE((SELECT SUM(buys + sells) FROM transaction_aggregates WHERE pool_id IN (SELECT pool_id FROM candidates WHERE chain = c.chain) AND observed_at > now() - interval '1 hour'), 0)::int as txn_1h,
        COALESCE((SELECT SUM(COALESCE(pr.market_cap_usd, 0)) FROM candidates c2 JOIN LATERAL (SELECT market_cap_usd FROM prices WHERE pool_id = c2.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true WHERE c2.chain = c.chain AND c2.discovered_at > now() - interval '24 hours'), 0)::numeric as volume_24h_usd,
        COALESCE((SELECT SUM(buyers) FROM transaction_aggregates WHERE pool_id IN (SELECT pool_id FROM candidates WHERE chain = c.chain) AND observed_at > now() - interval '1 hour'), 0)::int as unique_buyers_1h
      FROM candidates c
      WHERE c.discovered_at > now() - interval '24 hours'
        AND c.current_state <> 'EXPIRED'
      GROUP BY c.chain
      ORDER BY txn_1h DESC
    `);

    const networks = result.rows.map((row: any) => {
      const buys1h = row.buys_1h || 0;
      const txn1h = row.txn_1h || 1;
      const buyRatio = buys1h / txn1h;
      const uniqueBuyers = row.unique_buyers_1h || 0;

      // Heat score: combination of volume, activity, and buyer diversity
      let heatScore = 0;
      if (txn1h > 100) heatScore += 40;
      else if (txn1h > 50) heatScore += 30;
      else if (txn1h > 20) heatScore += 20;
      else if (txn1h > 5) heatScore += 10;

      if (buyRatio > 0.7) heatScore += 30;
      else if (buyRatio > 0.6) heatScore += 20;
      else if (buyRatio > 0.5) heatScore += 10;

      if (uniqueBuyers > 30) heatScore += 30;
      else if (uniqueBuyers > 15) heatScore += 20;
      else if (uniqueBuyers > 5) heatScore += 10;

      let status = "COLD";
      if (heatScore >= 70) status = "FIRE";
      else if (heatScore >= 50) status = "HOT";
      else if (heatScore >= 30) status = "WARM";

      return {
        chain: row.chain || "UNKNOWN",
        total_candidates: row.total_candidates,
        transactions_1h: txn1h,
        buys_1h: buys1h,
        buy_ratio: (buyRatio * 100).toFixed(1),
        unique_buyers_1h: uniqueBuyers,
        volume_24h_usd: Number(row.volume_24h_usd || 0),
        heat_score: heatScore,
        status,
      };
    });

    const sorted = networks.sort((a: any, b: any) => b.heat_score - a.heat_score);

    return NextResponse.json({
      networks: sorted,
      top_chains: sorted.slice(0, 5).map((n: any) => n.chain),
      timestamp: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Network sentiment error:", err);
    return NextResponse.json({
      networks: [],
      top_chains: [],
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  }
}
