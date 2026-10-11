import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getPool } from "@aureus/db";
import { computeHotChains, saveHotReport, type HotReport } from "@/lib/hotChains";

export const dynamic = "force-dynamic";
// Reading six networks one after the other takes about twenty seconds (GeckoTerminal allows about thirty calls a minute).
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store, max-age=0" };
// the laptop refreshes the ranking every 4 minutes; the hosted site only steps in when it is much older (a refresh takes ~20 s of function time)
const FRESH_MIN = process.env.VERCEL ? 20 : 5;
let inflight: Promise<HotReport | null> | null = null;
let lastTry = 0;

/** Read the networks and store the ranking (kind "hotchains" in lab_reports). One at a time, and not more than once a minute. */
async function refresh(): Promise<HotReport | null> {
  if (inflight) return inflight;
  if (Date.now() - lastTry < 60_000) return null;
  lastTry = Date.now();
  inflight = (async () => {
    try {
      const before = (await getPool().query(`SELECT payload FROM lab_reports WHERE kind = 'hotchains'`).catch(() => ({ rows: [] as any[] }))).rows[0]?.payload as HotReport | undefined;
      const r = await computeHotChains(undefined, {}, before ?? null);
      await saveHotReport(getPool(), r);
      return r;
    } catch (e) {
      console.error("[hot-chains] refresh failed", String((e as Error)?.message ?? e).slice(0, 120));
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * The ranking of the networks and what is trending on each. Served from the stored copy; a copy older than five minutes is
 * refreshed after the answer is sent (the laptop's worker also refreshes it when it runs), so the page never waits for it.
 */
export async function GET() {
  try {
    const row = (await getPool().query(`SELECT payload, EXTRACT(EPOCH FROM (now() - computed_at)) / 60 AS age_min FROM lab_reports WHERE kind = 'hotchains'`).catch(() => ({ rows: [] as any[] }))).rows[0];
    if (!row) {
      const r = await refresh();
      return NextResponse.json(r ? { ...r, ageMin: 0 } : { error: "The ranking is not available yet, try again in a minute." }, { status: r ? 200 : 503, headers: noStore });
    }
    if (row.age_min > FRESH_MIN) waitUntil(refresh().then(() => undefined));
    return NextResponse.json({ ...row.payload, ageMin: Math.round(row.age_min) }, { headers: noStore });
  } catch (err) {
    console.error("[hot-chains] GET failed", err);
    return NextResponse.json({ error: "The ranking could not be read." }, { status: 500, headers: noStore });
  }
}
