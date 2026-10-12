import { NextResponse } from "next/server";
import { graduateTick } from "@/lib/graduateTick";
import { isTrusted } from "@/lib/trusted";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// the chain's list, a handful of transactions, one Jupiter call and the database: a tick is one to four seconds
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * The graduation feed (lib/graduateFeed.ts): pump.fun's graduations read from the chain every 3 minutes, so the Graduations tab does not depend on the laptop.
 * Called by the clock in the database with the site's secret (Authorization: Bearer <CRON_SECRET>); anybody else gets a 401.
 */
async function handle(req: Request) {
  if (!isTrusted(req)) return NextResponse.json({ error: "not allowed" }, { status: 401, headers: noStore });
  try {
    const r = await graduateTick();
    return NextResponse.json(r, { status: r.ok ? 200 : 500, headers: noStore });
  } catch (e) {
    console.error("[graduates] tick crashed", String((e as Error)?.message ?? e).slice(0, 200));
    return NextResponse.json({ ok: false, error: "tick crashed" }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
