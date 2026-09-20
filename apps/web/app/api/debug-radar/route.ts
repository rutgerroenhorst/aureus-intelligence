import { getDecisionViews } from "../../../lib/candidateView";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const views = await getDecisionViews(Date.now());

    const active = views.filter((v) => v.universe === "ACTIVE");
    const qualified = active.filter((v) => v.status === "FUNDAMENTAL_WATCH" || v.status === "SETUP_FORMING" || v.status === "ENTRY_READY");

    const now = Date.now();
    const details = qualified.map((c: any) => {
      const discoveredAtDate = typeof c.discoveredAt === "string" ? new Date(c.discoveredAt) : (c.discoveredAt || new Date());
      const ageMs = now - discoveredAtDate.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const ageDays = ageHours / 24;

      return {
        symbol: c.symbol,
        mint: c.mint,
        status: c.status,
        marketCap: c.marketCapUsd,
        liquidity: c.liquidityUsd,
        price: c.price || c.currentPrice,
        discoveredAt: discoveredAtDate.toISOString(),
        ageHours: ageHours.toFixed(1),
        ageDays: ageDays.toFixed(1),
        potential: c.potential,
        qualityRank: c.qualityRank,
      };
    });

    return NextResponse.json({
      totalActive: active.length,
      totalQualified: qualified.length,
      coins: details,
      analysis: {
        tooOld: details.filter(c => Number(c.ageHours) > 48).length,
        lowPotential: details.filter(c => c.potential && c.potential < 0.05).length,
        lowLiquidity: details.filter(c => !c.liquidity || c.liquidity < 50000).length,
      }
    });
  } catch (err) {
    console.error("Debug error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
