import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function calculateRiskScore(coin: any): { score: number; level: string; label: string } {
  let riskScore = 5;
  
  const mcap = Number(coin.marketCapUsd || 0);
  const liq = Number(coin.liquidityUsd || 0);
  const topHolders = coin.topHolders || [];
  const discoveredAt = new Date(coin.discovered_at).getTime();
  const minutesOld = Math.floor((Date.now() - discoveredAt) / (1000 * 60));

  if (mcap > 0) {
    const liqRatio = liq / mcap;
    if (liqRatio < 0.05) riskScore += 3;
    else if (liqRatio < 0.10) riskScore += 2;
    else if (liqRatio < 0.15) riskScore += 1;
    else riskScore -= 1;
  }

  if (topHolders.length > 0) {
    const top1 = topHolders[0].pct || 0;
    if (top1 > 0.5) riskScore += 3;
    else if (top1 > 0.3) riskScore += 2;
    else if (top1 > 0.1) riskScore += 1;
  }

  if (minutesOld < 5) riskScore += 2;
  else if (minutesOld < 30) riskScore += 1;

  riskScore = Math.max(1, Math.min(10, riskScore));

  const level = riskScore <= 3 ? "SAFE" : riskScore <= 6 ? "MEDIUM" : "HIGH";
  const label = riskScore <= 3 ? "🟢" : riskScore <= 6 ? "🟡" : "🔴";

  return { score: Math.round(riskScore), level, label };
}

export async function GET() {
  try {
    const res = await internalFetch(`/api/candidates`, {
      cache: "no-store",
    });
    
    if (!res.ok) {
      return NextResponse.json({ 
        buy_signals: [], 
        signal_quality: "error",
      });
    }

    const data = await res.json();
    const candidates = data.candidates || [];

    const buySignals = candidates
      .map((c: any) => {
        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);
        const discoveredAt = new Date(c.discovered_at).getTime();
        const minutesOld = Math.floor((Date.now() - discoveredAt) / (1000 * 60));

        let buyScore = 0;
        const reasons: string[] = [];
        const redFlags: string[] = [];

        const topHolders = c.topHolders || [];
        if (topHolders.length > 0 && topHolders[0].pct > 0.6) {
          redFlags.push("Whale >60%");
        }
        if (topHolders.length >= 5) {
          const top5Sum = topHolders.slice(0, 5).reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
          if (top5Sum > 0.8) {
            redFlags.push("Top 5 >80%");
          }
        }

        // Only hard-reject unverified if mcap is VERY small
        if (!c.isVerified && mcap < 10000) {
          redFlags.push("Unverified (micro)");
        }

        if (minutesOld < 5) {
          buyScore += 25;
          reasons.push("🔥 Ultra fresh");
        } else if (minutesOld < 15) {
          buyScore += 18;
          reasons.push("⚡ Fresh");
        } else if (minutesOld < 60) {
          buyScore += 12;
          reasons.push("📊 Recent");
        } else if (minutesOld < 240) {
          buyScore += 6;
          reasons.push("Established");
        }

        const liqRatio = liq / Math.max(mcap, 1);
        if (liqRatio > 0.20) {
          buyScore += 20;
          reasons.push("Strong exit liq");
        } else if (liqRatio > 0.10) {
          buyScore += 15;
          reasons.push("Good liq");
        } else if (liqRatio > 0.05) {
          buyScore += 10;
          reasons.push("OK liq");
        } else if (liqRatio > 0.02) {
          buyScore += 4;
          reasons.push("Minimal liq");
        } else {
          redFlags.push("Low liq");
        }

        if (mcap > 0 && mcap < 30000) {
          buyScore += 18;
          reasons.push("Ultra-micro");
        } else if (mcap < 60000) {
          buyScore += 14;
          reasons.push("Micro");
        } else if (mcap < 200000) {
          buyScore += 8;
          reasons.push("Small");
        } else if (mcap < 500000) {
          buyScore += 4;
          reasons.push("Mid");
        }

        const risk = calculateRiskScore(c);
        const slippage = liq < 5000 ? "⚠️ RISKY (can't exit)" : liq < 20000 ? "⚠️ 5-8% slippage" : "✓ OK";

        return {
          symbol: c.symbol,
          mint: c.mint,
          marketCapUsd: mcap,
          liquidityUsd: liq,
          minutesOld,
          buy_score: buyScore,
          reasons: reasons.join(" | "),
          redFlags: redFlags.length > 0 ? redFlags.join(" | ") : null,
          strength: buyScore >= 50 ? "STRONG" : buyScore >= 30 ? "MODERATE" : "WEAK",
          risk: risk.label,
          riskLevel: risk.level,
          riskScore: risk.score,
          slippage: slippage,
          actionWindow: minutesOld < 5 ? "🔥 BUY NOW (5m)" : minutesOld < 15 ? "⚡ BUY SOON" : "Monitor",
        };
      })
      .filter((s: any) => {
        // Relaxed criteria: allow more coins through
        return s.buy_score >= 20 && !s.redFlags;
      })
      .sort((a: any, b: any) => {
        // Sort by freshness first, then strength
        if (Math.abs(a.minutesOld - b.minutesOld) > 10) {
          return a.minutesOld - b.minutesOld;
        }
        return b.buy_score - a.buy_score;
      })
      .slice(0, 30);

    return NextResponse.json({
      buy_signals: buySignals,
      signal_quality: buySignals.length > 8 ? "strong" : buySignals.length > 3 ? "moderate" : "weak",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Signals error:", err);
    return NextResponse.json({
      buy_signals: [],
      signal_quality: "error",
    });
  }
}
