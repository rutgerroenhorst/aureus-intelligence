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
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_sells,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '48 hours'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 500
    `);

    const scored = result.rows.map((c: any) => {
      const red_flags = [];

      const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
      if (!hasNoAuthority) red_flags.push("Has mint/freeze authority");

      const holderTop10 = c.holder_top10_pct || 50;
      if (holderTop10 > 5) red_flags.push("Concentrated holders");

      const buyRatio = c.buy_ratio || 0.5;
      if (buyRatio <= 0.65) red_flags.push("Low buy ratio");

      const liquidity = c.liquidity_usd || 0;
      if (liquidity < 1000) red_flags.push("Low liquidity");

      const buys5m = c.buys_5m || 0;
      const minutesOld = c.minutes_old || 0;
      if (minutesOld > 5 && buys5m === 0) red_flags.push("Holder momentum gone");

      let score = 0;

      if (buyRatio > 0.75) score += 25;
      else if (buyRatio > 0.65) score += 20;
      else if (buyRatio > 0.55) score += 15;

      if (buys5m >= 5) score += 20;
      else if (buys5m >= 3) score += 15;
      else if (buys5m >= 1) score += 8;

      if (hasNoAuthority) score += 30;

      if (holderTop10 < 5) score += 20;
      else if (holderTop10 < 10) score += 12;

      if (liquidity > 5000) score += 10;
      else if (liquidity > 1000) score += 5;

      if (minutesOld < 30) score += 15;
      else if (minutesOld < 60) score += 10;

      let tier = "COLD";
      if (score >= 95) tier = "ELITE";
      else if (score >= 85) tier = "HOT";
      else if (score >= 75) tier = "WARM";

      return {
        ...c,
        score,
        tier,
        red_flags: red_flags.length > 0 ? red_flags : undefined,
        is_winner: red_flags.length === 0 && score >= 85,
        buy_ratio: (buyRatio * 100).toFixed(1),
      };
    });

    const winners = scored.filter((c: any) => c.is_winner);

    return NextResponse.json({
      candidates: winners.sort((a: any, b: any) => b.score - a.score),
      total_screened: scored.length,
      winners_count: winners.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Winners-only error:", err);
    return NextResponse.json({ error: "Failed", candidates: [], total_screened: 0, winners_count: 0 }, { status: 200 });
  }
}
