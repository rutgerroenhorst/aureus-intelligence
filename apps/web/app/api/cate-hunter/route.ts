import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const txnCache = new Map<string, {data: any, time: number}>();
const TXN_CACHE_TTL = 60000;

async function getTxnsData(mint: string): Promise<any> {
  try {
    const cached = txnCache.get(mint);
    if (cached && Date.now() - cached.time < TXN_CACHE_TTL) {
      return cached.data;
    }

    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(3000) }
    );
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const pair = data.pairs?.[0];
    
    if (!pair?.txns) return null;
    
    const txns = {
      m5: pair.txns.m5,
      h1: pair.txns.h1,
      h6: pair.txns.h6,
      h24: pair.txns.h24,
    };
    
    txnCache.set(mint, { data: txns, time: Date.now() });
    return txns;
  } catch (err) {
    return null;
  }
}

export async function GET() {
  try {
    const allRes = await fetch("http://localhost:3000/api/candidates", {
      cache: "no-store",
    });

    if (!allRes.ok) {
      return NextResponse.json({
        error: "Failed",
        cateCoins: [],
        summary: { elite: 0, hot: 0, rising: 0, watch: 0, scanned: 0, passed: 0 },
      });
    }

    const allData = await allRes.json();
    const allCandidates = allData.candidates || [];

    const safeRes = await fetch("http://localhost:3000/api/safety-gate", {
      cache: "no-store",
    });

    if (!safeRes.ok) {
      return NextResponse.json({
        error: "Safety gate failed",
        cateCoins: [],
        summary: { elite: 0, hot: 0, rising: 0, watch: 0, scanned: 0, passed: 0 },
      });
    }

    const safeData = await safeRes.json();
    const candidates = safeData.safe_candidates || [];

    const now = Date.now();
    const freshCandidates = candidates.filter((c: any) => {
      const minutesOld = Math.floor((now - new Date(c.discovered_at).getTime()) / (1000 * 60));
      return minutesOld < 10;
    });

    const txnsPromises = freshCandidates.map(c => getTxnsData(c.mint).catch(() => null));
    const txnsResults = await Promise.all(txnsPromises);

    const txnsMap = new Map();
    freshCandidates.forEach((c, idx) => {
      txnsMap.set(c.mint, txnsResults[idx]);
    });

    const cateSignals = candidates
      .map((c: any) => {
        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);
        const discoveredAt = new Date(c.discovered_at).getTime();
        const minutesOld = Math.floor((now - discoveredAt) / (1000 * 60));
        const hoursOld = minutesOld / 60;

        let cateScore = 0;
        const issues: string[] = [];
        let momentumBadge = "—";

        const topHolders = c.topHolders || [];
        if (topHolders.length >= 5) {
          const top5Sum = topHolders.slice(0, 5).reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
          if (top5Sum > 0.7) {
            cateScore -= 50;
            issues.push("Top 5 holders >70%");
          }
        }
        if (topHolders.length > 0 && topHolders[0].pct > 0.4) {
          cateScore -= 60;
          issues.push("Single holder >40%");
        }

        if (c.tokenSupply && Number(c.tokenSupply) > 1e12 && Number(c.decimals || 6) <= 6) {
          cateScore -= 100;
          issues.push("Supply manipulation: 1T+ tokens");
        }

        // FRESHNESS (0-30 points) - only for coins < 6 hours old
        if (minutesOld < 1) cateScore += 30;
        else if (minutesOld < 2) cateScore += 28;
        else if (minutesOld < 3) cateScore += 26;
        else if (minutesOld < 5) cateScore += 24;
        else if (minutesOld < 10) cateScore += 20;
        else if (minutesOld < 15) cateScore += 15;
        else if (minutesOld < 30) cateScore += 10;
        else if (minutesOld < 60) cateScore += 5;
        // ELSE: no freshness points for coins > 1 hour

        // AGE DECAY - coins get exponentially worse as they age
        // This prevents old coins from staying in ELITE forever
        if (hoursOld > 6) {
          cateScore -= 10; // 6h+ = -10
        }
        if (hoursOld > 12) {
          cateScore -= 15; // 12h+ = additional -15 (-25 total)
        }
        if (hoursOld > 24) {
          cateScore -= 30; // 24h+ = additional -30 (-55 total, usually drops below 40)
        }
        if (hoursOld > 48) {
          cateScore -= 50; // 48h+ = hard reject
        }

        // MARKET CAP TIER (0-35 points)
        if (mcap > 0 && mcap < 20000) cateScore += 35;
        else if (mcap < 50000) cateScore += 32;
        else if (mcap < 100000) cateScore += 28;
        else if (mcap < 150000) cateScore += 22;
        else if (mcap < 300000) cateScore += 15;
        else if (mcap < 500000) cateScore += 8;

        // LIQUIDITY QUALITY (0-35 points)
        if (mcap > 0) {
          const liqRatio = liq / mcap;
          
          if (liqRatio > 0.30) cateScore += 35;
          else if (liqRatio > 0.20) cateScore += 32;
          else if (liqRatio > 0.15) cateScore += 28;
          else if (liqRatio > 0.10) cateScore += 24;
          else if (liqRatio > 0.07) cateScore += 18;
          else if (liqRatio > 0.05) cateScore += 12;
          else if (liqRatio > 0.02) cateScore += 6;
          else {
            cateScore -= 50;
            issues.push("Liquidity trap: <2%");
          }
        }

        // CONTRACT VERIFICATION (0-20 points)
        if (!c.isVerified) {
          cateScore -= 15;
          issues.push("Unverified contract");
        } else {
          cateScore += 10;
        }

        // HOLDER DISTRIBUTION (0-15 points)
        if (topHolders.length >= 5) {
          const top5Sum = topHolders.slice(0, 5).reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
          if (top5Sum < 0.3) {
            cateScore += 15;
          } else if (top5Sum < 0.4) {
            cateScore += 10;
          } else if (top5Sum < 0.5) {
            cateScore += 5;
          }
        }

        // TIME-BASED MOMENTUM (0-20 points)
        if (minutesOld < 5 && mcap < 30000) {
          cateScore += 15;
        } else if (minutesOld < 10 && mcap < 50000) {
          cateScore += 10;
        }

        // BUY MOMENTUM ACCELERATION (0-25 points)
        const txns = txnsMap.get(c.mint);
        if (txns && txns.m5 && txns.h1 && txns.h6) {
          const m5Buys = Number(txns.m5.buys || 0);
          const h1Buys = Number(txns.h1.buys || 0);
          const h6Buys = Number(txns.h6.buys || 0);

          if (m5Buys > 0 && h1Buys > 0 && h6Buys > 0) {
            const h1_avg_per_5min = h1Buys / 12;
            const h6_avg_per_1h = h6Buys / 6;
            
            const m5_strength = m5Buys / Math.max(h1_avg_per_5min, 1);
            const h1_strength = h1Buys / Math.max(h6_avg_per_1h, 1);
            
            if (m5_strength > 2.5 && h1_strength > 1.8) {
              cateScore += 25;
              momentumBadge = "🚀 EXPLOSIVE";
            } else if (m5_strength > 2 && h1_strength > 1.5) {
              cateScore += 20;
              momentumBadge = "⚡ STRONG";
            } else if (m5_strength > 1.5 && h1_strength > 1.3) {
              cateScore += 12;
              momentumBadge = "📈 MODERATE";
            } else if (m5_strength > 1.3) {
              cateScore += 6;
              momentumBadge = "↗ UPTICK";
            } else {
              momentumBadge = "→ STABLE";
            }
          }
        }

        // Floor at minimum viable
        cateScore = Math.max(25, cateScore);

        let tier = "📊 WATCH";
        if (cateScore >= 100) tier = "🚀 ELITE";
        else if (cateScore >= 85) tier = "🔥 HOT";
        else if (cateScore >= 70) tier = "⚡ RISING";

        return {
          symbol: c.symbol || "?",
          mint: c.mint,
          minutesOld,
          hoursOld: Math.round(hoursOld * 10) / 10,
          mcap: Math.round(mcap),
          liquidity: Math.round(liq),
          cateScore: Math.round(cateScore),
          tier,
          momentum: momentumBadge,
          issues: issues.length > 0 ? issues.join(" | ") : null,
        };
      })
      .filter((c: any) => {
        if (c.issues?.includes("1T+") || c.issues?.includes("Supply manipulation")) return false;
        if (c.issues?.includes(">40%")) return false;
        return c.cateScore >= 40;
      })
      .sort((a: any, b: any) => b.cateScore - a.cateScore)
      .slice(0, 50);

    return NextResponse.json(
      {
        cateCoins: cateSignals,
        summary: {
          elite: cateSignals.filter(c => c.cateScore >= 100).length,
          hot: cateSignals.filter(c => c.cateScore >= 85 && c.cateScore < 100).length,
          rising: cateSignals.filter(c => c.cateScore >= 70 && c.cateScore < 85).length,
          watch: cateSignals.filter(c => c.cateScore >= 40 && c.cateScore < 70).length,
          scanned: allCandidates.length,
          safe: candidates.length,
          passed: cateSignals.length,
          rejectedBySafety: allCandidates.length - candidates.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("CATE error:", err);
    return NextResponse.json({
      error: String(err),
      cateCoins: [],
      summary: { elite: 0, hot: 0, rising: 0, watch: 0, scanned: 0, passed: 0 },
    });
  }
}
