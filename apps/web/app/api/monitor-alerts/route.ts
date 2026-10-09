import { NextResponse } from "next/server";
import { getPool, withCache } from "@aureus/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CoinData {
  mint: string;
  symbol: string;
  score: number;
  stealthScore: number;
  dangerScore: number;
  market_cap_usd: number;
  minutesOld: number;
}

function getStatus(coin: CoinData): "READY" | "RISKY" | "EARLY" {
  if (coin.dangerScore > 40) return "RISKY";
  if ((coin.minutesOld || 0) / (60 * 24) < 3) return "EARLY";
  return "READY";
}

async function fetchEarlyCoins() {
  const pool = getPool();
  const result = await pool.query(`
    SELECT
      c.id, t.symbol_label as symbol, t.mint, c.pool_id, c.discovered_at,
      EXTRACT(EPOCH FROM (now() - c.discovered_at))/60::int as minutes_old,
      COALESCE(pr.market_cap_usd, 0) as market_cap_usd,
      COALESCE(pr.price_usd::numeric / NULLIF((SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as price_velocity,
      COALESCE((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1)::numeric /
               NULLIF((SELECT volume_usd FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '1 hour' ORDER BY observed_at ASC LIMIT 1)::numeric, 0), 1)::float as volume_velocity,
      COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
               NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
      (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10
    FROM candidates c
    JOIN tokens t ON t.id = c.token_id
    LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
    LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
    WHERE c.discovered_at > now() - interval '14 days'
      AND c.current_state <> 'EXPIRED'
    LIMIT 200
  `);

  return result.rows;
}

export async function GET(request: Request) {
  try {
    // Get all coins
    const coins = await fetchEarlyCoins();

    // For this POC, we'll just return status of coins
    // In production, this would check against stored watchlists and send alerts
    const alerts = coins
      .map((coin: any) => {
        const score = Math.min(150, Math.random() * 150); // Placeholder scoring
        const stealthScore = Math.min(155, Math.random() * 155);
        const dangerScore = Math.min(100, Math.random() * 100);

        return {
          mint: coin.mint,
          symbol: coin.symbol,
          status: getStatus({
            ...coin,
            score,
            stealthScore,
            dangerScore
          }),
          quality: score,
          velocity: stealthScore,
          danger: dangerScore,
          mcap: coin.market_cap_usd,
          age_days: coin.minutes_old / (60 * 24)
        };
      })
      .filter(
        (c) =>
          c.status === "READY" &&
          c.quality > 120 &&
          c.velocity > 100 &&
          c.age_days >= 3 &&
          c.age_days <= 8
      )
      .slice(0, 10);

    return NextResponse.json({
      monitored: coins.length,
      readyForAlert: alerts.length,
      alerts,
      note: "This endpoint checks coins that are READY for alerts. In production, it would also cross-reference user watchlists and send Telegram/Discord notifications.",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[monitor-alerts] Error:", msg);
    return NextResponse.json(
      { error: msg, monitored: 0, alerts: [] },
      { status: 200 }
    );
  }
}
