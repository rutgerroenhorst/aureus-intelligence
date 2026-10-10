/**
 * pump.fun graduations of the last 72 hours with the lab's readings of each, for the Radar's Graduations tab, Home and the coin
 * dossier. The rows come from pump.fun's own event stream (apps/worker/src/pumpFeed.ts), which only the laptop can hold open;
 * the hosted site shows the last snapshot the laptop pushed (kind "gradlist" in lab_reports, written by pushGraduates).
 */

import { gradFate, gradFlags, gradKind, isHealthy, summarizeFates, type GradFate, type GradKind, type KindSummary, type Reading } from "./lab/pump";

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface GraduateRow {
  mint: string;
  symbol: string | null;
  name: string | null;
  ageMin: number;
  createToMigrateMin: number | null;
  devBuySol: number | null;
  mayhem: boolean;
  creatorLaunches: number | null;
  kind: GradKind;
  /** a real pool that is still standing and is not one of the kinds measured to end in a drain: what is shown by default */
  healthy: boolean;
  /** why a coin is not shown by default (null when it is) */
  hiddenWhy: null | "drained" | "empty" | "born" | "mayhem" | "gone" | "small" | "waiting";
  empty: boolean;
  drained: boolean;
  mcap: number | null;
  liq: number | null;
  change1h: number | null;
  change5m: number | null;
  sinceFirst: number | null;
  peakMultiple: number | null;
  buys1h: number | null;
  sells1h: number | null;
  readingAgeMin: number | null;
  flags: string[];
}

export interface GraduatesReport {
  at: string;
  candidates: GraduateRow[];
  /** how each kind of graduation ended, over everything the lab has readings for (last 72 h) */
  summary: KindSummary[];
  /** pump.fun graduations followed for the whole 72 hours so far (the lessons), when there are enough */
  lab: { followed3d: number; held2: { p: number; k: number; n: number } } | null;
  /** "local" when read from this database, "laptop" when it is the snapshot the laptop pushed */
  source?: "local" | "laptop";
  /** when the snapshot was taken (laptop source) */
  asOf?: string;
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const at = (a: unknown, i: number) => (Array.isArray(a) ? num(a[i]) : null);

const KEEP_ROWS = 150;

export async function buildGraduates(db: Queryable): Promise<GraduatesReport> {
  const nowS = Date.now() / 1000;
  const grads = await db
    .query(
      `SELECT g.mint, COALESCE(g.symbol, w.symbol) AS symbol, COALESCE(g.name, w.name) AS name, EXTRACT(EPOCH FROM g.migrated_at)::float8 AS migrated_s, g.create_to_migrate_min, g.initial_buy_sol, g.mayhem,
              g.creator_launches_72h, w.note
         FROM pump_graduates g LEFT JOIN lab_watch w ON w.mint = g.mint
        WHERE g.migrated_at > now() - interval '72 hours' ORDER BY g.migrated_at DESC LIMIT 700`,
    )
    .then((r) => r.rows)
    .catch(() => [] as any[]);
  const lane = await db
    .query(`SELECT payload FROM lab_reports WHERE kind = 'lanes'`)
    .then((r) => ((r.rows[0]?.payload?.groups ?? []) as Array<{ id: string; basis: number; held2: { p: number; k: number; n: number } }>).find((g) => g.id === "pump"))
    .catch(() => undefined);
  const lab = lane && lane.basis >= 8 ? { followed3d: lane.basis, held2: lane.held2 } : null;
  if (!grads.length) return { at: new Date().toISOString(), candidates: [], summary: [], lab, source: "local" };

  const reads = await db
    .query(
      `SELECT s.mint, EXTRACT(EPOCH FROM s.taken_at)::float8 AS t, (s.payload->>'p')::float8 AS p, (s.payload->>'liq')::float8 AS liq,
              COALESCE((s.payload->>'mcap')::float8, (s.payload->>'fdv')::float8) AS mcap, s.payload->'pc' AS pc, s.payload->'b' AS b, s.payload->'s' AS s
         FROM lab_signals_ts s WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL AND s.mint = ANY($1::text[]) ORDER BY s.mint, s.taken_at`,
      [grads.map((g) => g.mint)],
    )
    .then((r) => r.rows)
    .catch(() => [] as any[]);
  const byMint = new Map<string, any[]>();
  for (const r of reads) {
    const l = byMint.get(r.mint);
    if (l) l.push(r);
    else byMint.set(r.mint, [r]);
  }

  const fates: Array<{ kind: GradKind; fate: GradFate }> = [];
  const rows: GraduateRow[] = [];
  for (const g of grads) {
    const rs = byMint.get(g.mint) ?? [];
    const readings: Reading[] = rs.map((r) => ({ t: r.t, p: num(r.p), liq: num(r.liq), mcap: num(r.mcap) }));
    const kind = gradKind({ createToMigrateMin: num(g.create_to_migrate_min), devBuySol: num(g.initial_buy_sol), mayhem: g.mayhem });
    const fate = readings.length ? gradFate(g.migrated_s, readings) : null;
    if (fate) fates.push({ kind, fate });
    if (rows.length >= KEEP_ROWS) continue;
    const last = rs.length ? rs[rs.length - 1] : null;
    const liq = last ? num(last.liq) : null;
    const gone = g.note === "gone";
    const healthy = !gone && isHealthy(kind, fate, liq);
    const hiddenWhy: GraduateRow["hiddenWhy"] = healthy ? null : gone ? "gone" : fate?.drained ? "drained" : fate?.empty ? "empty" : kind === "born" ? "born" : kind === "mayhem" ? "mayhem" : !fate ? "waiting" : "small";
    rows.push({
      mint: g.mint, symbol: g.symbol ?? null, name: g.name ?? null, ageMin: (nowS - g.migrated_s) / 60,
      createToMigrateMin: num(g.create_to_migrate_min), devBuySol: num(g.initial_buy_sol), mayhem: Boolean(g.mayhem), creatorLaunches: num(g.creator_launches_72h),
      kind, healthy, hiddenWhy, empty: Boolean(fate?.empty), drained: Boolean(fate?.drained),
      mcap: last ? num(last.mcap) : null, liq, change1h: last ? at(last.pc, 1) : null, change5m: last ? at(last.pc, 0) : null,
      sinceFirst: fate?.firstP && fate.lastP ? fate.lastP / fate.firstP : null, peakMultiple: fate?.peakMultiple ?? null,
      buys1h: last ? at(last.b, 1) : null, sells1h: last ? at(last.s, 1) : null,
      readingAgeMin: last ? Math.round((nowS - last.t) / 60) : null,
      flags: gradFlags(kind, fate, { creatorLaunches72h: num(g.creator_launches_72h), devBuySol: num(g.initial_buy_sol), gone }),
    });
  }
  return { at: new Date().toISOString(), candidates: rows, summary: summarizeFates(fates), lab, source: "local" };
}

/**
 * The laptop's snapshot for the hosted site: one small row in the hosted database's lab_reports (kind "gradlist"), replaced each time.
 * Additive: older code never reads this kind.
 */
export async function pushGraduates(local: Queryable, hosted: Queryable): Promise<{ coins: number } | null> {
  const g = await buildGraduates(local);
  if (!g.candidates.length) return null;
  // everything that is worth a look, plus the newest of the rest so the phone can still say what was hidden
  const keep = [...g.candidates.filter((c) => c.healthy).slice(0, 60), ...g.candidates.filter((c) => !c.healthy).slice(0, 40)].sort((a, b) => a.ageMin - b.ageMin);
  const slim: GraduatesReport = { ...g, candidates: keep, source: "laptop", asOf: g.at };
  await hosted.query(
    `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ('gradlist', now(), $1, $2::jsonb)
     ON CONFLICT (kind) DO UPDATE SET computed_at = now(), n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
    [slim.candidates.length, JSON.stringify(slim)],
  );
  return { coins: slim.candidates.length };
}

/** What the hosted site shows when its own database has no stream: the laptop's last snapshot, if there is one. */
export async function loadPushedGraduates(db: Queryable): Promise<GraduatesReport | null> {
  const r = await db.query(`SELECT payload, computed_at FROM lab_reports WHERE kind = 'gradlist'`).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0];
  if (!row?.payload) return null;
  const p = row.payload as GraduatesReport;
  const snapAt = new Date(row.computed_at).getTime();
  // ages in the snapshot were measured when it was taken: move them forward to now
  const lateMin = Math.max(0, (Date.now() - snapAt) / 60_000);
  return { ...p, candidates: (p.candidates ?? []).map((c) => ({ ...c, ageMin: c.ageMin + lateMin, readingAgeMin: c.readingAgeMin == null ? null : Math.round(c.readingAgeMin + lateMin) })), source: "laptop", asOf: new Date(snapAt).toISOString() };
}

let memo: { at: number; body: GraduatesReport } | null = null;

/**
 * What to show right now: this database's own graduations when the stream runs here, otherwise the laptop's last snapshot.
 * Reading a few hundred coins' price histories is the heaviest query involved and every open Radar asks every 15 seconds,
 * so one answer is shared for a minute (also by the coin dossier).
 */
export async function currentGraduates(db: Queryable): Promise<GraduatesReport> {
  if (memo && Date.now() - memo.at < 60_000) return memo.body;
  const local = await buildGraduates(db);
  const body = local.candidates.length > 0 ? local : (await loadPushedGraduates(db)) ?? local;
  memo = { at: Date.now(), body };
  return body;
}
