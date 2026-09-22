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
        COALESCE(pr.price_usd, 0) as price_usd,
        COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
        COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
        COALESCE(pr_first.price_usd, pr.price_usd, 0) as discovery_price_usd,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_sells,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '10 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as sells_10m,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT price_usd FROM prices WHERE pool_id = c.pool_id AND observed_at >= c.discovered_at ORDER BY observed_at ASC LIMIT 1) pr_first ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '48 hours'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 200
    `);

    const scored = result.rows.map((c: any) => {
      const red_flags = [];

      // Rug pull detection
      const currentPrice = c.price_usd || 0;
      const discoveryPrice = c.discovery_price_usd || currentPrice || 1;
      const priceVelocity = discoveryPrice > 0 ? currentPrice / discoveryPrice : 1;
      const priceDropPct = Math.max(0, (1 - priceVelocity) * 100);

      if (priceVelocity < 0.5) {
        red_flags.push(`DUMP: Price -${priceDropPct.toFixed(0)}% from discovery`);
      } else if (priceVelocity < 0.75) {
        red_flags.push(`Price down ${priceDropPct.toFixed(0)}%`);
      }

      const totalBuys = c.total_buys || 1;
      const totalSells = c.total_sells || 0;
      const sells10m = c.sells_10m || 0;
      if (sells10m > totalBuys * 0.5 && sells10m > 3) {
        red_flags.push(`Sell spike: ${sells10m} sells`);
      }

      const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
      if (!hasNoAuthority) red_flags.push("Has mint/freeze authority");

      const holderTop10 = c.holder_top10_pct || 50;
      if (holderTop10 > 5) red_flags.push(`Top10 holders: ${holderTop10.toFixed(1)}%`);

      const buyRatio = c.buy_ratio || 0.5;
      if (buyRatio <= 0.65) red_flags.push("Low buy ratio");

      const liquidity = c.liquidity_usd || 0;
      if (liquidity < 1000) red_flags.push("Low liquidity");

      let score = 0;

      // Penalize coins showing dump signs
      if (priceVelocity < 0.3) score -= 100;
      else if (priceVelocity < 0.5) score -= 50;
      else if (priceVelocity < 0.75) score -= 20;

      if (buyRatio > 0.75) score += 25;
      else if (buyRatio > 0.65) score += 20;
      else if (buyRatio > 0.55) score += 15;
      else if (buyRatio > 0.5) score += 8;

      const buys5m = c.buys_5m || 0;
      if (buys5m >= 5) score += 20;
      else if (buys5m >= 3) score += 15;
      else if (buys5m >= 1) score += 8;

      if (hasNoAuthority) score += 30;

      if (holderTop10 < 5) score += 20;
      else if (holderTop10 < 10) score += 12;
      else if (holderTop10 < 20) score += 5;

      if (liquidity > 5000) score += 10;
      else if (liquidity > 1000) score += 5;

      const minutesOld = c.minutes_old || 0;
      if (minutesOld < 3) score += 15;
      else if (minutesOld < 6) score += 10;

      let tier = "COLD";
      if (score >= 90) tier = "ELITE";
      else if (score >= 75) tier = "HOT";
      else if (score >= 60) tier = "WARM";

      return {
        ...c,
        score,
        tier,
        red_flags: red_flags.length > 0 ? red_flags : undefined,
        price_velocity: priceVelocity.toFixed(3),
        buy_ratio: (buyRatio * 100).toFixed(1),
        time_to_act: Math.max(0, 12 - minutesOld),
      };
    });

    const filtered = scored.filter((c: any) => c.tier !== "COLD");

    return NextResponse.json({
      candidates: filtered.sort((a: any, b: any) => {
        const order = { ELITE: 0, HOT: 1, WARM: 2 };
        return (order[a.tier] - order[b.tier]) || (b.score - a.score);
      })
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Ultra-early error:", err);
    return NextResponse.json({ error: "Failed", candidates: [] }, { status: 200 });
  }
}
