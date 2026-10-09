import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await internalFetch(`/api/candidates`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ candidates: [] });
    }

    const data = await res.json();
    const candidates = data.candidates || [];
    const now = Date.now();

    // Elite: Good quality coins, BUT only if <7 days old (freshness gate)
    // Prevents stale coins from staying "elite"
    const elite = candidates
      .filter((c: any) => {
        const mcap = Number(c.marketCapUsd || 0);
        const liq = Number(c.liquidityUsd || 0);
        const discoveredAt = new Date(c.discovered_at).getTime();
        const hoursOld = Math.floor((now - discoveredAt) / (1000 * 60 * 60));

        // HARDGATE: Coins older than 7 days are NOT elite anymore
        // They've had time to prove themselves or fail
        if (hoursOld > 7 * 24) return false;

        // Quality gates: must be established coins with good quality
        if (mcap < 100000 || mcap > 5000000) return false; // must be in elite mcap band
        if (liq < 0.15 * mcap) return false; // must have >15% liquidity
        if (liq < 15000) return false; // absolute minimum liquidity

        // Holder safety
        const topHolders = c.topHolders || [];
        if (topHolders.length > 0 && topHolders[0].pct > 0.7) return false;
        if (topHolders.length >= 5) {
          const top5Sum = topHolders.slice(0, 5).reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
          if (top5Sum > 0.85) return false;
        }

        return true;
      })
      .sort((a: any, b: any) => {
        const aMcap = Number(a.marketCapUsd || 0);
        const bMcap = Number(b.marketCapUsd || 0);
        const aAge = (now - new Date(a.discovered_at).getTime()) / (1000 * 60 * 60);
        const bAge = (now - new Date(b.discovered_at).getTime()) / (1000 * 60 * 60);

        // Sort: fresher + better positioned in range first
        return (aAge - bAge) || (Math.abs(aMcap - 300000) - Math.abs(bMcap - 300000));
      })
      .slice(0, 50);

    return NextResponse.json({
      candidates: elite,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Elite validator error:", err);
    return NextResponse.json({ candidates: [] });
  }
}
