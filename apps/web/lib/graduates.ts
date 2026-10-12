/**
 * pump.fun graduations of the last 72 hours with the lab's readings of each, for the Radar's Graduations tab, Home and the coin
 * dossier. The rows come from pump.fun's own event stream (apps/worker/src/pumpFeed.ts), which only the laptop can hold open;
 * the hosted site shows the last snapshot the laptop pushed (kind "gradlist" in lab_reports, written by pushGraduates).
 */

import { gradFate, gradFlags, gradKind, isHealthy, summarizeFates, type GradFate, type GradKind, type KindSummary, type Reading } from "./lab/pump";
import { readingsOf, type FeedLog } from "./graduateFeed";

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** What RugCheck's report said about the holders shortly after the lab first saw the coin (fractions 0..1; lp is 0..100). */
export interface HolderFacts {
  holders: number | null;
  top1: number | null;
  top10: number | null;
  insPct: number | null;
  ins: number | null;
  lp: number | null;
  risks: string[];
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
  /** holder structure from RugCheck, when the lab has taken a snapshot of this coin */
  rc: HolderFacts | null;
}

export interface GraduatesReport {
  at: string;
  candidates: GraduateRow[];
  /** how each kind of graduation ended, over everything the lab has readings for (last 72 h) */
  summary: KindSummary[];
  /** pump.fun graduations followed for the whole 72 hours so far (the lessons), when there are enough */
  lab: { followed3d: number; held2: { p: number; k: number; n: number } } | null;
  /** "local" when read from this database's own stream rows (the laptop), "laptop" when it is the snapshot the laptop pushed, "chain" when the site read the graduations from the chain itself */
  source?: "local" | "laptop" | "chain";
  /** when the snapshot was taken (laptop source) or the chain feed last finished (chain source) */
  asOf?: string;
  /** the lab's readings could not be read this time (the query timed out): every coin then looks unread, so this list must not replace a good snapshot */
  degraded?: boolean;
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const at = (a: unknown, i: number) => (Array.isArray(a) ? num(a[i]) : null);

const KEEP_ROWS = 150;
/** The chain feed keeps a compact record per coin and refreshes it for a day, so the hosted tab shows the last 6 hours (about 330 coins): every Radar build reads them. */
const CHAIN_HOURS = 6;
/** A serial creator, by Jupiter's count of the tokens that wallet has minted. */
const SERIAL_MINTS = 10;

export async function buildGraduates(db: Queryable, opts: { chain?: boolean } = {}): Promise<GraduatesReport> {
  const nowS = Date.now() / 1000;
  // the chain feed's rows are the biggest read of this list (the hosted database charges for what it sends): currentGraduates leaves them out while the laptop's snapshot is fresh
  const withChain = opts.chain !== false;
  const grads = await db
    .query(
      `SELECT g.mint, COALESCE(g.symbol, w.symbol) AS symbol, COALESCE(g.name, w.name) AS name, EXTRACT(EPOCH FROM g.migrated_at)::float8 AS migrated_s, g.create_to_migrate_min, g.initial_buy_sol, g.mayhem,
              g.creator_launches_72h, w.note, g.via, g.facts
         FROM pump_graduates g LEFT JOIN lab_watch w ON w.mint = g.mint
        WHERE (g.via <> 'chain' AND g.migrated_at > now() - interval '72 hours') OR ($2::boolean AND g.via = 'chain' AND g.migrated_at > now() - make_interval(hours => $1::int))
        ORDER BY g.migrated_at DESC LIMIT 700`,
      [CHAIN_HOURS, withChain],
    )
    .then((r) => r.rows)
    .catch(() => [] as any[]);
  const lane = await db
    .query(`SELECT payload FROM lab_reports WHERE kind = 'lanes'`)
    .then((r) => ((r.rows[0]?.payload?.groups ?? []) as Array<{ id: string; basis: number; held2: { p: number; k: number; n: number } }>).find((g) => g.id === "pump"))
    .catch(() => undefined);
  const lab = lane && lane.basis >= 8 ? { followed3d: lane.basis, held2: lane.held2 } : null;
  if (!grads.length) return { at: new Date().toISOString(), candidates: [], summary: [], lab, source: "local" };

  // A failed read must not look like "no readings": the laptop's pool cancels a statement after 5 s and this one takes about 4 s when the machine is idle, so under load it does fail.
  // Without the flag every coin turned "waiting for a reading" and that list was pushed over the good one (the Graduations tab showed 0 for six minutes on 2026-10-13).
  let readsFailed = false;
  const reads = await db
    .query(
      `SELECT s.mint, EXTRACT(EPOCH FROM s.taken_at)::float8 AS t, (s.payload->>'p')::float8 AS p, (s.payload->>'liq')::float8 AS liq,
              COALESCE((s.payload->>'mcap')::float8, (s.payload->>'fdv')::float8) AS mcap, s.payload->'pc' AS pc, s.payload->'b' AS b, s.payload->'s' AS s
         FROM lab_signals_ts s WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL AND s.mint = ANY($1::text[]) ORDER BY s.mint, s.taken_at`,
      [grads.map((g) => g.mint)],
    )
    .then((r) => r.rows)
    .catch(() => {
      readsFailed = true;
      return [] as any[];
    });
  const rcRows = await db
    .query(`SELECT DISTINCT ON (mint) mint, payload FROM lab_signals_ts WHERE source = 'rugcheck' AND mint = ANY($1::text[]) ORDER BY mint, taken_at DESC`, [grads.map((g) => g.mint)])
    .then((r) => r.rows)
    .catch(() => [] as any[]);
  const rcBy = new Map<string, HolderFacts>();
  for (const r of rcRows) {
    const p = r.payload ?? {};
    rcBy.set(r.mint, { holders: num(p.holders), top1: num(p.top1), top10: num(p.top10), insPct: num(p.insPct), ins: num(p.ins), lp: num(p.lp), risks: Array.isArray(p.risks) ? p.risks.slice(0, 6) : [] });
  }
  const byMint = new Map<string, any[]>();
  for (const r of reads) {
    const l = byMint.get(r.mint);
    if (l) l.push(r);
    else byMint.set(r.mint, [r]);
  }

  const fates: Array<{ kind: GradKind; fate: GradFate }> = [];
  const rows: GraduateRow[] = [];
  let fromChain = false;
  for (const g of grads) {
    // the stream's coins have readings in the lab's tables; the chain feed's coins carry a compact record of theirs (lib/graduateFeed.ts)
    const chain = g.via === "chain";
    if (chain) fromChain = true;
    const log = chain ? (g.facts as FeedLog | null) : null;
    const rs = byMint.get(g.mint) ?? (log ? readingsOf(log) : []);
    const readings: Reading[] = rs.map((r) => ({ t: r.t, p: num(r.p), liq: num(r.liq), mcap: num(r.mcap) }));
    const ctm = num(g.create_to_migrate_min);
    // a coin from the chain that graduated within 2 minutes of its launch and whose creating transaction could not be read (yet) is treated as born: the safe way to be wrong
    const devBuy = chain && g.initial_buy_sol == null && ctm != null && ctm < 2 ? 100 : num(g.initial_buy_sol);
    const kind = gradKind({ createToMigrateMin: ctm, devBuySol: devBuy, mayhem: g.mayhem });
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
      flags: [
        ...gradFlags(kind, fate, { creatorLaunches72h: num(g.creator_launches_72h), devBuySol: num(g.initial_buy_sol), createToMigrateMin: num(g.create_to_migrate_min), gone, rc: rcBy.get(g.mint) ?? null }),
        ...((log?.dm ?? 0) >= SERIAL_MINTS ? [`serial creator (${log!.dm} tokens minted)`] : []),
      ],
      rc: rcBy.get(g.mint) ?? null,
    });
  }
  let asOf: string | undefined;
  if (fromChain) {
    const r = await db.query(`SELECT last_finished FROM scan_lease WHERE name = 'grad-feed'`).then((x) => x.rows[0]).catch(() => undefined);
    asOf = r?.last_finished ? new Date(r.last_finished).toISOString() : undefined;
  }
  return { at: new Date().toISOString(), candidates: rows, summary: summarizeFates(fates), lab, source: fromChain ? "chain" : "local", ...(asOf ? { asOf } : {}), ...(readsFailed ? { degraded: true } : {}) };
}

/**
 * The laptop's snapshot for the hosted site: one small row in the hosted database's lab_reports (kind "gradlist"), replaced each time.
 * Additive: older code never reads this kind.
 */
export async function pushGraduates(local: Queryable, hosted: Queryable): Promise<{ coins: number } | null> {
  const g = await buildGraduates(local);
  if (!g.candidates.length) return null;
  // readings that could not be read: keep the snapshot already there (the next round tries again; if it gets older than the freshness limit the site's own list takes over)
  if (g.degraded) return null;
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
/** For tests: forget the shared answer. */
export const resetGraduatesMemo = () => {
  memo = null;
};

/**
 * The laptop's pushed snapshot counts as live while it is younger than this: it pushes every 3 minutes while it is awake, so a snapshot older than two missed pushes means the laptop is
 * asleep or closed, and the site's own list (the chain feed, refreshed every 3 minutes) takes over. It was 20 minutes, which left a phone looking at a frozen list for 20 minutes
 * after the laptop was closed.
 */
const PUSHED_FRESH_MIN = 8;
/** A fresh snapshot with no coin worth a look and at least this many "waiting" coins counts as unread (see currentGraduates). */
const UNREAD_WAITING = 10;

/**
 * What to show right now:
 *   - on the laptop (its own stream rows): those;
 *   - on the hosted site while the laptop is awake and pushing: its snapshot, which knows more (who bought what at launch, creator history, holder structure);
 *   - otherwise the hosted site's own chain feed (lib/graduateFeed.ts), which does not depend on the laptop, and only if it has nothing the old snapshot.
 * Reading a few hundred coins' price histories is the heaviest query involved and every open Radar asks every 15 seconds,
 * so one answer is shared for a minute (also by the coin dossier).
 */
export async function currentGraduates(db: Queryable): Promise<GraduatesReport> {
  if (memo && Date.now() - memo.at < 60_000) return memo.body;
  const pushed = await loadPushedGraduates(db);
  const pushedFresh = pushed?.asOf != null && Date.now() - new Date(pushed.asOf).getTime() <= PUSHED_FRESH_MIN * 60_000;
  // A fresh snapshot in which nothing is worth a look and ten or more coins are still "waiting for a reading" was not read (the laptop's query timed out): the site's own list may know better.
  const pushedUnread = pushedFresh && !pushed!.candidates.some((c) => c.healthy) && pushed!.candidates.filter((c) => c.hiddenWhy === "waiting").length >= UNREAD_WAITING;
  // while the laptop's snapshot is fresh and read it wins anyway: do not read the chain rows at all
  const local = await buildGraduates(db, { chain: !pushedFresh || pushedUnread });
  const chainBetter = pushedUnread && local.source === "chain" && local.candidates.some((c) => c.healthy);
  const body =
    local.candidates.length > 0 && local.source !== "chain" ? local : pushed && pushedFresh && !chainBetter ? pushed : local.candidates.length > 0 ? local : pushed ?? local;
  memo = { at: Date.now(), body };
  return body;
}
