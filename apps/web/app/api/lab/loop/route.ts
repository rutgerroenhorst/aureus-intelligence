import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

/** Just the system loop and when the lab last computed, for the Home page (the full /api/lab is 300 KB). */
export async function GET() {
  try {
    const { rows } = await getPool().query(`SELECT kind, payload, EXTRACT(EPOCH FROM computed_at)::float8 AS at FROM lab_reports WHERE kind IN ('loop', 'meta')`);
    const loop = rows.find((r) => r.kind === "loop");
    const meta = rows.find((r) => r.kind === "meta");
    return NextResponse.json({ loop: loop?.payload ?? null, meta: meta?.payload ?? null, computedAt: loop?.at ?? null }, { headers: noStore });
  } catch {
    return NextResponse.json({ loop: null, meta: null, computedAt: null }, { headers: noStore });
  }
}
