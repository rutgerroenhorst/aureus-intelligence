import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const txnCache = new Map<string, {data: any, time: number}>();
const CACHE_TTL = 30000;

async function getMomentumData(mint: string): Promise<any> {
  try {
    const cached = txnCache.get(mint);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }

    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const pair = data.pairs?.[0];

    if (!pair) return null;

    const result = {
      txns: pair.txns,
      priceChange: pair.priceChange,
      volume: pair.volume,
      liquidity: pair.liquidity,
    };

    txnCache.set(mint, { data: result, time: Date.now() });
    return result;
  } catch (err) {
    return null;
  }
}

export async function GET() {
  try {
    const safeRes = await internalFetch(`/api/safety-gate`, {
      cache: "no-store",
    });

    if (!safeRes.ok) {
      return NextResponse.json({
        candidates: [],
        summary: { scanned: 0, found: 0 }
      });
    }

    const safeData = await safeRes.json();
    const candidates = safeData.safe_candidates || [];
    const now = Date.now();

    // Ultra-fresh: <120 min (relaxed from 90)
    const debugReasons: {[key: string]: string} = {};
    const ultraFresh = candidates.filter((c: any) => {
      const discoveredAt = new Date(c.discovered_at).getTime();
      const minutesOld = Math.floor((now - discoveredAt) / (1000 * 60));
      const mcap = Number(c.marketCapUsd || 0);
      const liq = Number(c.liquidityUsd || 0);

      if (minutesOld > 120) {
        debugReasons[c.symbol] = `Too old: ${minutesOld}m`;
        return false;
      }
      if (mcap < 500 || mcap > 100000) {
        debugReasons[c.symbol] = `mcap out of range: ${mcap}`;
        return false;
      }
      if (liq < 500) {
        debugReasons[c.symbol] = `liq too low: ${liq}`;
        return false;
      }
      if (mcap > 0) {
        const liqRatio = liq / mcap;
        if (liqRatio < 0.10) {
          debugReasons[c.symbol] = `liq ratio low: ${liqRatio.toFixed(3)}`;
          return false;
        }
      }

      return true;
    });

    const momentumPromises = ultraFresh.map(c =>
      getMomentumData(c.mint).catch(() => null)
    );
    const momentumResults = await Promise.all(momentumPromises);

    const momentumMap = new Map();
    ultraFresh.forEach((c, idx) => {
      momentumMap.set(c.mint, momentumResults[idx]);
    });

    const scored = ultraFresh
      .map((c: any) => {
        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);
        const discoveredAt = new Date(c.discovered_at).getTime();
        const minutesOld = Math.floor((now - discoveredAt) / (1000 * 60));
        const secondsOld = Math.floor((now - discoveredAt) / 1000);

        let score = 0;
        let signal = "—";
        const reasons: string[] = [];

        // INITIAL MOMENTUM
        const momentum = momentumMap.get(c.mint);

        if (momentum?.txns?.m5) {
          const m5Buys = Number(momentum.txns.m5.buys || 0);
          const m5Sells = Number(momentum.txns.m5.sells || 0);
          const m5BuySellRatio = m5Buys / Math.max(m5Sells, 1);

          if (m5BuySellRatio > 3) {
            score += 40;
            signal = "🚀 ROCKET LAUNCH";
            reasons.push(`Buy ratio ${m5BuySellRatio.toFixed(1)}x`);
          } else if (m5BuySellRatio > 2) {
            score += 30;
            signal = "⚡ STRONG ENTRY";
            reasons.push(`Buy ratio ${m5BuySellRatio.toFixed(1)}x`);
          } else if (m5BuySellRatio > 1.5) {
            score += 20;
            signal = "📈 GOOD ENTRY";
            reasons.push(`Buy ratio ${m5BuySellRatio.toFixed(1)}x`);
          } else if (m5BuySellRatio > 1.2) {
            score += 12;
            signal = "↗ ENTRY";
            reasons.push(`Ratio ${m5BuySellRatio.toFixed(1)}x`);
          }

          if (m5Buys > 50) {
            score += 25;
            reasons.push(`${m5Buys} buys in m5`);
          } else if (m5Buys > 30) {
            score += 15;
            reasons.push(`${m5Buys} buys in m5`);
          } else if (m5Buys > 15) {
            score += 8;
            reasons.push(`${m5Buys} buys in m5`);
          }
        }

        // PRICE ACTION
        if (momentum?.priceChange?.m5) {
          const priceUp = Number(momentum.priceChange.m5);

          if (priceUp > 0 && priceUp < 50) {
            score += 20;
            reasons.push(`+${priceUp.toFixed(1)}% momentum`);
          } else if (priceUp > 50) {
            score += 15;
            reasons.push(`Already +${priceUp.toFixed(1)}% (late)`);
          }
        }

        // LIQUIDITY QUALITY
        if (mcap > 0) {
          const liqRatio = liq / mcap;

          if (liqRatio > 0.30) {
            score += 20;
            reasons.push("Excellent liquidity");
          } else if (liqRatio > 0.20) {
            score += 15;
            reasons.push("Good liquidity");
          } else if (liqRatio > 0.15) {
            score += 10;
            reasons.push("Decent liquidity");
          } else if (liqRatio > 0.10) {
            score += 5;
            reasons.push("OK liquidity");
          }
        }

        // HOLDER DISTRIBUTION
        const topHolders = c.topHolders || [];
        let whaleRisk = false;

        if (topHolders.length > 0 && topHolders[0].pct > 0.40) {
          score -= 35;
          whaleRisk = true;
          reasons.push(`⚠️ Whale ${(topHolders[0].pct * 100).toFixed(0)}%`);
        }
        if (topHolders.length >= 5) {
          const top5 = topHolders.slice(0, 5).reduce((s: number, h: any) => s + Number(h.pct || 0), 0);
          if (top5 > 0.70) {
            score -= 25;
            whaleRisk = true;
            reasons.push(`⚠️ Top 5: ${(top5 * 100).toFixed(0)}%`);
          } else if (top5 < 0.35) {
            score += 12;
            reasons.push("✓ Spread holders");
          }
        }

        // FRESHNESS BONUS (crucial for ultra-early)
        if (secondsOld < 60) {
          score += 30;
          reasons.push("🔥 <1m fresh");
        } else if (minutesOld < 2) {
          score += 25;
          reasons.push("🔥 <2m fresh");
        } else if (minutesOld < 3) {
          score += 20;
          reasons.push("⚡ <3m fresh");
        } else if (minutesOld < 5) {
          score += 15;
          reasons.push("📍 <5m fresh");
        } else if (minutesOld < 15) {
          score += 8;
          reasons.push("📊 <15m old");
        }

        // MARKET CAP TIER
        if (mcap < 5000) {
          score += 20;
          reasons.push("Micro-cap");
        } else if (mcap < 15000) {
          score += 15;
          reasons.push("Ultra-small");
        } else if (mcap < 50000) {
          score += 10;
          reasons.push("Small-cap");
        }

        score = Math.max(15, score); // Floor at 15 (was 20)

        return {
          symbol: c.symbol || "?",
          mint: c.mint,
          minutesOld,
          secondsOld,
          mcap: Math.round(mcap),
          liquidity: Math.round(liq),
          score: Math.round(score),
          signal,
          reasons,
          whaleRisk,
        };
      })
      .filter((c: any) => c.score >= 15) // Lowered from 20 to 15
      .sort((a: any, b: any) => {
        return (b.score - a.score) || (a.secondsOld - b.secondsOld);
      })
      .slice(0, 20); // Increased from 15 to 20

    return NextResponse.json({
      candidates: scored,
      summary: {
        scanned: candidates.length,
        ultraFresh: ultraFresh.length,
        found: scored.length,
      },
      debug: {
        rejections: debugReasons,
        ultraFreshList: ultraFresh.map(c => ({symbol: c.symbol, mint: c.mint}))
      }
    }, { headers: { "Cache-Control": "no-store, max-age=20" } });
  } catch (err) {
    console.error("Ultra Early Momentum error:", err);
    return NextResponse.json({
      candidates: [],
      summary: { scanned: 0, ultraFresh: 0, found: 0 }
    }, { status: 200 });
  }
}
