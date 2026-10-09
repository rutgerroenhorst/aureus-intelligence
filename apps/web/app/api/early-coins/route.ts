import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { passesTier1Filter, getTier1Score, Timeframe } from "../../../lib/tier1-signals";
import { getHypeScore } from "../../../lib/hype-detection";

export const dynamic = "force-dynamic";

function scoreDeadcoinDanger(c: any): number {
  const buyRatio = c.buy_ratio || 0.5;
  const priceVel = c.price_velocity || 1;
  const volumeVel = c.volume_velocity || 1;
  const holderTop10 = c.holder_top10 || 50;
  const mcap = Number(c.market_cap_usd || 0);
  const liq = Number(c.liquidity_usd || 0);

  let dangerScore = 0;

  if (buyRatio < 0.45) dangerScore += 40;
  else if (buyRatio < 0.50) dangerScore += 25;
  else if (buyRatio < 0.55) dangerScore += 10;

  if (volumeVel > 5 && buyRatio < 0.50) dangerScore += 30;
  else if (volumeVel > 3 && buyRatio < 0.55) dangerScore += 15;

  if (holderTop10 > 20) dangerScore += 20;
  else if (holderTop10 > 15) dangerScore += 12;
  else if (holderTop10 > 10) dangerScore += 5;

  const liqToMcapRatio = liq / Math.max(mcap, 1);
  if (liqToMcapRatio < 0.05) dangerScore += 10;

  return Math.max(0, Math.min(100, dangerScore));
}

function scoreStealthAccumulation(c: any): number {
  const minutesOld = c.minutes_old;
  const daysOld = minutesOld / (60 * 24);
  const buyRatio = c.buy_ratio || 0.5;
  const volumeVel = c.volume_velocity || 1;
  const priceVel = c.price_velocity || 1;
  const holderTop10 = c.holder_top10 || 50;
  const mcap = Number(c.market_cap_usd || 0);

  const dangerScore = scoreDeadcoinDanger(c);
  if (dangerScore > 55) return -1;

  let stealthScore = 0;

  if (daysOld >= 3 && daysOld <= 14) stealthScore += 30;
  else if (daysOld >= 2 && daysOld < 3) stealthScore += 20;
  else if (daysOld > 14 && daysOld <= 21) stealthScore += 15;
  else stealthScore += 5;

  if (buyRatio > 0.65 && volumeVel < 1.5) stealthScore += 25;
  else if (buyRatio > 0.60 && volumeVel < 2) stealthScore += 20;
  else if (buyRatio > 0.55) stealthScore += 12;

  const priceVolumeRatio = priceVel / Math.max(volumeVel, 0.1);
  if (priceVolumeRatio < 3 && buyRatio > 0.55) stealthScore += 20;
  else if (priceVolumeRatio < 5) stealthScore += 12;
  else if (priceVolumeRatio < 10) stealthScore += 5;

  if (holderTop10 < 3) stealthScore += 15;
  else if (holderTop10 < 5) stealthScore += 12;
  else if (holderTop10 < 10) stealthScore += 6;

  if (mcap < 200000) stealthScore += 10;
  else if (mcap < 500000) stealthScore += 7;
  else if (mcap < 1000000) stealthScore += 4;

  if (daysOld >= 5 && daysOld <= 8) stealthScore += 5;
  else if (daysOld >= 4 && daysOld < 5) stealthScore += 3;

  if (holderTop10 < 2 && buyRatio > 0.60) stealthScore += 5;
  else if (holderTop10 < 3 && buyRatio > 0.55) stealthScore += 3;

  const priceAbsorptionRatio = (buyRatio - 0.5) / Math.max(priceVel, 0.5);
  if (priceAbsorptionRatio > 0.25 && buyRatio > 0.62) stealthScore += 10;
  else if (priceAbsorptionRatio > 0.15 && buyRatio > 0.55) stealthScore += 6;
  else if (priceAbsorptionRatio > 0.10) stealthScore += 3;

  if (daysOld >= 3 && daysOld <= 8 && holderTop10 < 2) {
    stealthScore += 15;
  } else if (daysOld >= 3 && daysOld <= 8 && holderTop10 < 5) {
    stealthScore += 10;
  }

  return Math.max(0, Math.min(155, stealthScore));
}

async function scoreEarlyCandidate(c: any, timeframe: Timeframe = "long-hold"): Promise<any> {
  const mcap = Number(c.market_cap_usd || 0);
  const liq = Number(c.liquidity_usd || 0);
  const minutesOld = c.minutes_old;
  const holderTop10 = c.holder_top10 || 50;
  const mint = c.mint;
  const symbol = String(c.symbol || "");

  // TIER 1: CONTEXTUAL per timeframe
  if (mint && !passesTier1Filter(mint, timeframe)) {
    return null;
  }

  // HARD REJECTS (all timeframes)
  if (c.mint_auth === true) return null;
  if (c.freeze_auth === true) return null;
  if (mcap < 50 || mcap > 10000000) return null;
  if (liq < 100) return null;
  if (holderTop10 > 15) return null;

  let score = 0;
  
  // GATE 1: SAFETY (0-40 points)
  if (!c.mint_auth && !c.freeze_auth) {
    score += 40;
  } else {
    return null;
  }
  
  // GATE 2: DISTRIBUTION (0-30 points)
  if (holderTop10 < 1) score += 30;
  else if (holderTop10 < 2) score += 25;
  else if (holderTop10 < 3) score += 20;
  else if (holderTop10 < 5) score += 12;
  else if (holderTop10 < 10) score += 6;
  else score += 2;
  
  // GATE 3: BUY PRESSURE (0-25 points)
  const buyRatio = c.buy_ratio || 0.5;
  if (buyRatio > 0.75) score += 25;
  else if (buyRatio > 0.65) score += 20;
  else if (buyRatio > 0.55) score += 14;
  else if (buyRatio > 0.50) score += 8;
  else if (buyRatio > 0.40) score += 2;
  else return null;
  
  // GATE 4: LIQUIDITY (0-20 points)
  if (liq > 100000) score += 20;
  else if (liq > 50000) score += 18;
  else if (liq > 10000) score += 14;
  else if (liq > 5000) score += 10;
  else if (liq > 1000) score += 6;
  else score += 2;
  
  // GATE 5: MOMENTUM (0-20 points)
  const volumeVelocity = c.volume_velocity || 1;
  const priceVelocity = c.price_velocity || 1;
  let momentumScore = 0;
  
  if (volumeVelocity > 2) momentumScore += 10;
  else if (volumeVelocity > 1.2) momentumScore += 6;
  else if (volumeVelocity > 1) momentumScore += 2;
  
  if (priceVelocity > 1.5) momentumScore += 10;
  else if (priceVelocity > 1) momentumScore += 4;
  else if (priceVelocity > 0.7) momentumScore += 1;
  
  score += Math.min(20, momentumScore);
  
  // GATE 6: NAME (0-15 points)
  const hasSymbol = symbol.length > 0 && symbol.length < 20;
  const isMeme = symbol.toLowerCase().includes("coin") || 
                 symbol.toLowerCase().includes("inu") ||
                 symbol.toLowerCase().includes("dog");
  
  if (hasSymbol && !isMeme) score += 15;
  else if (hasSymbol && isMeme) score += 8;
  else score += 3;
  
  // GATE 7: MCAP (0-10 points)
  if (mcap > 100000) score += 3;
  else if (mcap > 10000) score += 8;
  else if (mcap > 1000) score += 10;
  else score += 5;

  // TIMEFRAME-SPECIFIC ADJUSTMENTS
  let tier = "COLD";
  let potential = 0;
  let riskLevel = "EXTREME";
  
  if (timeframe === "scalp" || timeframe === "day-trade") {
    // SCALP/DAY-TRADE: Pure momentum focus
    // Add hype score as bonus for quick flips
    const hypeScore = getHypeScore(symbol);
    score += Math.round(hypeScore / 5); // 0-20 bonus points
    
    if (score >= 110 && volumeVelocity > 1.5) {
      tier = "MEGA";
      potential = 10;
      riskLevel = "VERY_HIGH";
    } else if (score >= 90 && volumeVelocity > 1) {
      tier = "HUGE";
      potential = 5;
      riskLevel = "ULTRA_HIGH";
    } else if (score >= 70) {
      tier = "BIG";
      potential = 2;
      riskLevel = "EXTREME";
    } else if (score >= 55) {
      tier = "WARM";
      potential = 1;
      riskLevel = "EXTREME";
    } else {
      return null;
    }
  } else {
    // WEEK-HOLD & LONG-HOLD: Quality + momentum
    if (score >= 120 && buyRatio > 0.60 && holderTop10 < 3) {
      tier = "MEGA";
      potential = 10;
      riskLevel = "VERY_HIGH";
    } 
    else if (score >= 105 && buyRatio > 0.50 && holderTop10 < 5) {
      tier = "HUGE";
      potential = 5;
      riskLevel = "ULTRA_HIGH";
    }
    else if (score >= 90 && buyRatio > 0.45) {
      tier = "BIG";
      potential = 2;
      riskLevel = "EXTREME";
    }
    else if (score >= 75) {
      tier = "WARM";
      potential = 1;
      riskLevel = "EXTREME";
    }
    else {
      return null;
    }
  }

  const timeWindow = Math.max(0, 48 - (minutesOld / 60));
  const tier1Score = mint ? getTier1Score(mint, timeframe) : 50;
  const hypeScore = getHypeScore(symbol);

  return {
    ...c,
    score: Math.max(0, Math.min(150, score)),
    tier,
    potential,
    riskLevel,
    timeframe,
    timeWindowHours: timeWindow,
    minutesOld,
    volumeVelocity,
    priceVelocity,
    buyRatio,
    holderTop10,
    mcap,
    liq,
    hasCleanAuthorities: !c.mint_auth && !c.freeze_auth,
    tier1Score,
    tier1QualityRating: tier1Score < 20 ? "elite" : tier1Score < 40 ? "premium" : tier1Score < 60 ? "standard" : "risky",
    hypeScore,
    hypeRating: hypeScore >= 80 ? "viral" : hypeScore >= 60 ? "trending" : hypeScore >= 40 ? "warm" : "cold",
  };
}

async function fetchAndScoreEarlyCoins(timeframe: Timeframe = "long-hold") {
  const pool = getPool();

  const result = await pool.query(`
    SELECT
      c.id, t.symbol_label as symbol, t.mint, c.pool_id, c.discovered_at,
      EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
      EXTRACT(EPOCH FROM (now() - c.discovered_at))/3600::int as hours_old,
      COALESCE(pr.price_usd, 0) as price_usd,
      COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
      COALESCE(lq.liquidity_usd, 0) as liquidity_usd,
      COALESCE((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1)::numeric /
               NULLIF((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '1 hour' ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as volume_velocity,
      COALESCE(pr.price_usd::numeric / NULLIF((SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as price_velocity,
      COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
               NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
      (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
      (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
      (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10,
      c.current_state
    FROM candidates c
    JOIN tokens t ON t.id = c.token_id
    LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
    LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
    LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
    WHERE c.discovered_at > now() - interval '7 days'
      AND c.current_state <> 'EXPIRED'
    ORDER BY c.discovered_at DESC
    LIMIT 200
  `);

  const candidates: any[] = [];
  for (const row of result.rows) {
    const scored = await scoreEarlyCandidate(row, timeframe);
    if (scored) {
      scored.stealthScore = scoreStealthAccumulation(row);
      if (scored.stealthScore >= 0) {
        scored.dangerScore = scoreDeadcoinDanger(row);
        candidates.push(scored);
      }
    }
  }

  const tierOrder: Record<string, number> = { MEGA: 0, HUGE: 1, BIG: 2, WARM: 3, COLD: 4 };
  const sorted = candidates.sort((a: any, b: any) => {
    const tierDiff = (tierOrder[a.tier] || 999) - (tierOrder[b.tier] || 999);
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score;
  });

  return {
    candidates: sorted,
    totalScanned: result.rows.length,
    totalPassed: candidates.length
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const timeframe = (searchParams.get("timeframe") as Timeframe) || "long-hold";

    let data;
    try {
      data = await fetchAndScoreEarlyCoins(timeframe);
    } catch (cacheErr) {
      console.warn("[early-coins] Cache failed:", cacheErr);
      data = await fetchAndScoreEarlyCoins(timeframe);
    }

    const paginated = data.candidates.slice(offset, offset + limit);

    return NextResponse.json({
      candidates: paginated,
      timeframe,
      pagination: {
        offset,
        limit,
        total: data.candidates.length,
        hasMore: offset + limit < data.candidates.length
      },
      timestamp: new Date().toISOString(),
      totalScanned: data.totalScanned,
      totalPassed: data.totalPassed,
      note: `Multi-game Radar: timeframe=${timeframe}`
    }, {
      headers: {
        "Cache-Control": "public, max-age=30",
        "X-Cache": "server"
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[early-coins] Error:", msg);
    return NextResponse.json({
      candidates: [],
      error: "Failed to scan early coins",
      errorDetails: msg,
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
}
