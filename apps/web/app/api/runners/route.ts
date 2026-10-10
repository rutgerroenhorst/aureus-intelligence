import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { aiNameWide } from "@/lib/lab/narrative";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, max-age=0" };

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/**
 * Runners: coins the Radar's door does not take (older or bigger than it admits) that the Learning Lab follows because they
 * look like HOTBOT did: found on Jupiter's organic-score / most-traded / trending lists, real liquidity, thousands of holders.
 * Read-only, from the lab's watch list. These coins are already up: the lab is still measuring how often they keep going.
 */
export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `WITH w AS (
         SELECT w.mint, w.symbol, w.name, w.reason, w.launchpad, w.first_seen_at, w.first_mcap, w.pair_created_at, w.pool_address
           FROM lab_watch w
          WHERE w.active AND w.lane = 'runner'
            AND NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = w.mint)
          ORDER BY w.first_seen_at DESC LIMIT 150
       ),
       last AS (
         SELECT DISTINCT ON (s.mint) s.mint, s.payload, s.taken_at FROM lab_signals_ts s JOIN w ON w.mint = s.mint
          WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.mint, s.taken_at DESC
       ),
       first AS (
         SELECT DISTINCT ON (s.mint) s.mint, (s.payload->>'p')::float8 AS p0 FROM lab_signals_ts s JOIN w ON w.mint = s.mint
          WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.mint, s.taken_at ASC
       ),
       jup AS (
         SELECT DISTINCT ON (s.mint) s.mint, s.payload FROM lab_signals_ts s JOIN w ON w.mint = s.mint
          WHERE s.source = 'jupiter' ORDER BY s.mint, s.taken_at DESC
       )
       SELECT w.*, EXTRACT(EPOCH FROM w.first_seen_at)::float8 AS seen_s, EXTRACT(EPOCH FROM w.pair_created_at)::float8 AS created_s,
              last.payload AS now_p, EXTRACT(EPOCH FROM last.taken_at)::float8 AS now_s, first.p0, jup.payload AS jup_p
         FROM w LEFT JOIN last ON last.mint = w.mint LEFT JOIN first ON first.mint = w.mint LEFT JOIN jup ON jup.mint = w.mint`,
    ).catch((e) => {
      // The lab's tables may not exist yet (database not migrated): an empty tab, never an error on the Radar.
      console.warn("[runners] query failed", String(e?.message ?? e).slice(0, 160));
      return { rows: [] as any[] };
    });
    const nowS = Date.now() / 1000;
    const coins = rows
      .filter((r) => r.now_p)
      .map((r) => {
        const p = r.now_p;
        const price = num(p.p);
        const at = (a: unknown, i: number) => (Array.isArray(a) ? num(a[i]) : null);
        const v1 = at(p.v, 1);
        const v6 = at(p.v, 2);
        const b1 = at(p.b, 1);
        const s1 = at(p.s, 1);
        const j = r.jup_p ?? {};
        const flags: string[] = [];
        if (aiNameWide(r.name, r.symbol)) flags.push("AI, agent or bot name");
        if (v1 != null && v6 != null && v6 > 0 && v1 / (v6 / 6) < 0.3) flags.push("volume fading");
        if (b1 != null && s1 != null && b1 + s1 >= 40 && b1 / (b1 + s1) < 0.4) flags.push("more sellers than buyers (last hour)");
        const org = num(j.organic_score);
        if (org != null && org >= 70) flags.push(`organic score ${Math.round(org)}`);
        const sinceFirst = price != null && r.p0 ? price / r.p0 : null;
        return {
          mint: r.mint as string,
          symbol: (r.symbol as string | null) ?? null,
          name: (r.name as string | null) ?? null,
          via: r.reason as string,
          launchpad: (r.launchpad as string | null) ?? null,
          ageDays: r.created_s ? (nowS - r.created_s) / 86400 : null,
          seenHoursAgo: (nowS - r.seen_s) / 3600,
          mcap: num(p.mcap) ?? num(p.fdv),
          liq: num(p.liq),
          change24h: at(p.pc, 3),
          change1h: at(p.pc, 1),
          sinceFirst,
          organic: org,
          holders: num(j.holders),
          traders24h: num(j.traders_h24),
          volume24h: at(p.v, 3),
          dex: (p.dex as string | null) ?? null,
          readingAgeMin: Math.round((nowS - r.now_s) / 60),
          flags,
        };
      })
      .sort((a, b) => a.seenHoursAgo - b.seenHoursAgo)
      .slice(0, 60);
    // what the lab has learned so far about runners, in one line each (the lanes report is computed hourly)
    const lanes = await pool
      .query(`SELECT payload FROM lab_reports WHERE kind = 'lanes'`)
      .then((r) => (r.rows[0]?.payload?.groups ?? []) as Array<{ id: string; n: number; basis: number; held2: { p: number; k: number; n: number }; held3: { p: number } }>)
      .catch(() => []);
    const g = lanes.find((x) => x.id === "runners");
    // From history: what coins did after crossing $300K with real liquidity (scripts/lab-prior.ts), so the tab can say something now.
    const prior = await pool
      .query(`SELECT payload FROM lab_reports WHERE kind = 'prior'`)
      .then((r) => {
        const grp = (r.rows[0]?.payload?.groups ?? []) as Array<{ id: string; decided: number; go2: { p: number; k: number; n: number }; collapse24: { p: number; k: number; n: number }; ev: number | null }>;
        const a = grp.find((x) => x.id === "all");
        return a && a.decided >= 20 ? { decided: a.decided, held2: a.go2, collapse24: a.collapse24, ev: a.ev } : null;
      })
      .catch(() => null);
    return NextResponse.json(
      {
        at: new Date().toISOString(),
        candidates: coins,
        lab: g ? { coins: g.n, followed3d: g.basis, held2: g.basis >= 8 ? g.held2 : null, held3: g.basis >= 8 ? g.held3.p : null } : null,
        prior,
      },
      { headers: noStore },
    );
  } catch (err) {
    console.error("[runners] GET failed", err);
    return NextResponse.json({ error: "Runners could not be read." }, { status: 500, headers: noStore });
  }
}
