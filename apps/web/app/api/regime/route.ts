import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

/** The market backdrop the Learning Lab collects hourly (lib/lab/regime.ts): SOL, Solana DEX volume, pump.fun volume, fear and greed, trending narratives. Read-only. */
export async function GET() {
  try {
    const pool = getPool();
    const [{ rows: now }, { rows: hist }] = await Promise.all([
      pool.query(`SELECT payload, EXTRACT(EPOCH FROM taken_at)::float8 AS at FROM lab_signals_ts WHERE source = 'regime' ORDER BY taken_at DESC LIMIT 1`),
      pool.query(`SELECT payload FROM lab_signals_ts WHERE source = 'regime_hist' ORDER BY taken_at DESC LIMIT 1`),
    ]);
    const sol: Array<[number, number]> = hist[0]?.payload?.sol ?? [];
    // SOL over the last 7 days, one point every 6 hours, for a small line
    const spark = sol.filter((_, i) => i % 3 === 0).slice(-28).map((p) => p[1]);
    return NextResponse.json({ at: now[0]?.at ?? null, now: now[0]?.payload ?? null, spark }, { headers: noStore });
  } catch {
    return NextResponse.json({ at: null, now: null, spark: [] }, { headers: noStore });
  }
}
