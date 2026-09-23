import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function fetchDexScreenerData(mint: string) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, {
      next: { revalidate: 0 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.pairs?.[0] || null;
  } catch (e) {
    return null;
  }
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
        COALESCE((SELECT COUNT(*) FROM holder_snapshots WHERE holder_snapshots.pool_id = c.pool_id), 0)::int as holder_count,
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10_pct,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '1 minute'), 0)::int as txn_1m,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '5 minute'), 0)::int as txn_5m,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE pool_id = c.pool_id AND observed_at > now() - interval '10 minute'), 0)::int as txn_10m,
        COALESCE((SELECT COUNT(*) FROM transaction_aggregates WHERE pool_id = c.pool_id), 0)::int as txn_total,
        COALESCE((SELECT buys::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) / 
                 NULLIF((SELECT (buys + sells)::numeric FROM transaction_aggregates WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1), 0), 0.5)::float as buy_ratio,
        COALESCE((SELECT COUNT(*) FROM transaction_details WHERE pool_id = c.pool_id AND is_buy = true AND COALESCE(amount_usd, 0) > 1000 AND observed_at > now() - interval '5 minute'), 0)::int as whale_buys_5m,
        COALESCE((SELECT AVG(COALESCE(amount_usd, 0)) FROM transaction_details WHERE pool_id = c.pool_id AND is_buy = true AND COALESCE(amount_usd, 0) > 500), 0)::numeric as avg_buy_size
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
      WHERE c.discovered_at > now() - interval '60 minutes'
        AND c.current_state <> 'EXPIRED'
      ORDER BY c.discovered_at DESC
      LIMIT 300
    `);

    const enriched = await Promise.all(
      result.rows.map(async (c: any) => {
        const dex = await fetchDexScreenerData(c.mint);
        return { ...c, dexData: dex };
      })
    );

    const cateSignals = enriched
      .filter((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const buyRatio = Number(c.buy_ratio || 0.5);

        if (c.mint_auth || c.freeze_auth) return false;
        if (holderTop10 > 3) return false;
        if (holderCount < 2) return false;
        if (liq < 100) return false;
        if (mcap < 500 || mcap > 100000) return false;
        if (buyRatio < 0.50) return false;

        if (c.dexData?.priceChange?.h24 && c.dexData.priceChange.h24 < -75) return false;

        return true;
      })
      .map((c: any) => {
        const minutesOld = c.minutes_old || 1;
        const mcap = Number(c.market_cap_usd || 0);
        const liq = Number(c.liquidity_usd || 0);
        const holderCount = Number(c.holder_count || 0);
        const holderTop10 = c.holder_top10_pct || 100;
        const buyRatio = Number(c.buy_ratio || 0.5);
        const txn1m = Number(c.txn_1m || 0);
        const txn5m = Number(c.txn_5m || 0);
        const txn10m = Number(c.txn_10m || 0);
        const txnTotal = Number(c.txn_total || 0);
        const whaleByus5m = Number(c.whale_buys_5m || 0);
        const avgBuySize = Number(c.avg_buy_size || 0);

        const txnDensity = txnTotal / Math.max(1, mcap / 1000);
        const txnVelocity = txn1m / Math.max(1, minutesOld / 60);
        const hypeAccel = txn5m > 0 ? (txn1m / (txn5m / 5)) : 0;  // Acceleration factor
        const whaleActivity = whaleByus5m > 0 ? whaleByus5m * (avgBuySize / 1000) : 0;  // Whale intensity
        const holderGrowthScore = holderCount > 20 ? 1 : holderCount > 10 ? 0.7 : holderCount > 5 ? 0.5 : 0.2;
        const distributionScore = holderTop10 < 1 ? 1 : holderTop10 < 2 ? 0.9 : 0.5;

        let cateScore = 0;

        // DISCOVERY TIMING (0-20)
        if (minutesOld < 1) cateScore += 20;
        else if (minutesOld < 2) cateScore += 18;
        else if (minutesOld < 5) cateScore += 15;
        else if (minutesOld < 15) cateScore += 10;
        else if (minutesOld < 30) cateScore += 5;
        else cateScore += 2;

        // TXN DENSITY (0-25)
        if (txnDensity > 300) cateScore += 25;
        else if (txnDensity > 150) cateScore += 20;
        else if (txnDensity > 50) cateScore += 15;
        else if (txnDensity > 20) cateScore += 10;
        else if (txnDensity > 5) cateScore += 5;

        // TXN VELOCITY (0-20)
        if (txnVelocity > 100) cateScore += 20;
        else if (txnVelocity > 50) cateScore += 16;
        else if (txnVelocity > 20) cateScore += 12;
        else if (txnVelocity > 5) cateScore += 8;
        else if (txnVelocity > 1) cateScore += 4;

        // HYPE ACCELERATION (0-15) - NEW
        if (hypeAccel > 3) cateScore += 15;
        else if (hypeAccel > 2) cateScore += 12;
        else if (hypeAccel > 1.5) cateScore += 10;
        else if (hypeAccel > 1) cateScore += 6;

        // WHALE ACTIVITY (0-15) - NEW
        if (whaleActivity > 10) cateScore += 15;
        else if (whaleActivity > 5) cateScore += 12;
        else if (whaleActivity > 2) cateScore += 8;
        else if (whaleActivity > 0) cateScore += 4;

        // BUY PRESSURE (0-15)
        if (buyRatio > 0.85) cateScore += 15;
        else if (buyRatio > 0.75) cateScore += 12;
        else if (buyRatio > 0.65) cateScore += 8;
        else if (buyRatio > 0.55) cateScore += 4;

        // HOLDER GROWTH (0-10)
        cateScore += holderGrowthScore * 10;

        // DISTRIBUTION (0-10)
        cateScore += distributionScore * 10;

        // LIQUIDITY (0-5)
        const liqRatio = liq / Math.max(1, mcap);
        if (liqRatio > 0.15) cateScore += 5;
        else if (liqRatio > 0.08) cateScore += 3;
        else if (liqRatio > 0.04) cateScore += 1;

        let tier = "📊 WATCH";
        let emoji = "🔔";
        if (cateScore >= 90) {
          tier = "🚀 ELITE";
          emoji = "⚡";
        } else if (cateScore >= 75) {
          tier = "🔥 HOT";
          emoji = "🔥";
        } else if (cateScore >= 60) {
          tier = "⚡ RISING";
          emoji = "📈";
        }

        return {
          symbol: c.symbol,
          mint: c.mint,
          minutesOld,
          mcap,
          liquidity: liq,
          holderCount,
          holderTop10,
          buyRatio: Math.round(buyRatio * 100),
          txn1m,
          txn5m,
          txnTotal,
          txnDensity: Number((txnDensity).toFixed(2)),
          txnVelocity: Number((txnVelocity).toFixed(2)),
          hypeAccel: Number((hypeAccel).toFixed(2)),
          whaleActivity: Number((whaleActivity).toFixed(2)),
          whaleCount: whaleByus5m,
          cateScore: Math.round(cateScore),
          tier,
          emoji,
          risk: cateScore >= 80 ? "🟢 LOW" : cateScore >= 60 ? "🟡 MEDIUM" : "🔴 HIGH",
        };
      })
      .sort((a: any, b: any) => b.cateScore - a.cateScore);

    return NextResponse.json(
      {
        cateCoins: cateSignals.slice(0, 50),
        summary: {
          elite: cateSignals.filter(c => c.tier === "🚀 ELITE").length,
          hot: cateSignals.filter(c => c.tier === "🔥 HOT").length,
          rising: cateSignals.filter(c => c.tier === "⚡ RISING").length,
          watch: cateSignals.filter(c => c.tier === "📊 WATCH").length,
          scanned: result.rows.length,
          passed: cateSignals.length,
        }
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("CATE Hunter error:", err);
    return NextResponse.json({ error: "Failed", cateCoins: [], summary: {} }, { status: 200 });
  }
}
