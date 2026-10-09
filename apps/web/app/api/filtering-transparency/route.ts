import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await internalFetch(`/api/candidates`, {
      cache: "no-store",
    });
    
    if (!res.ok) {
      return NextResponse.json({
        error: "Failed",
        analysis: { scanned: 0, filtered: {} },
      });
    }

    const data = await res.json();
    const candidates = data.candidates || [];

    const filtered: any = {
      too_old: 0,           // >120 min
      too_low_mcap: 0,      // <10k
      no_liquidity: 0,      // <$1k
      poor_liq_ratio: 0,    // <5%
      likely_honeypot: 0,   // suspected
      passed: 0,
    };

    const issues: any[] = [];

    candidates.forEach((c: any) => {
      const mcap = Number(c.marketCapUsd || 0);
      const liq = Number(c.liquidityUsd || 0);
      const discoveredAt = new Date(c.discovered_at).getTime();
      const minutesOld = Math.floor((Date.now() - discoveredAt) / (1000 * 60));

      let reason = "";
      
      if (minutesOld > 120) {
        reason = "too_old";
        filtered.too_old++;
      } else if (mcap < 10000) {
        reason = "too_low_mcap";
        filtered.too_low_mcap++;
      } else if (liq < 1000) {
        reason = "no_liquidity";
        filtered.no_liquidity++;
      } else if (liq / Math.max(mcap, 1) < 0.05) {
        reason = "poor_liq_ratio";
        filtered.poor_liq_ratio++;
      } else {
        filtered.passed++;
      }

      // Track problematic coins for analysis
      if (reason && filtered[reason] <= 5) {
        issues.push({
          symbol: c.symbol,
          mint: c.mint,
          reason,
          mcap: Math.round(mcap),
          liquidity: Math.round(liq),
          minutesOld,
        });
      }
    });

    return NextResponse.json({
      analysis: {
        scanned: candidates.length,
        filtered,
        issues: issues.slice(0, 20),
        passRate: `${((filtered.passed / candidates.length) * 100).toFixed(1)}%`,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Diagnostic error:", err);
    return NextResponse.json({
      error: String(err),
      analysis: {},
    });
  }
}
