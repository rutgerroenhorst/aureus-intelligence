import { internalFetch } from "@/lib/internalFetch";
import { getPool } from "@aureus/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ResultsCoin {
  symbol: string;
  mint: string;
  /** the Radar tab(s) that listed the coin, from the learning tracker; "Not tracked" when it predates the tracker */
  detector: string;
  entryScore: number;
  entryMcap: number;
  currentMcap: number;
  multiplier: number;
  detectionAge: number;
  status: string;
}

export async function GET() {
  try {
    const boardRes = await internalFetch(`/api/board`, {
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
        // The detector used to be guessed from the board section's NAME, which never contains "elite"/"buy"/"momentum"
        // (the sections are ENTRY_READY, PRIMARY_WATCH, ...), so every coin was labelled "CATE" with score 50. It is
        // filled in below from what the learning tracker actually recorded.
        const detector = "Not tracked";
        const entryScore = 0;

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

    // Real attribution: the tab(s) that listed each winner, and the score it had then, as recorded by the learning tracker.
    // Coins found before the tracker started (2026-10-09) have no record, and say so instead of getting a default label.
    const TAB_LABEL: Record<string, string> = { cate: "CATE", buy_signals: "Buy Signal", ultra_momentum: "Ultra Momentum", elite: "Elite", incubation: "Incubation" };
    const found = new Map<string, { tabs: string[]; score: number | null }>();
    if (systemWins.length > 0) {
      try {
        const { rows } = await getPool().query(
          `SELECT mint, array_agg(DISTINCT tab_name) AS tabs,
                  (array_agg(score_at_qualification ORDER BY qualified_at ASC) FILTER (WHERE score_at_qualification IS NOT NULL))[1] AS score
             FROM coin_qualifications WHERE mint = ANY($1) GROUP BY mint`,
          [systemWins.map((c) => c.mint)],
        );
        for (const r of rows) found.set(r.mint, { tabs: r.tabs, score: r.score != null ? Number(r.score) : null });
      } catch (err) {
        console.error("Results attribution failed:", err);
      }
    }
    const breakdown: Record<string, number> = { CATE: 0, Elite: 0, "Buy Signal": 0, "Ultra Momentum": 0, Incubation: 0, "Not tracked": 0 };
    for (const c of systemWins) {
      const f = found.get(c.mint);
      if (!f) { breakdown["Not tracked"]++; continue; }
      const labels = f.tabs.map((t) => TAB_LABEL[t] ?? t);
      c.detector = labels.join(" + ");
      c.entryScore = f.score ?? 0;
      for (const l of labels) breakdown[l] = (breakdown[l] ?? 0) + 1;
    }
    const detectorBreakdown = breakdown;

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
        Incubation: 0,
        "Not tracked": 0,
      },
      myTrades: [],
    });
  }
}
