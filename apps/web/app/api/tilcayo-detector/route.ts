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
        tilcayoCandidates: [],
        analysis: {},
      });
    }

    const data = await res.json();
    const coins = data.cateCoins || [];

    // TILCAYO PATTERN DETECTION
    // Real winners show: ultra-fresh + micro-cap + strong liquidity + immediate price discovery
    // Characteristics:
    // - <3 min old (first wave entry)
    // - <$20k mcap (explosive potential)
    // - >12% liquidity ratio (can exit)
    // - RISING or ELITE tier (good scoring)

    const tilcayoCandidates = coins
      .map((c: any, idx: number) => {
        const score = 0;
        const signals: string[] = [];
        
        // PRIMARY: Extreme freshness
        if (c.minutesOld <= 1) {
          signals.push("🔥 Inception block");
        } else if (c.minutesOld <= 2) {
          signals.push("🌋 Extreme early");
        } else if (c.minutesOld <= 3) {
          signals.push("⚡ Ultra early");
        }

        // SECONDARY: Micro-cap with momentum
        if (c.mcap < 15000) {
          signals.push("💎 <$15k - Max upside");
        } else if (c.mcap < 30000) {
          signals.push("⭐ <$30k micro");
        }

        // TERTIARY: Exit liquidity ready
        const liqPct = (c.liquidity / Math.max(c.mcap, 1)) * 100;
        if (liqPct > 15) {
          signals.push(`✅ ${liqPct.toFixed(0)}% liq - safe exit`);
        } else if (liqPct > 10) {
          signals.push(`⚠️  ${liqPct.toFixed(0)}% liq - tight exit`);
        }

        // PATTERN MATCH: All three conditions = Tilcayo candidate
        const isTilcayo = signals.length >= 3 && c.cateScore >= 70;

        return {
          rank: idx + 1,
          symbol: c.symbol,
          mint: c.mint,
          minutesOld: c.minutesOld,
          mcap: c.mcap,
          liquidity: c.liquidity,
          cateScore: c.cateScore,
          tier: c.tier,
          signals,
          isTilcayo,
          tilcayoScore: isTilcayo ? Math.round(c.cateScore * (1 + c.minutesOld / 100)) : 0,
        };
      })
      .filter((c: any) => c.isTilcayo)
      .sort((a: any, b: any) => b.tilcayoScore - a.tilcayoScore)
      .slice(0, 5); // Top 5 Tilcayo candidates

    return NextResponse.json({
      tilcayoCandidates,
      analysis: {
        scanned: coins.length,
        tilcayo_found: tilcayoCandidates.length,
        recommendation: tilcayoCandidates.length > 0 ? "SCAN NOW" : "WAITING",
        topTilcayo: tilcayoCandidates.length > 0 ? `${tilcayoCandidates[0].symbol} (${tilcayoCandidates[0].minutesOld}min old)` : "None",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Tilcayo error:", err);
    return NextResponse.json({
      error: String(err),
      tilcayoCandidates: [],
      analysis: {},
    });
  }
}
