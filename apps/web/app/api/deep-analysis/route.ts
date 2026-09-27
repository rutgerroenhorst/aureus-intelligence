import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CoinAnalysis {
  mint: string;
  symbol: string;
  riskScore: number; // 0-100 (higher = more risky)
  riskLevel: string; // CRITICAL | HIGH | MEDIUM | LOW
  redFlags: string[];
  greenFlags: string[];
  recommendation: string; // AVOID | CAUTION | MODERATE | STRONG
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");
    
    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const analysis: CoinAnalysis = {
      mint,
      symbol: "?",
      riskScore: 50,
      riskLevel: "MEDIUM",
      redFlags: [],
      greenFlags: [],
      recommendation: "MODERATE",
    };

    // Analyze from CATE hunter
    try {
      const cateRes = await fetch("http://localhost:3000/api/cate-hunter", {
        cache: "no-store",
      });
      
      if (cateRes.ok) {
        const cateData = await cateRes.json();
        const coin = (cateData.cateCoins || []).find((c: any) => c.mint === mint);
        
        if (coin) {
          analysis.symbol = coin.symbol;
          
          // === RED FLAGS ANALYSIS ===
          
          // Red flag: unverified contract
          if (coin.issues?.includes("Unverified")) {
            analysis.redFlags.push("❌ Unverified contract");
            analysis.riskScore += 15;
          }
          
          // Red flag: hidden concentration
          if (coin.issues?.includes("Top 5") || coin.issues?.includes(">70%")) {
            analysis.redFlags.push("❌ Hidden centralization (top 5 >70%)");
            analysis.riskScore += 25;
          }
          
          // Red flag: single whale holder
          if (coin.issues?.includes(">40%")) {
            analysis.redFlags.push("❌ Single holder >40% (rug vector)");
            analysis.riskScore += 40;
          }
          
          // Red flag: liquidity trap
          if (coin.issues?.includes("Liquidity trap")) {
            analysis.redFlags.push("❌ Liquidity trap (<2%)");
            analysis.riskScore += 35;
          }
          
          // Red flag: old token (momentum dead)
          if (coin.minutesOld > 60) {
            analysis.redFlags.push("⚠️  Momentum fading (>60min)");
            analysis.riskScore += 10;
          }
          
          // Red flag: high mcap (moon already happened)
          if (coin.mcap > 200000) {
            analysis.redFlags.push("⚠️  Mcap too high ($200k+, limited upside)");
            analysis.riskScore += 12;
          }
          
          // === GREEN FLAGS ===
          
          // Green flag: excellent tier
          if (coin.cateScore >= 85) {
            analysis.greenFlags.push("✅ High quality score (85+)");
            analysis.riskScore -= 20;
          }
          
          // Green flag: micro-cap
          if (coin.mcap < 25000) {
            analysis.greenFlags.push("✅ Explosive potential (<$25k)");
            analysis.riskScore -= 15;
          }
          
          // Green flag: good liquidity
          if (coin.liquidity / Math.max(coin.mcap, 1) > 0.15) {
            analysis.greenFlags.push("✅ Safe exit liquidity (>15%)");
            analysis.riskScore -= 10;
          }
          
          // Green flag: ultra-fresh
          if (coin.minutesOld < 5) {
            analysis.greenFlags.push("✅ Inception early entry (<5min)");
            analysis.riskScore -= 15;
          }
          
          // Green flag: rising tier
          if (coin.cateScore >= 70) {
            analysis.greenFlags.push("✅ RISING+ tier quality");
            analysis.riskScore -= 10;
          }
        }
      }
    } catch (err) {
      console.error("CATE analysis error:", err);
    }

    // Analyze from honeypot check
    try {
      const hpRes = await fetch(`http://localhost:3000/api/honeypot-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, symbol: analysis.symbol }),
      }).catch(() => null);
      
      if (hpRes?.ok) {
        const hpData = await hpRes.json();
        if (hpData.isHoneypot) {
          analysis.redFlags.push("🚨 HONEYPOT DETECTED");
          analysis.riskScore = 100;
        }
        if (hpData.warnings?.length > 0) {
          hpData.warnings.forEach((w: string) => {
            analysis.redFlags.push("⚠️  " + w);
            analysis.riskScore += 10;
          });
        }
      }
    } catch (err) {}

    // === FINAL SCORING ===
    analysis.riskScore = Math.max(0, Math.min(100, analysis.riskScore));
    
    if (analysis.riskScore >= 75) {
      analysis.riskLevel = "CRITICAL";
      analysis.recommendation = "AVOID";
    } else if (analysis.riskScore >= 60) {
      analysis.riskLevel = "HIGH";
      analysis.recommendation = "CAUTION";
    } else if (analysis.riskScore >= 40) {
      analysis.riskLevel = "MEDIUM";
      analysis.recommendation = "MODERATE";
    } else {
      analysis.riskLevel = "LOW";
      analysis.recommendation = "STRONG";
    }

    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Deep analysis error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
