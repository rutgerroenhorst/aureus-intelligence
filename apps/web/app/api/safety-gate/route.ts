import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const dumpCheckCache = new Map<string, {data: any, time: number}>();
const CACHE_TTL = 15000; // 15s cache for real-time dump detection

interface DumpCheck {
  hasRug: boolean;
  hasActiveDump: boolean;
  riskScore: number;
  reasons: string[];
}

async function checkDumpPattern(mint: string): Promise<{check: DumpCheck, txns?: any}> {
  try {
    const cached = dumpCheckCache.get(mint);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }

    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(5000) }
    );
    
    if (!res.ok) {
      return { check: { hasRug: false, hasActiveDump: false, riskScore: 0, reasons: [] } };
    }

    const data = await res.json();
    const pair = data.pairs?.[0];

    if (!pair) {
      return { check: { hasRug: false, hasActiveDump: false, riskScore: 0, reasons: [] } };
    }

    const check: DumpCheck = {
      hasRug: false,
      hasActiveDump: false,
      riskScore: 0,
      reasons: [],
    };

    // Log sample data for debugging
    if (pair.baseToken?.symbol === "DIFF") {
      console.log(`[DIFF_DEBUG] m5=${pair.priceChange?.m5}, h1=${pair.priceChange?.h1}, h6=${pair.priceChange?.h6}, h24=${pair.priceChange?.h24}`);
    }

    const m5Txns = pair.txns?.m5;
    const m5Price = pair.priceChange?.m5;

    if (m5Txns && m5Price !== null && m5Price !== undefined) {
      const ratio = m5Txns.sells / Math.max(m5Txns.buys, 1);
      // AGGRESSIVE: catch any massive crash in m5
      if (ratio > 4 && m5Price < -50) {
        check.hasRug = true;
        check.riskScore = 99;
        check.reasons.push("EXTREME_DUMP: Massive sell surge + collapse");
      } else if (ratio > 3 && m5Price < -40) {
        check.hasActiveDump = true;
        check.riskScore = 90;
        check.reasons.push("ACTIVE_DUMP: Severe sell surge + price drop");
      } else if (m5Price < -70) {
        // ANY crash >70% in m5 = rug pull
        check.hasRug = true;
        check.riskScore = 95;
        check.reasons.push(`M5_CRASH: ${Math.round(m5Price)}% drop in 5m`);
      }
    }

    const h1Txns = pair.txns?.h1;
    const h1Price = pair.priceChange?.h1;
    if (h1Txns && h1Price !== null && h1Price !== undefined && !check.hasRug && !check.hasActiveDump) {
      const ratio = h1Txns.sells / Math.max(h1Txns.buys, 1);
      if (ratio > 3.5 && h1Price < -60) {
        check.hasRug = true;
        check.riskScore = 95;
        check.reasons.push("SUSTAINED_RUG: Extreme 1h pattern");
      } else if (h1Price < -70) {
        // ANY crash >70% in h1 = rug pull
        check.hasRug = true;
        check.riskScore = 93;
        check.reasons.push(`H1_CRASH: ${Math.round(h1Price)}% drop in 1h`);
      }
    }

    // FALLBACK: If m5/h1/h6 priceChange unavailable, use m5 txn ratio as indicator
    if (!m5Price && m5Txns && m5Txns.buys) {
      const m5Ratio = m5Txns.sells / Math.max(m5Txns.buys, 1);
      if (m5Ratio > 5) {
        // Extreme sell/buy ratio indicates active dump
        check.hasRug = true;
        check.riskScore = 94;
        check.reasons.push(`TXNS_DUMP: Sell/buy ratio ${m5Ratio.toFixed(1)}x in 5m`);
        console.log(`[SAFETY] TXNS DUMP: ${pair.baseToken?.symbol} m5 ratio=${m5Ratio.toFixed(1)}x`);
      }
    }

    // 6H EXTREME COLLAPSE - catches recent rug pulls
    const h6Price = pair.priceChange?.h6;
    if (h6Price !== null && h6Price !== undefined && h6Price < -70) {
      check.hasRug = true;
      check.riskScore = 97;
      check.reasons.push(`RUG_PULL: Crashed ${Math.round(h6Price)}% in 6h`);
      console.log(`[SAFETY] RUG DETECTED: ${pair.baseToken?.symbol} h6=${h6Price}%`);
    }

    // HISTORICAL PRICE COLLAPSE (24h) - catches dead coins
    const h24Price = pair.priceChange?.h24;
    if (h24Price !== null && h24Price !== undefined && h24Price < -80) {
      check.hasRug = true;
      check.riskScore = 98;
      check.reasons.push(`DEAD_COIN: Crashed ${Math.round(h24Price)}% in 24h`);
      console.log(`[SAFETY] DEAD COIN DETECTED: ${pair.baseToken?.symbol} h24=${h24Price}%`);
    } else if (h24Price !== null && h24Price !== undefined) {
      console.log(`[SAFETY] ${pair.baseToken?.symbol} h24=${h24Price}% (not rejected, >-80%)`);
    }

    const result = { 
      check, 
      txns: {
        m5: pair.txns?.m5,
        h1: pair.txns?.h1,
        h6: pair.txns?.h6,
        h24: pair.txns?.h24,
      }
    };
    dumpCheckCache.set(mint, { data: result, time: Date.now() });
    return result;
  } catch (err) {
    return { check: { hasRug: false, hasActiveDump: false, riskScore: 0, reasons: [] } };
  }
}

export async function GET(request: Request) {
  try {
    const res = await internalFetch(`/api/candidates`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ safe_candidates: [] });
    }

    const data = await res.json();
    const candidates = data.candidates || [];

    const safeCandidates = candidates.filter((c: any) => {
      const mcap = Number(c.marketCapUsd || 0);
      const liq = Number(c.liquidityUsd || 0);

      if (mcap < 1000 || liq < 1000) return false;

      if (
        c.tokenSupply &&
        Number(c.tokenSupply) > 1e12 &&
        Number(c.decimals || 6) <= 6
      ) {
        return false;
      }

      if (mcap > 0) {
        const liqRatio = liq / mcap;
        if (liqRatio < 0.005 && liq < 10000) return false;
      }

      const topHolders = c.topHolders || [];
      if (topHolders.length >= 5) {
        const top5Sum = topHolders
          .slice(0, 5)
          .reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
        if (top5Sum > 0.85) return false;
      }

      if (topHolders.length > 0 && topHolders[0].pct > 0.7) return false;

      return true;
    });

    // Fetch dump checks for all candidates and filter
    const dumpResults = await Promise.allSettled(
      safeCandidates.map((c: any) => checkDumpPattern(c.mint))
    );

    const filteredCandidates = safeCandidates.filter((c: any, idx: number) => {
      const result = dumpResults[idx];
      if (result.status === "fulfilled" && result.value) {
        const { check, txns } = result.value;
        c.txns = txns;

        // Reject coins with active dumps or rugs
        if (check.hasRug || check.hasActiveDump) {
          console.log(`[SAFETY-GATE] FILTERED OUT: ${c.symbol} - ${check.reasons.join(", ")}`);
          return false;
        }
      }
      return true;
    });

    console.log(`[SAFETY-GATE] Input: ${safeCandidates.length}, Output: ${filteredCandidates.length}`);

    return NextResponse.json(
      {
        safe_candidates: filteredCandidates,
        total: candidates.length,
        safe: filteredCandidates.length,
        rejected: candidates.length - filteredCandidates.length,
      },
      { headers: { "Cache-Control": "no-store, max-age=30" } }
    );
  } catch (err) {
    console.error("Safety gate error:", err);
    return NextResponse.json({ safe_candidates: [] });
  }
}
