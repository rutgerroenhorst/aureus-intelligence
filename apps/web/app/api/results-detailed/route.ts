import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ResultsCoin {
  symbol: string;
  mint: string;
  detector: "CATE" | "Elite" | "Buy Signal" | "Ultra Momentum";
  entryScore: number;
  entryMcap: number;
  currentMcap: number;
  multiplier: number;
  detectionAge: number;
  status: string;
}

export async function GET() {
  try {
    const boardRes = await fetch("http://localhost:3000/api/board", {
      cache: "no-store",
    });

    if (!boardRes.ok) {
      return NextResponse.json({ systemWins: [], myTrades: [] });
    }

    const board = await boardRes.json();

    const allCoins: any[] = [];
    const sections = board.sections || {};

    Object.entries(sections).forEach(([sectionName, coins]: any) => {
      if (Array.isArray(coins)) {
        coins.forEach((c: any) => {
          allCoins.push({
            ...c,
            section: sectionName,
          });
        });
      }
    });

    const systemWins: ResultsCoin[] = allCoins
      .map((c: any) => {
        let detector: "CATE" | "Elite" | "Buy Signal" | "Ultra Momentum" =
          "CATE";
        let entryScore = 50;

        if (c.section?.includes("elite")) {
          detector = "Elite";
          entryScore = c.score || 100;
        } else if (
          c.section?.includes("buy") ||
          c.section?.includes("signal")
        ) {
          detector = "Buy Signal";
          entryScore = c.buy_score || c.cateScore || 70;
        } else if (c.section?.includes("momentum")) {
          detector = "Ultra Momentum";
          entryScore = c.score || 60;
        } else if (c.cateScore) {
          detector = "CATE";
          entryScore = c.cateScore;
        }

        const entryMcap = c.marketCapFirstSeen || c.marketCapUsd || 50000;
        const currentMcap = c.marketCapUsd || entryMcap;
        const multiplier = currentMcap / entryMcap;

        const discoveredAt = c.discovered_at
          ? new Date(c.discovered_at).getTime()
          : Date.now();
        const detectionAge = Math.max(
          0,
          Math.floor((Date.now() - discoveredAt) / (1000 * 60))
        );

        let status: "winner" | "break-even" | "loss" = "loss";
        if (multiplier >= 2) status = "winner";
        else if (multiplier >= 0.95) status = "break-even";

        return {
          symbol: c.symbol || "?",
          mint: c.mint,
          detector,
          entryScore,
          entryMcap,
          currentMcap,
          multiplier: Math.round(multiplier * 100) / 100,
          detectionAge,
          status,
        };
      })
      .filter((c) => c.status === "winner")
      .sort((a, b) => b.multiplier - a.multiplier)
      .slice(0, 50);

    const stats = {
      winners: systemWins.length,
      x5plus: systemWins.filter((c) => c.multiplier >= 5).length,
      x10plus: systemWins.filter((c) => c.multiplier >= 10).length,
      avgMultiplier:
        systemWins.length > 0
          ? Math.round(
              (systemWins.reduce((sum, c) => sum + c.multiplier, 0) /
                systemWins.length) *
                100
            ) / 100
          : 0,
    };

    const detectorBreakdown = {
      CATE: systemWins.filter((c) => c.detector === "CATE").length,
      Elite: systemWins.filter((c) => c.detector === "Elite").length,
      "Buy Signal": systemWins.filter((c) => c.detector === "Buy Signal")
        .length,
      "Ultra Momentum": systemWins.filter(
        (c) => c.detector === "Ultra Momentum"
      ).length,
    };

    return NextResponse.json(
      {
        systemWins,
        stats,
        detectorBreakdown,
        myTrades: [],
      },
      { headers: { "Cache-Control": "no-store, max-age=30" } }
    );
  } catch (err) {
    console.error("Results API error:", err);
    return NextResponse.json({
      systemWins: [],
      stats: { winners: 0, x5plus: 0, x10plus: 0, avgMultiplier: 0 },
      detectorBreakdown: {
        CATE: 0,
        Elite: 0,
        "Buy Signal": 0,
        "Ultra Momentum": 0,
      },
      myTrades: [],
    });
  }
}
