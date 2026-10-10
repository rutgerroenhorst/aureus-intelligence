import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { currentGraduates } from "@/lib/graduates";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * pump.fun graduations of the last 72 hours, taken from pump.fun's own event stream the moment they happened (the lab's feed:
 * apps/worker/src/pumpFeed.ts, needs the laptop worker or lab daemon running), with the lab's readings of each coin and how each
 * kind of graduation ended. The hosted site cannot hold a websocket open, so it shows the snapshot the laptop last pushed
 * ("source": "laptop", with its time). Read-only.
 */
export async function GET() {
  try {
    return NextResponse.json(await currentGraduates(getPool()), { headers: noStore });
  } catch (err) {
    console.error("[graduates] GET failed", err);
    return NextResponse.json({ at: new Date().toISOString(), candidates: [], summary: [], lab: null }, { headers: noStore });
  }
}
