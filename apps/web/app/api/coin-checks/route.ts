import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { recentChecks } from "@/lib/coinCheck";

export const dynamic = "force-dynamic";

/** The coins the user checked in the last two weeks (latest check per coin and tab) and whether their tab has listed them again since. Read-only. */
export async function GET() {
  try {
    return NextResponse.json({ checks: await recentChecks(getPool()) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    // the table does not exist yet (older database) or the database is down: no notes, not a broken Radar
    return NextResponse.json({ checks: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
