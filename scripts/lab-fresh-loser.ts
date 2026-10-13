/**
 * What became of the coins that fell 30% below their first look in their first days? (the wording of the loss message, apps/web/lib/exitAlerts.ts; docs/EXIT_PRACTICE.md)
 *
 *   corepack pnpm exec tsx scripts/lab-fresh-loser.ts
 *
 * Read-only, laptop database. Every lab coin whose first look is at least 73 hours before the latest reading (a window that is over, dead or alive), entered at the first look. For the coins that
 * fell to 0.7x of that price within 72 hours it prints how they ended (at half or lower, at 0.3x or lower, back at 1x or more) and how fast the fall came. PumpSwap pools, other pools, all.
 */
import pg from "pg";
import { loadObs, selectCandidates, selectWatch } from "../apps/web/lib/lab/builder";
import { cleanObs, type Obs } from "../apps/web/lib/lab/paths";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });
const H = 3600;
const meta = new Map<string, { lp: string | null; born: number | null }>();
for (const r of (await pool.query(`SELECT mint, snaps->0->'f'->>'lp_pump' AS lp, EXTRACT(EPOCH FROM pair_created_at)::float8 AS born FROM lab_coins`)).rows) meta.set(r.mint, { lp: r.lp, born: r.born });
const cands = [...(await selectCandidates(pool, { limit: 1e6, all: true })), ...(await selectWatch(pool, { limit: 1e6, all: true }))];
const best = new Map<string, Obs[]>();
let latest = 0;
for (let b = 0; b < cands.length; b += 40) {
  const batch = cands.slice(b, b + 40);
  const m = await loadObs(pool, batch);
  for (const c of batch) {
    const { clean } = cleanObs(m.get(c.pool_id) ?? []);
    if (clean.length < 3) continue;
    latest = Math.max(latest, clean[clean.length - 1]!.t);
    const old = best.get(c.mint);
    if (!old || old.length < clean.length) best.set(c.mint, clean);
  }
}
// entries at the first look, window over (73 h), PumpSwap and all
const rows: Array<{ pump: boolean | null; touch30: boolean; t30: number; final: number; minWithin72: number; peak72: number }> = [];
for (const [mint, obs] of best) {
  if (obs[0]!.t + 73 * H > latest) continue;
  const p0 = obs[0]!.p;
  if (!(p0 > 0)) continue;
  const win = obs.filter((o) => o.t - obs[0]!.t <= 72 * H);
  const last = win[win.length - 1]!;
  if (last.t - obs[0]!.t < 70 * H && !obs[obs.length - 1]!.dead) continue;
  const ix = win.findIndex((o) => o.p / p0 <= 0.7);
  const m = meta.get(mint);
  rows.push({ pump: m?.lp == null ? null : m.lp === "1", touch30: ix >= 0, t30: ix >= 0 ? (win[ix]!.t - obs[0]!.t) / H : NaN, final: last.p / p0, minWithin72: Math.min(...win.map((o) => o.p / p0)), peak72: Math.max(...win.map((o) => o.p / p0)) });
}
const rep = (name: string, xs: typeof rows) => {
  const t = xs.filter((r) => r.touch30);
  const f = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}% (${k}/${n})` : "-");
  console.log(`${name}: ${xs.length} coins, ${f(t.length, xs.length)} fell to 0.7x or lower within 72 h; of those: ended at half or lower ${f(t.filter((r) => r.final <= 0.5).length, t.length)}, at 0.3x or lower ${f(t.filter((r) => r.final <= 0.3).length, t.length)}, back at 1x or more ${f(t.filter((r) => r.final >= 1).length, t.length)}; reached 0.7x within 6 h: ${f(t.filter((r) => r.t30 <= 6).length, t.length)}`);
};
rep("PumpSwap", rows.filter((r) => r.pump === true));
rep("other pools", rows.filter((r) => r.pump === false));
rep("all", rows);
await pool.end();
