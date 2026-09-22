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
        COALESCE(lq_peak.liquidity_usd, lq.liquidity_usd, 0) as peak_liquidity_usd,
        COALESCE(pr_first.price_usd, pr.price_usd, 0) as discovery_price_usd,
        COALESCE(pr_peak.price_usd, pr.price_usd, 0) as peak_price_usd,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '5 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as buys_5m,
        COALESCE((SELECT buys FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_buys,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0)::int as total_sells,
        COALESCE((SELECT sells FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '10 minutes' ORDER BY observed_at DESC LIMIT 1), 0)::int as sells_10m,
        COALESCE((SELECT COUNT(*) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '5 minutes'), 0)::int as txn_5m,
        COALESCE((SELECT COUNT(*) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '10 minutes'), 0)::int as txn_10m,
        COALESCE((SELECT COUNT(*) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '30 minutes'), 0)::int as txn_30m,
        COALESCE((SELECT COUNT(*) FROM transaction_detail WHERE pool_id = c.pool_id AND observed_at > now() - interval '60 minutes'), 0)::int as txn_60m,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        EXTRACT(EPOCH FROM (now() - (SELECT observed_at FROM transaction_detail WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1)))/60::int as minutes_since_last_txn,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT price_usd FROM prices WHERE pool_id = c.pool_id AND observed_at >= c.discovered_at ORDER BY observed_at ASC LIMIT 1) pr_first ON true
      LEFT JOIN LATERAL (SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY price_usd DESC LIMIT 1) pr_peak ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY liquidity_usd DESC LIMIT 1) lq_peak ON true
      WHERE c.discovered_at > now() - interval '48 hours'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 200
    `);

    const scored = result.rows.map((c: any) => {
      const red_flags = [];
      const minutesOld = c.minutes_old || 0;

      // Age gate: too young = risky (before early pumpers exit)
      if (minutesOld < 5) {
        red_flags.push(`TOO YOUNG: Only ${minutesOld}m old (risky)`);
      }

      // Dead coin detection
      const txn5m = c.txn_5m || 0;
      const txn10m = c.txn_10m || 0;
      const txn30m = c.txn_30m || 0;
      const txn60m = c.txn_60m || 0;
      const minutesSinceLastTxn = c.minutes_since_last_txn || 999;

      // Volume cliff: activity drops from 50+ to <5 txn (pump & dump)
      if (txn10m > 20 && txn5m < 3) {
        red_flags.push(`CLIFF: Activity dropped from ${txn10m} → ${txn5m} txn`);
      }

      if (minutesSinceLastTxn > 30) {
        red_flags.push(`DEAD: No txn for ${minutesSinceLastTxn}m`);
      } else if (minutesSinceLastTxn > 15) {
        red_flags.push(`Stagnant: No txn for ${minutesSinceLastTxn}m`);
      } else if (txn30m < 5) {
        red_flags.push(`Very low activity: ${txn30m} txn/30m`);
      }

      // Liquidity drain detection
      const currentLiquidity = c.liquidity_usd || 0;
      const peakLiquidity = c.peak_liquidity_usd || currentLiquidity || 1;
      const liquidityRetention = peakLiquidity > 0 ? currentLiquidity / peakLiquidity : 1;

      if (liquidityRetention < 0.2) {
        red_flags.push(`Drained: ${(liquidityRetention * 100).toFixed(0)}% liquidity left`);
      } else if (liquidityRetention < 0.5) {
        red_flags.push(`Draining: ${(liquidityRetention * 100).toFixed(0)}% liquidity left`);
      }

      // Momentum reversal: peaked and now dumping (classic pump & dump)
      const currentPrice = c.price_usd || 0;
      const peakPrice = c.peak_price_usd || currentPrice || 1;
      const discoveryPrice = c.discovery_price_usd || currentPrice || 1;
      const priceVelocity = discoveryPrice > 0 ? currentPrice / discoveryPrice : 1;
      const peakToCurrentDrop = peakPrice > 0 ? (1 - currentPrice / peakPrice) * 100 : 0;
      const peakGain = discoveryPrice > 0 ? (peakPrice / discoveryPrice - 1) * 100 : 0;

      // Detect if peaked and crashed (pump & dump signature)
      if (peakGain > 50 && peakToCurrentDrop > 40) {
        red_flags.push(`DUMP PATTERN: Peaked +${peakGain.toFixed(0)}%, now -${peakToCurrentDrop.toFixed(0)}%`);
      }

      const priceDropPct = Math.max(0, (1 - priceVelocity) * 100);
      if (priceVelocity < 0.5) {
        red_flags.push(`DUMP: Price -${priceDropPct.toFixed(0)}% from discovery`);
      } else if (priceVelocity < 0.75) {
        red_flags.push(`Price down ${priceDropPct.toFixed(0)}%`);
      }

      // Sell-to-buy ratio: overall dump pressure
      const totalBuys = c.total_buys || 1;
      const totalSells = c.total_sells || 0;
      const sellToBuyRatio = totalSells / Math.max(1, totalBuys);
      const sells10m = c.sells_10m || 0;

      if (sellToBuyRatio > 1.5) {
        red_flags.push(`DUMP PRESSURE: ${sellToBuyRatio.toFixed(1)}x more sells than buys`);
      } else if (sellToBuyRatio > 1.0) {
        red_flags.push(`Sell pressure: ${sellToBuyRatio.toFixed(1)}x sell-to-buy`);
      }

      if (sells10m > totalBuys * 0.5 && sells10m > 3) {
        red_flags.push(`Sell spike: ${sells10m} sells`);
      }

      // Low market cap + other issues = lost cause
      const mcap = c.market_cap_usd || 0;
      if (mcap < 5000 && red_flags.length >= 2) {
        red_flags.push("LOST CAUSE: Low mcap + multiple issues");
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

      // Age penalty: too young = risky
      if (minutesOld < 5) score -= 150;

      // Volume cliff: major dump signature
      if (txn10m > 20 && txn5m < 3) score -= 200;

      // Heavily penalize dead coins
      if (minutesSinceLastTxn > 30) score -= 200;
      else if (minutesSinceLastTxn > 15) score -= 100;
      else if (txn30m < 5) score -= 80;

      // Penalize liquidity drain
      if (liquidityRetention < 0.2) score -= 150;
      else if (liquidityRetention < 0.5) score -= 75;

      // Momentum reversal: peaked and dumped
      if (peakGain > 50 && peakToCurrentDrop > 40) score -= 180;

      // Dump pressure (sell-to-buy ratio)
      if (sellToBuyRatio > 1.5) score -= 100;
      else if (sellToBuyRatio > 1.0) score -= 50;

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
        peak_gain_pct: peakGain.toFixed(1),
        peak_to_current_drop_pct: peakToCurrentDrop.toFixed(1),
        sell_to_buy_ratio: sellToBuyRatio.toFixed(2),
        liquidity_retention: (liquidityRetention * 100).toFixed(0),
        activity_5m: txn5m,
        activity_10m: txn10m,
        activity_30m: txn30m,
        minutes_since_activity: minutesSinceLastTxn,
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
