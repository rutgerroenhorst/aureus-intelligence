import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

interface EliteCandidate {
  id: string;
  symbol: string;
  mint: string;
  minutes_old: number;
  market_cap_usd: number;
  liquidity_usd: number;
  buy_ratio: number;
  holder_top10_pct: number;
  mint_auth: boolean;
  freeze_auth: boolean;

  holder_acceleration: number;
  volume_momentum: number;
  lp_stability: number;
  developer_active: boolean;
  price_stability: number;

  risk_score: number;
  opportunity_score: number;
  elite_grade: string;
  red_flags: string[];
}

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
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE((oe.intel->'holders'->>'count')::int, 0) as holder_count
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE COALESCE(pr.market_cap_usd, 0) >= 5000
        AND COALESCE(pr.market_cap_usd, 0) >= 5000
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 100
    `);

    const validated = result.rows.filter((c: any) => {
      const minutesOld = c.minutes_old || 1;
      const mcap = Number(c.market_cap_usd || 0);
      const liq = Number(c.liquidity_usd || 0);
      const growthRate = mcap / minutesOld;
      const liqRatio = mcap / (liq || 1);
      
      if (growthRate > 5000 && minutesOld < 10) return false;
      if (minutesOld > 240 && mcap > 50000 && liqRatio > 50) return false;
      if (mcap > 100000 && liqRatio > 100) return false;
      
      return true;
    })
    .map((c: any) => {
      const red_flags = [];

      const buyRatio = c.buy_ratio || 0.5;
      const minutesOld = c.minutes_old || 0;
      const holderTop10 = c.holder_top10_pct || 50;
      const mcap = c.market_cap_usd || 0;
      const liq = c.liquidity_usd || 0;
      const holderCount = c.holder_count || 0;
      const buys5m = c.buys_5m || 0;

      let holderAcceleration = 0;
      if (minutesOld > 0) {
        const holdersPerMin = holderCount / minutesOld;
        if (holdersPerMin > 10) holderAcceleration = 100;
        else if (holdersPerMin > 5) holderAcceleration = 75;
        else if (holdersPerMin > 2) holderAcceleration = 50;
        else if (holdersPerMin > 0.5) holderAcceleration = 25;
      }

      let volumeMomentum = 0;
      if (buys5m >= 10) volumeMomentum = 100;
      else if (buys5m >= 5) volumeMomentum = 75;
      else if (buys5m >= 2) volumeMomentum = 50;
      else if (buys5m >= 1) volumeMomentum = 25;

      let lpStability = 50;
      if (liq > mcap * 0.5) lpStability = 100;
      else if (liq > mcap * 0.2) lpStability = 75;
      else if (liq > mcap * 0.1) lpStability = 50;
      else if (liq > 1000) lpStability = 25;
      else {
        lpStability = 0;
        red_flags.push("Low liquidity");
      }

      const developerActive = minutesOld < 30;

      let priceStability = 50;
      if (minutesOld > 15 && buyRatio > 0.70) priceStability = 100;
      else if (buyRatio > 0.65) priceStability = 75;
      else if (buyRatio > 0.55) priceStability = 50;
      else {
        priceStability = 25;
        red_flags.push("Volatile price action");
      }

      const hasNoAuthority = !c.mint_auth && !c.freeze_auth;
      if (!hasNoAuthority) red_flags.push("Has mint/freeze authority");

      if (holderTop10 > 10) red_flags.push("Concentrated holders");

      if (mcap > 100000) red_flags.push("Market cap too high for early entry");

      const opportunityScore =
        (holderAcceleration * 0.25) +
        (volumeMomentum * 0.25) +
        (lpStability * 0.20) +
        (priceStability * 0.20) +
        (hasNoAuthority ? 10 : 0);

      const riskScore = red_flags.length * 20;

      let eliteGrade = "F";
      if (opportunityScore >= 80 && riskScore < 40 && holderAcceleration > 50 && volumeMomentum > 50) eliteGrade = "S";
      else if (opportunityScore >= 70 && riskScore < 60) eliteGrade = "A";
      else if (opportunityScore >= 60 && riskScore < 80) eliteGrade = "B";
      else if (opportunityScore >= 50 && riskScore < 100) eliteGrade = "C";
      else eliteGrade = "D";

      return {
        id: c.id,
        symbol: c.symbol,
        mint: c.mint,
        minutes_old: minutesOld,
        market_cap_usd: mcap,
        liquidity_usd: liq,
        buy_ratio: buyRatio,
        holder_top10_pct: holderTop10,
        mint_auth: c.mint_auth,
        freeze_auth: c.freeze_auth,
        holder_acceleration: Math.round(holderAcceleration),
        volume_momentum: Math.round(volumeMomentum),
        lp_stability: Math.round(lpStability),
        developer_active: developerActive,
        price_stability: Math.round(priceStability),
        risk_score: riskScore,
        opportunity_score: Math.round(opportunityScore),
        elite_grade: eliteGrade,
        red_flags: red_flags.length > 0 ? red_flags : undefined,
      };
    });

    const sGradeOnly = validated.filter((c: any) => c.elite_grade === "S").sort((a: any, b: any) => b.opportunity_score - a.opportunity_score);

    return NextResponse.json({
      candidates: sGradeOnly,
      total_validated: validated.length,
      elite_s_grade_count: sGradeOnly.length,
      grades: {
        S: sGradeOnly.length,
        A: validated.filter((c: any) => c.elite_grade === "A").length,
        B: validated.filter((c: any) => c.elite_grade === "B").length,
        C: validated.filter((c: any) => c.elite_grade === "C").length,
        D: validated.filter((c: any) => c.elite_grade === "D").length,
        F: validated.filter((c: any) => c.elite_grade === "F").length,
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Elite validator error:", err);
    return NextResponse.json({
      error: "Failed",
      candidates: [],
      total_validated: 0,
      elite_s_grade_count: 0,
      grades: { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0 }
    }, { status: 200 });
  }
}
