import { NextResponse } from "next/server";
import { exitTick } from "@/lib/exitTick";
import { isTrusted } from "@/lib/trusted";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// wallet look (a few seconds) + prices + the database + Telegram: a normal tick is one to three seconds
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * The 24/7 exit check (apps/web/lib/exitTick.ts). Called by the clock in the database every two minutes with the site's secret
 * (Authorization: Bearer <CRON_SECRET>); anybody else gets a 401. `?test=1` sends the test message instead (to prove the token and the chat are set).
 */
async function handle(req: Request) {
  if (!isTrusted(req)) return NextResponse.json({ error: "not allowed" }, { status: 401, headers: noStore });
  try {
    const r = await exitTick({ test: new URL(req.url).searchParams.get("test") === "1" });
    return NextResponse.json(r, { status: r.ok ? 200 : 500, headers: noStore });
  } catch (e) {
    console.error("[exit-alerts] tick crashed", String((e as Error)?.message ?? e).slice(0, 200));
    return NextResponse.json({ ok: false, error: "tick crashed" }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
