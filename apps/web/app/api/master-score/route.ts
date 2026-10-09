import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cateRes = await internalFetch(`/api/cate-hunter`, {
      cache: "no-store",
    });
    
    if (!cateRes.ok) {
      return NextResponse.json({
        error: "Failed",
        scores: [],
        summary: {},
      });
    }

    const cateData = await cateRes.json();
    const coins = cateData.cateCoins || [];

    // MASTER SCORING: Combines CATE + Risk + Pattern analysis
    const scores = coins
      .map((c: any) => {
        let masterScore = 0;
        const components: any = {};

        // === COMPONENT 1: CATE Score (0-40 weight) ===
        let cateNormalized = Math.min(100, c.cateScore) / 100 * 40;
        if (c.cateScore >= 90) cateNormalized = 40;
        else if (c.cateScore >= 75) cateNormalized = 35;
        else if (c.cateScore >= 60) cateNormalized = 30;
        components.cate = cateNormalized;
        masterScore += cateNormalized;

        // === COMPONENT 2: Risk Assessment (0-30 weight) ===
        let riskPenalty = 0;
        
        // Check for critical red flags
        if (c.issues) {
          const issues = c.issues.split("|").map((s: string) => s.trim());
          if (issues.some(i => i.includes(">40%"))) riskPenalty += 25; // Single holder rug
          if (issues.some(i => i.includes("1T+"))) riskPenalty += 25; // Supply manipulation
          if (issues.some(i => i.includes("trap"))) riskPenalty += 20; // Liquidity trap
          if (issues.some(i => i.includes("Unverified"))) riskPenalty += 12; // Unverified
        }
        
        // Honeypot risk (would check via API in production)
        // riskPenalty already accounted for in issues
        
        let riskScore = Math.max(0, 30 - riskPenalty);
        components.risk = riskScore;
        masterScore += riskScore;

        // === COMPONENT 3: Momentum (0-20 weight) ===
        let momentumScore = 0;
        if (c.minutesOld < 2) momentumScore = 20; // Inception
        else if (c.minutesOld < 5) momentumScore = 18;
        else if (c.minutesOld < 10) momentumScore = 14;
        else if (c.minutesOld < 20) momentumScore = 10;
        else if (c.minutesOld < 60) momentumScore = 5;
        components.momentum = momentumScore;
        masterScore += momentumScore;

        // === COMPONENT 4: Tier Quality Bonus (0-10 weight) ===
        let tierScore = 0;
        if (c.tier === "🚀 ELITE") tierScore = 10;
        else if (c.tier === "🔥 HOT") tierScore = 8;
        else if (c.tier === "⚡ RISING") tierScore = 6;
        else if (c.tier === "📊 WATCH") tierScore = 3;
        components.tier = tierScore;
        masterScore += tierScore;

        // === FINAL SCORE (0-100) ===
        masterScore = Math.round(masterScore);
        
        // === CONFIDENCE RATING ===
        let confidence = "MODERATE";
        if (masterScore >= 85) confidence = "VERY HIGH";
        else if (masterScore >= 70) confidence = "HIGH";
        else if (masterScore >= 55) confidence = "MODERATE";
        else confidence = "LOW";

        // === RECOMMENDATION ===
        let recommendation = "HOLD";
        if (masterScore >= 85 && c.minutesOld < 5) recommendation = "STRONG BUY (MOON)";
        else if (masterScore >= 75 && c.minutesOld < 10) recommendation = "BUY (MOMENTUM)";
        else if (masterScore >= 65) recommendation = "CONSIDER";
        else if (masterScore >= 50) recommendation = "CAUTION";
        else recommendation = "AVOID";

        return {
          symbol: c.symbol,
          mint: c.mint,
          masterScore,
          confidence,
          recommendation,
          minutesOld: c.minutesOld,
          mcap: c.mcap,
          liquidity: c.liquidity,
          cateScore: c.cateScore,
          components,
          issues: c.issues || "none",
        };
      })
      .sort((a: any, b: any) => b.masterScore - a.masterScore)
      .slice(0, 50);

    // === SUMMARY ===
    const summary = {
      total: scores.length,
      strongBuy: scores.filter(s => s.recommendation === "STRONG BUY (MOON)").length,
      buy: scores.filter(s => s.recommendation === "BUY (MOMENTUM)").length,
      consider: scores.filter(s => s.recommendation === "CONSIDER").length,
      caution: scores.filter(s => s.recommendation === "CAUTION").length,
      avoid: scores.filter(s => s.recommendation === "AVOID").length,
      topScore: scores.length > 0 ? scores[0].masterScore : 0,
      topCoin: scores.length > 0 ? scores[0].symbol : "NONE",
      marketQuality: scores.filter(s => s.masterScore >= 75).length > 0 ? "STRONG" : "MODERATE",
    };

    return NextResponse.json({
      scores,
      summary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Master score error:", err);
    return NextResponse.json({
      error: String(err),
      scores: [],
      summary: {},
    });
  }
}
