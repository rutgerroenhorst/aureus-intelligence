import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, max-age=0" };

interface LiveCoin {
  mint: string;
  lane: string;
  ageH: number;
  go2: { p: number; k: number; n: number } | null;
  collapse24: { p: number; k: number; n: number } | null;
  zone: string | null;
  flags: string[];
  oddsAt: { go2: number | null; collapse24: number | null };
}

/**
 * What the Learning Lab knows about the coins on the Radar, keyed by mint, for the little "Lab" line on a Radar card.
 * Read-only, from the stored hourly "live" report: the odds are what happened to coins the lab's checked models scored the same
 * way (see docs/LEARNING_LAB.md). A coin gets a line only when there is something checked to say about it.
 */
export async function GET() {
  try {
    const { rows } = await getPool().query(`SELECT payload, computed_at FROM lab_reports WHERE kind = 'live'`);
    const coins = ((rows[0]?.payload?.coins ?? []) as LiveCoin[]).filter((c) => c.lane === "fresh" && (c.go2 || c.collapse24 || c.flags.length));
    const by: Record<string, Omit<LiveCoin, "mint" | "lane">> = {};
    for (const c of coins) by[c.mint] = { ageH: c.ageH, go2: c.go2, collapse24: c.collapse24, zone: c.zone, flags: c.flags, oddsAt: c.oddsAt };
    return NextResponse.json({ at: rows[0]?.computed_at ?? null, coins: by }, { headers: noStore });
  } catch {
    // The lab's tables may not exist yet: the Radar simply shows no lab lines.
    return NextResponse.json({ at: null, coins: {} }, { headers: noStore });
  }
}
