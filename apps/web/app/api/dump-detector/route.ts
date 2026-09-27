import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface DumpAnalysis {
  mint: string;
  symbol: string;
  hasDumpPattern: boolean;
  dumpRisk: string; // CRITICAL | HIGH | MEDIUM | LOW
  indicators: string[];
  recommendation: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");
    
    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const analysis: DumpAnalysis = {
      mint,
      symbol: "?",
      hasDumpPattern: false,
      dumpRisk: "LOW",
      indicators: [],
      recommendation: "MONITOR",
    };

    // Check from DexScreener API (free)
    try {
      const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
        .then(r => r.json())
        .catch(() => null);

      if (dsRes?.pairs && dsRes.pairs.length > 0) {
        const pair = dsRes.pairs[0];
        analysis.symbol = pair.baseToken?.symbol || "?";

        // === DUMP PATTERN DETECTION ===

        // RED FLAG #1: Large single sell candle
        // Indicators: high volume spike on red candle
        if (pair.volume?.h24 && pair.txns?.h24) {
          const avgTradeSize = (pair.volume?.h24 || 0) / Math.max(pair.txns?.h24?.buys || 1, 1);
          
          // If average sell is huge relative to buys
          if (pair.txns?.h24?.sells && pair.txns?.h24?.buys) {
            const sellToBuyRatio = pair.txns.h24.sells / Math.max(pair.txns.h24.buys, 1);
            
            if (sellToBuyRatio > 2) {
              analysis.indicators.push("🔴 High sell/buy ratio (2:1 or worse)");
              analysis.dumpRisk = "CRITICAL";
              analysis.hasDumpPattern = true;
            }
          }
        }

        // RED FLAG #2: Price dropped significantly from ATH
        // (Would need price history - using txn pattern as proxy)
        if (pair.txns?.h1?.sells && pair.txns?.h1?.buys) {
          if (pair.txns.h1.sells > pair.txns.h1.buys * 3) {
            analysis.indicators.push("🔴 DUMP in last hour (3:1 sell:buy)");
            analysis.dumpRisk = "CRITICAL";
            analysis.hasDumpPattern = true;
          }
        }

        // RED FLAG #3: Massive volume spike (pump signal)
        const h1Vol = pair.volume?.h1 || 0;
        const h24Vol = pair.volume?.h24 || 0;
        if (h24Vol > 0 && h1Vol > h24Vol * 0.3) {
          analysis.indicators.push("⚠️ Massive volume concentration in 1 hour");
          if (analysis.dumpRisk === "CRITICAL") {
            analysis.indicators.push("🚨 PUMP & DUMP PATTERN DETECTED");
          }
        }

        // RED FLAG #4: Very old with low price
        // Token that pumped then crashed to nothing
        const age = pair.pairCreatedAt ? 
          (Date.now() - new Date(pair.pairCreatedAt).getTime()) / (1000 * 60) : null;
        
        if (age && age > 120 && pair.priceUsd && Number(pair.priceUsd) < 0.00001) {
          analysis.indicators.push("⚠️ Abandoned pump & dump (dead price)");
          analysis.dumpRisk = "CRITICAL";
        }

        // GREEN FLAG: Still accumulating
        if (pair.txns?.h1?.buys && pair.txns?.h1?.sells) {
          if (pair.txns.h1.buys > pair.txns.h1.sells * 1.5) {
            analysis.indicators.push("✅ Buy accumulation (more buys than sells)");
            analysis.dumpRisk = "LOW";
            analysis.hasDumpPattern = false;
          }
        }
      }
    } catch (err) {
      console.error("DexScreener API error:", err);
    }

    // === FINAL ASSESSMENT ===
    if (analysis.hasDumpPattern || analysis.dumpRisk === "CRITICAL") {
      analysis.recommendation = "HARD AVOID - PUMP & DUMP DETECTED";
    } else if (analysis.dumpRisk === "HIGH") {
      analysis.recommendation = "AVOID - High dump risk";
    } else if (analysis.dumpRisk === "MEDIUM") {
      analysis.recommendation = "CAUTION - Monitor for dump";
    } else {
      analysis.recommendation = "MONITOR - No dump pattern detected";
    }

    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Dump detector error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
