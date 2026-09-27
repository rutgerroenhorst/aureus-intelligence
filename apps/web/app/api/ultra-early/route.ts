import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const safeRes = await fetch("http://localhost:3000/api/safety-gate", {
      cache: "no-store",
    });

    if (!safeRes.ok) {
      return NextResponse.json({ candidates: [] });
    }

    const safeData = await safeRes.json();
    const candidates = safeData.safe_candidates || [];
    const now = Date.now();

    // Ultra Early: Brand new coins with high upside potential
    // Different from CATE: focus on AGE + basic quality, not elite scoring
    const ultraEarly = candidates
      .filter((c: any) => {
        const discoveredAt = new Date(c.discovered_at).getTime();
        const minutesOld = Math.floor((now - discoveredAt) / (1000 * 60));
        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);

        // Must be ULTRA FRESH (< 30 minutes old)
        if (minutesOld > 30) return false;

        // Must be micro-cap (high upside)
        if (mcap < 500 || mcap > 100000) return false;

        // Must have SOME liquidity
        if (liq < 500) return false;

        return true;
      })
      .sort((a: any, b: any) => {
        const aMcap = Number(a.marketCapUsd || 0);
        const bMcap = Number(b.marketCapUsd || 0);
        const aAge = (now - new Date(a.discovered_at).getTime()) / (1000 * 60);
        const bAge = (now - new Date(b.discovered_at).getTime()) / (1000 * 60);

        // Sort: freshest first, best positioned second
        return (aAge - bAge) || (aMcap - bMcap);
      })
      .slice(0, 20);

    return NextResponse.json({
      candidates: ultraEarly,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ candidates: [] });
  }
}
