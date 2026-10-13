import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { loadFacts } from "@/lib/kennis/facts";
import type { Facts } from "@/lib/kennis/types";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, max-age=0" };
/** Two cheap reads (the journal's rows and two stored lab reports); one answer is shared for five minutes so an open Kennis page costs the free database next to nothing. */
const SHARE_MS = 5 * 60_000;
let memo: { at: number; body: Facts } | null = null;

/** The numbers the knowledge tab puts under its answers: aggregates only (no coin names, no addresses). */
export async function GET() {
  try {
    if (!memo || Date.now() - memo.at > SHARE_MS) memo = { at: Date.now(), body: await loadFacts(getPool()) };
    return NextResponse.json({ facts: memo.body, at: new Date(memo.at).toISOString() }, { headers: noStore });
  } catch (err) {
    console.error("[kennis-facts] failed", err);
    return NextResponse.json({ facts: { journal: null, lab: null }, error: "facts unavailable" }, { status: 200, headers: noStore });
  }
}
