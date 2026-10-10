import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { loadReports } from "@/lib/lab/reports";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * Everything the Learning page shows, in one read. The analyses are computed by the learning tick and stored in lab_reports;
 * this route only reads them, so opening the page costs one cheap query however much the lab knows.
 */
export async function GET() {
  try {
    const { computedAt, reports: stored } = await loadReports(getPool());
    // the daily history only feeds the loop card's trends (already inside "loop"); the page does not need it
    const { history: _history, ...reports } = stored as Record<string, unknown>;
    const pool = getPool();
    // Collection health: how much each collector has gathered, so the page can say what is still "collecting".
    const { rows } = await pool.query(
      `SELECT source, count(*)::int AS n, max(taken_at) AS last, count(DISTINCT mint)::int AS coins FROM lab_signals_ts GROUP BY source`,
    ).catch(() => ({ rows: [] as Array<{ source: string; n: number; last: Date | null; coins: number }> }));
    return NextResponse.json(
      { computedAt, ...reports, collectors: rows.map((r) => ({ source: r.source, rows: r.n, coins: r.coins, last: r.last ? new Date(r.last).toISOString() : null })) },
      { headers: noStore },
    );
  } catch (err) {
    console.error("[lab] GET failed", err);
    return NextResponse.json({ error: "The Learning Lab could not be read." }, { status: 500, headers: noStore });
  }
}
