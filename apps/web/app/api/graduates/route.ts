import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/**
 * pump.fun graduations of the last 24 hours, taken from pump.fun's own event stream the moment they happened (the lab's feed:
 * apps/worker/src/pumpFeed.ts, needs the laptop worker or lab daemon running), with the lab's latest reading of each coin.
 * Empty on the hosted site, which cannot hold a websocket open. Read-only.
 */
export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool
      .query(
        `WITH g AS (
           SELECT g.*, EXTRACT(EPOCH FROM g.migrated_at)::float8 AS migrated_s FROM pump_graduates g
            WHERE g.migrated_at > now() - interval '24 hours'
            ORDER BY g.migrated_at DESC LIMIT 120
         ),
         last AS (
           SELECT DISTINCT ON (s.mint) s.mint, s.payload, EXTRACT(EPOCH FROM s.taken_at)::float8 AS at FROM lab_signals_ts s JOIN g ON g.mint = s.mint
            WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.mint, s.taken_at DESC
         ),
         first AS (
           SELECT DISTINCT ON (s.mint) s.mint, (s.payload->>'p')::float8 AS p0, (s.payload->>'liq')::float8 AS liq0 FROM lab_signals_ts s JOIN g ON g.mint = s.mint
            WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.mint, s.taken_at ASC
         )
         SELECT g.mint, g.symbol, g.name, g.migrated_s, g.create_to_migrate_min, g.initial_buy_sol, g.mayhem, g.creator_launches_72h,
                last.payload AS now_p, last.at AS now_s, first.p0, first.liq0, w.note
           FROM g LEFT JOIN last ON last.mint = g.mint LEFT JOIN first ON first.mint = g.mint LEFT JOIN lab_watch w ON w.mint = g.mint`,
      )
      .catch(() => ({ rows: [] as any[] }));
    const nowS = Date.now() / 1000;
    const at = (a: unknown, i: number) => (Array.isArray(a) ? num(a[i]) : null);
    const coins = rows.map((r) => {
      const p = r.now_p;
      const price = num(p?.p);
      const flags: string[] = [];
      if (r.mayhem) flags.push("Mayhem Mode");
      if ((r.creator_launches_72h ?? 0) >= 5) flags.push(`serial creator (${r.creator_launches_72h} launches)`);
      if ((num(r.initial_buy_sol) ?? 0) >= 5) flags.push(`creator bought ${num(r.initial_buy_sol)!.toFixed(0)} SOL at launch`);
      if (r.create_to_migrate_min != null && r.create_to_migrate_min < 2) flags.push("graduated within 2 minutes of launch");
      const sinceFirst = price != null && r.p0 ? price / r.p0 : null;
      if (sinceFirst != null && sinceFirst < 0.5) flags.push("already down more than half");
      if (r.note === "gone") flags.push("no longer listed");
      return {
        mint: r.mint as string, symbol: (r.symbol as string | null) ?? null, name: (r.name as string | null) ?? null,
        ageMin: (nowS - r.migrated_s) / 60, createToMigrateMin: num(r.create_to_migrate_min), devBuySol: num(r.initial_buy_sol), mayhem: Boolean(r.mayhem), creatorLaunches: num(r.creator_launches_72h),
        mcap: num(p?.mcap) ?? num(p?.fdv), liq: num(p?.liq), change1h: at(p?.pc, 1), change5m: at(p?.pc, 0), sinceFirst, buys1h: at(p?.b, 1), sells1h: at(p?.s, 1),
        readingAgeMin: r.now_s ? Math.round((nowS - r.now_s) / 60) : null, flags,
      };
    });
    const lanes = await pool
      .query(`SELECT payload FROM lab_reports WHERE kind = 'lanes'`)
      .then((r) => ((r.rows[0]?.payload?.groups ?? []) as Array<{ id: string; basis: number; held2: { p: number; k: number; n: number }; collapse24?: unknown }>).find((g) => g.id === "pump"))
      .catch(() => undefined);
    return NextResponse.json({ at: new Date().toISOString(), candidates: coins, lab: lanes && lanes.basis >= 8 ? { followed3d: lanes.basis, held2: lanes.held2 } : null }, { headers: noStore });
  } catch (err) {
    console.error("[graduates] GET failed", err);
    return NextResponse.json({ at: new Date().toISOString(), candidates: [], lab: null }, { headers: noStore });
  }
}
