import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PERMANENTLY REMOVE STALE/DEAD COINS FROM ALL FILTERS
export async function GET() {
  try {
    const boardRes = await fetch("http://localhost:3000/api/board", {
      cache: "no-store",
    });

    if (!boardRes.ok) {
      return NextResponse.json({ cleaned: 0, reasons: [] });
    }

    const board = await boardRes.json();
    const sections = board.sections || {};
    const now = Date.now();
    const totalRemoved: any = { total: 0, reasons: {} };

    // Check each coin for staleness
    Object.entries(sections).forEach(([sectionName, coins]: any) => {
      if (!Array.isArray(coins)) return;

      const before = coins.length;
      const filtered = coins.filter((c: any) => {
        const discoveredAt = c.discovered_at ? new Date(c.discovered_at).getTime() : now;
        const ageMs = now - discoveredAt;
        const ageHours = ageMs / (1000 * 60 * 60);
        const ageDays = ageHours / 24;

        // HARD REJECT CONDITIONS
        if (ageDays > 7) {
          totalRemoved.reasons["age>7d"] = (totalRemoved.reasons["age>7d"] || 0) + 1;
          totalRemoved.total++;
          return false;
        }

        if (ageDays > 3 && sectionName.includes("elite")) {
          totalRemoved.reasons["elite>3d"] = (totalRemoved.reasons["elite>3d"] || 0) + 1;
          totalRemoved.total++;
          return false;
        }

        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);

        // Dead liquidity = delisted/dead
        if (liq < 100 && ageDays > 0.5) {
          totalRemoved.reasons["dried_liquidity"] = (totalRemoved.reasons["dried_liquidity"] || 0) + 1;
          totalRemoved.total++;
          return false;
        }

        // Collapsed price = probably rug/dump
        if (c.priceUsd && c.priceUsd < 0.00000001 && ageDays > 1) {
          totalRemoved.reasons["price_collapsed"] = (totalRemoved.reasons["price_collapsed"] || 0) + 1;
          totalRemoved.total++;
          return false;
        }

        // Mega old HOT/RISING should be downgraded
        if (ageDays > 1 && (sectionName.includes("hot") || sectionName.includes("rising"))) {
          totalRemoved.reasons["tier_expired"] = (totalRemoved.reasons["tier_expired"] || 0) + 1;
          totalRemoved.total++;
          return false;
        }

        return true;
      });

      if (filtered.length < before) {
        console.log(`[Stale] ${sectionName}: ${before} → ${filtered.length}`);
      }
    });

    return NextResponse.json({
      cleaned: totalRemoved.total,
      breakdown: totalRemoved.reasons,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Stale cleanup error:", err);
    return NextResponse.json({ cleaned: 0, error: String(err) });
  }
}
