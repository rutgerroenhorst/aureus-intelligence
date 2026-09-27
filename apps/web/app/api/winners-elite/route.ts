import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("http://localhost:3000/api/cate-hunter", {
      cache: "no-store",
    });
    
    if (!res.ok) {
      return NextResponse.json({
        error: "Failed",
        winners: [],
        summary: { count: 0, topScore: 0 },
      });
    }

    const data = await res.json();
    const allCoins = data.cateCoins || [];

    // ULTRA-STRICT FILTERING for top 1% candidates
    // Only coins that show Tilcayo pattern characteristics:
    // - Ultra fresh (<5 min old)
    // - Very small market cap (<$30k)
    // - Strong liquidity ratio (>10%)
    // - Ready to moon

    const winners = allCoins
      .filter((c: any) => {
        // MUST be ultra-fresh
        if (c.minutesOld > 5) return false;
        
        // MUST be micro-cap (<$30k for max upside)
        if (c.mcap > 30000) return false;
        
        // MUST have real liquidity (can exit safely)
        if (c.liquidity / Math.max(c.mcap, 1) < 0.10) return false;
        
        // MUST be RISING tier or better
        if (c.cateScore < 70) return false;
        
        return true;
      })
      .sort((a: any, b: any) => {
        // Rank by: freshness first, then by score
        const freshnessScore = (a.minutesOld > b.minutesOld) ? 1 : -1;
        if (freshnessScore !== 0) return freshnessScore;
        return b.cateScore - a.cateScore;
      })
      .slice(0, 10); // Top 10 only

    return NextResponse.json({
      winners: winners.map((c: any) => ({
        symbol: c.symbol,
        mint: c.mint,
        minutesOld: c.minutesOld,
        mcap: c.mcap,
        liquidity: c.liquidity,
        cateScore: c.cateScore,
        tier: c.tier,
        reason: `Fresh ${c.minutesOld}min, mcap $${c.mcap.toLocaleString()}, liq ratio ${(c.liquidity / Math.max(c.mcap, 1) * 100).toFixed(1)}%`,
      })),
      summary: {
        count: winners.length,
        topScore: winners.length > 0 ? winners[0].cateScore : 0,
        quality: winners.length === 0 ? "none" : winners.length < 3 ? "rare" : "common",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Winners error:", err);
    return NextResponse.json({
      error: String(err),
      winners: [],
      summary: { count: 0, topScore: 0, quality: "error" },
    });
  }
}
