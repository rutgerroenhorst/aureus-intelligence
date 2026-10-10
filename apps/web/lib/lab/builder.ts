/**
 * Builds the lab's one-row-per-coin lessons from what the scanner stored: price and liquidity readings, the DexScreener
 * snapshot behind a reading, the holder enrichment and the lab's own collected series. Used by the hosted tick (a few coins
 * per run) and by the backfill script (everything the laptop database holds).
 */

import { buildFeatures, type Enrich, type Features, type PayloadRow, type Signals } from "./features";
import { cleanObs, nearestIndex, type Obs } from "./paths";
import { buildOutcome, forwardLabels, type Fwd, type Outcome } from "./outcomes";
import { tagsFor } from "./narrative";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Hours after the first look at which the lab freezes "what the coin looked like" and then watches what followed. */
export const TAUS = [0, 1, 3, 6, 12, 24] as const;

export interface Snap {
  tau: number;
  /** epoch seconds of the reading the snapshot is taken from */
  ts: number;
  f: Features;
  /** what the following 72 hours held; entries stay null until the window can be decided */
  y: Fwd | null;
}

export interface LabCoin {
  mint: string;
  chain: string;
  candidateId: string | null;
  symbol: string | null;
  name: string | null;
  lane: string;
  firstSeenAt: number;
  pairCreatedAt: number | null;
  firstPrice: number;
  firstMcap: number | null;
  firstLiq: number | null;
  lastSeenAt: number;
  observations: number;
  phantoms: number;
  tags: string[];
  snaps: Snap[];
  outcome: Outcome;
  status: "open" | "final";
}

export interface CandRow {
  /** null for coins from the lab's own watch list (they have no candidate in the scanner) */
  candidate_id: string | null;
  mint: string;
  chain: string;
  symbol: string | null;
  name: string | null;
  pool_id: string;
  discovered_at: number;
  pool_created: number | null;
  state: string | null;
  tier: string | null;
  discovery_source: string | null;
  /** fresh (the Radar's universe, the default) | graduate | runner */
  lane?: string;
  /** read from the lab's watch readings instead of the scanner's price history */
  watch?: boolean;
}

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/** The candidates that need (re)building, new ones first. */
export async function selectCandidates(db: Queryable, opts: { limit: number; all?: boolean; mints?: string[] }): Promise<CandRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.mints?.length) {
    params.push(opts.mints);
    where.push(`t.mint = ANY($${params.length}::text[])`);
  } else if (!opts.all) {
    // New coins once they have an hour of readings, and maturing coins every half hour.
    where.push(`((l.mint IS NULL AND c.discovered_at < now() - interval '60 minutes')
               OR (l.status = 'open' AND l.built_at < now() - interval '30 minutes'))`);
  }
  params.push(opts.limit);
  // One candidate per mint (the earliest), then the coins that have no lesson yet first, then the stalest lessons.
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.mint) c.id AS candidate_id, t.mint, t.chain::text AS chain, t.symbol_label AS symbol, t.name_label AS name,
              c.pool_id, EXTRACT(EPOCH FROM c.discovered_at)::float8 AS discovered_at,
              EXTRACT(EPOCH FROM p.created_at_src)::float8 AS pool_created,
              c.current_state::text AS state, c.monitoring_tier::text AS tier, c.discovery_source::text AS discovery_source,
              (l.mint IS NULL) AS is_new, l.built_at
         FROM candidates c
         JOIN tokens t ON t.id = c.token_id
         JOIN pools p ON p.id = c.pool_id
         LEFT JOIN lab_coins l ON l.mint = t.mint
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY t.mint, c.discovered_at
     ) x
     ORDER BY is_new DESC, built_at ASC NULLS FIRST
     LIMIT $${params.length}`,
    params,
  );
  return rows as CandRow[];
}

/**
 * Coins from the lab's own watch list that need a lesson: new ones once they have an hour of readings, maturing ones every half
 * hour. A coin the Radar has since adopted is left to its normal lesson.
 */
export async function selectWatch(db: Queryable, opts: { limit: number; all?: boolean; mints?: string[] }): Promise<CandRow[]> {
  const where: string[] = [`NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = w.mint)`];
  const params: unknown[] = [];
  if (opts.mints?.length) {
    params.push(opts.mints);
    where.push(`w.mint = ANY($${params.length}::text[])`);
  } else if (!opts.all) {
    where.push(`((l.mint IS NULL AND w.first_seen_at < now() - interval '60 minutes' AND w.polls >= 3) OR (l.status = 'open' AND l.built_at < now() - interval '30 minutes'))`);
  }
  params.push(opts.limit);
  const { rows } = await db.query(
    `SELECT w.mint, w.chain, w.symbol, w.name, w.lane, w.reason, w.note,
            EXTRACT(EPOCH FROM w.first_seen_at)::float8 AS discovered_at, EXTRACT(EPOCH FROM w.pair_created_at)::float8 AS pool_created,
            (l.mint IS NULL) AS is_new, l.built_at
       FROM lab_watch w LEFT JOIN lab_coins l ON l.mint = w.mint
      WHERE ${where.join(" AND ")}
      ORDER BY is_new DESC, l.built_at ASC NULLS FIRST
      LIMIT $${params.length}`,
    params,
  ).catch(() => ({ rows: [] as any[] }));
  return rows.map((r) => ({
    candidate_id: null, mint: r.mint, chain: r.chain ?? "solana", symbol: r.symbol, name: r.name, pool_id: `watch:${r.mint}`,
    discovered_at: r.discovered_at, pool_created: r.pool_created,
    // a coin the exchange stopped listing counts as dropped by its tracker (like a rejected one), so its end is not mistaken for a result
    state: r.note === "gone" ? "REJECTED" : "WATCH", tier: null, discovery_source: r.reason, lane: r.lane, watch: true,
  }));
}

interface RawObs extends Obs {
  eventId: string | null;
  /** the snapshot behind the reading, when the reading carries it itself (watch readings) */
  pay?: PayloadRow | null;
}

/** The snapshot a watch reading carries (compact arrays: [5 min, 1 h, 6 h, 24 h]) in the shape of a stored scanner snapshot. */
export function watchPay(x: any): PayloadRow {
  const at = (a: unknown, i: number) => (Array.isArray(a) ? fin(a[i]) : null);
  return {
    pc_m5: at(x.pc, 0), pc_h1: at(x.pc, 1), pc_h6: at(x.pc, 2), pc_h24: at(x.pc, 3),
    v_m5: at(x.v, 0), v_h1: at(x.v, 1), v_h6: at(x.v, 2), v_h24: at(x.v, 3),
    b_m5: at(x.b, 0), s_m5: at(x.s, 0), b_h1: at(x.b, 1), s_h1: at(x.s, 1), b_h6: at(x.b, 2), s_h6: at(x.s, 2), b_h24: at(x.b, 3), s_h24: at(x.s, 3),
    liq: fin(x.liq), mcap: fin(x.mcap), fdv: fin(x.fdv), price: fin(x.p), boosts: fin(x.bo),
    dex: x.dex ?? null, quote: x.q ?? null, n_web: fin(x.nw), n_soc: fin(x.ns), site: x.site ?? null, created_ms: fin(x.pcm),
  };
}

async function loadWatchObs(db: Queryable, mints: string[]): Promise<Map<string, RawObs[]>> {
  const out = new Map<string, RawObs[]>();
  if (!mints.length) return out;
  const { rows } = await db.query(
    `SELECT mint, EXTRACT(EPOCH FROM taken_at)::float8 AS ts, payload FROM lab_signals_ts
      WHERE source = 'watch' AND mint = ANY($1::text[]) ORDER BY taken_at`,
    [mints],
  ).catch(() => ({ rows: [] as any[] }));
  for (const r of rows) {
    const x = r.payload ?? {};
    const p = fin(x.p);
    if (x.gone || p == null || p <= 0) continue;
    const pay = watchPay(x);
    const a = out.get(`watch:${r.mint}`) ?? [];
    a.push({ t: r.ts, p, liq: pay.liq, mcap: pay.mcap ?? pay.fdv, eventId: null, pay });
    out.set(`watch:${r.mint}`, a);
  }
  return out;
}

async function loadObs(db: Queryable, rows: CandRow[]): Promise<Map<string, RawObs[]>> {
  const watchRows = rows.filter((r) => r.watch);
  if (watchRows.length) {
    const out = await loadWatchObs(db, watchRows.map((r) => r.mint));
    const rest = rows.filter((r) => !r.watch);
    if (rest.length) for (const [k, v] of await loadObs(db, rest)) out.set(k, v);
    return out;
  }
  const poolIds = rows.map((r) => r.pool_id);
  const prices = await db.query(
    `SELECT pool_id, EXTRACT(EPOCH FROM observed_at)::float8 AS t, price_usd::float8 AS p, market_cap_usd::float8 AS mcap, raw_event_id
       FROM prices WHERE pool_id = ANY($1::uuid[]) AND price_usd IS NOT NULL AND price_usd > 0
      ORDER BY pool_id, observed_at`,
    [poolIds],
  );
  const liqs = await db.query(
    `SELECT pool_id, EXTRACT(EPOCH FROM observed_at)::float8 AS t, liquidity_usd::float8 AS liq
       FROM liquidity_snapshots WHERE pool_id = ANY($1::uuid[]) AND liquidity_usd IS NOT NULL
      ORDER BY pool_id, observed_at`,
    [poolIds],
  );
  const liqBy = new Map<string, Array<[number, number]>>();
  for (const r of liqs.rows) {
    const a = liqBy.get(r.pool_id) ?? [];
    a.push([r.t, r.liq]);
    liqBy.set(r.pool_id, a);
  }
  const out = new Map<string, RawObs[]>();
  const cursor = new Map<string, number>();
  for (const r of prices.rows) {
    const ls = liqBy.get(r.pool_id) ?? [];
    let k = cursor.get(r.pool_id) ?? -1;
    while (k + 1 < ls.length && ls[k + 1]![0] <= r.t) k++;
    cursor.set(r.pool_id, k);
    const liq = k >= 0 && r.t - ls[k]![0] <= 3 * 3600 ? ls[k]![1] : null;
    const a = out.get(r.pool_id) ?? [];
    a.push({ t: r.t, p: r.p, liq, mcap: r.mcap, eventId: r.raw_event_id ?? null });
    out.set(r.pool_id, a);
  }
  // Readings the lab took itself for coins the scanner stopped following.
  const mints = rows.map((r) => r.mint);
  const tail = await db.query(
    `SELECT mint, EXTRACT(EPOCH FROM taken_at)::float8 AS ts, payload FROM lab_signals_ts
      WHERE source = 'price_tail' AND mint = ANY($1::text[]) ORDER BY taken_at`,
    [mints],
  ).catch(() => ({ rows: [] as any[] }));
  const poolOfMint = new Map(rows.map((r) => [r.mint, r.pool_id]));
  for (const r of tail.rows) {
    const pid = poolOfMint.get(r.mint);
    if (!pid) continue;
    const p = fin(r.payload?.p);
    if (p == null || p <= 0) continue;
    const a = out.get(pid) ?? [];
    a.push({ t: r.ts, p, liq: fin(r.payload?.liq), mcap: fin(r.payload?.mcap), eventId: null });
    out.set(pid, a);
  }
  // Hourly closes fetched afterwards for coins the scanner stopped following (one row per coin: {candles: [[t, close], ...]}).
  const candles = await db.query(
    `SELECT mint, payload FROM lab_signals_ts WHERE source = 'candle_tail' AND mint = ANY($1::text[])`,
    [mints],
  ).catch(() => ({ rows: [] as any[] }));
  for (const r of candles.rows) {
    const pid = poolOfMint.get(r.mint);
    if (!pid) continue;
    const a = out.get(pid) ?? [];
    const lastScan = a.length ? a[a.length - 1]!.t : 0;
    for (const c of (r.payload?.candles ?? []) as Array<[number, number]>) {
      if (c[0] > lastScan + 600 && c[1] > 0) a.push({ t: c[0], p: c[1], liq: null, mcap: null, eventId: null });
    }
    out.set(pid, a);
  }
  for (const a of out.values()) a.sort((x, y) => x.t - y.t);
  return out;
}

async function loadPayloads(db: Queryable, ids: string[]): Promise<Map<string, PayloadRow>> {
  const out = new Map<string, PayloadRow>();
  if (!ids.length) return out;
  const { rows } = await db.query(
    `SELECT id,
            (payload->'priceChange'->>'m5')::float8 AS pc_m5, (payload->'priceChange'->>'h1')::float8 AS pc_h1,
            (payload->'priceChange'->>'h6')::float8 AS pc_h6, (payload->'priceChange'->>'h24')::float8 AS pc_h24,
            (payload->'volume'->>'m5')::float8 AS v_m5, (payload->'volume'->>'h1')::float8 AS v_h1,
            (payload->'volume'->>'h6')::float8 AS v_h6, (payload->'volume'->>'h24')::float8 AS v_h24,
            (payload->'txns'->'m5'->>'buys')::float8 AS b_m5, (payload->'txns'->'m5'->>'sells')::float8 AS s_m5,
            (payload->'txns'->'h1'->>'buys')::float8 AS b_h1, (payload->'txns'->'h1'->>'sells')::float8 AS s_h1,
            (payload->'txns'->'h6'->>'buys')::float8 AS b_h6, (payload->'txns'->'h6'->>'sells')::float8 AS s_h6,
            (payload->'txns'->'h24'->>'buys')::float8 AS b_h24, (payload->'txns'->'h24'->>'sells')::float8 AS s_h24,
            (payload->'liquidity'->>'usd')::float8 AS liq, (payload->>'marketCap')::float8 AS mcap, (payload->>'fdv')::float8 AS fdv,
            (payload->>'priceUsd')::float8 AS price, COALESCE((payload->'boosts'->>'active')::float8, 0) AS boosts,
            payload->>'dexId' AS dex, payload->'quoteToken'->>'symbol' AS quote,
            COALESCE(jsonb_array_length(payload->'info'->'websites'), 0) AS n_web,
            COALESCE(jsonb_array_length(payload->'info'->'socials'), 0) AS n_soc,
            payload->'info'->'websites'->0->>'url' AS site,
            (payload->>'pairCreatedAt')::float8 AS created_ms
       FROM raw_events WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  for (const r of rows) {
    out.set(r.id, {
      pc_m5: fin(r.pc_m5), pc_h1: fin(r.pc_h1), pc_h6: fin(r.pc_h6), pc_h24: fin(r.pc_h24),
      v_m5: fin(r.v_m5), v_h1: fin(r.v_h1), v_h6: fin(r.v_h6), v_h24: fin(r.v_h24),
      b_m5: fin(r.b_m5), s_m5: fin(r.s_m5), b_h1: fin(r.b_h1), s_h1: fin(r.s_h1), b_h6: fin(r.b_h6), s_h6: fin(r.s_h6), b_h24: fin(r.b_h24), s_h24: fin(r.s_h24),
      liq: fin(r.liq), mcap: fin(r.mcap), fdv: fin(r.fdv), price: fin(r.price), boosts: fin(r.boosts),
      dex: r.dex ?? null, quote: r.quote ?? null, n_web: fin(r.n_web), n_soc: fin(r.n_soc), site: r.site ?? null, created_ms: fin(r.created_ms),
    });
  }
  return out;
}

async function loadEnrichment(db: Queryable, ids: string[]): Promise<Map<string, Enrich>> {
  const out = new Map<string, Enrich>();
  const { rows } = await db.query(
    `SELECT candidate_id, (intel->'onChain'->>'largestHolderPct')::float8 AS top1, (intel->'onChain'->>'top5Pct')::float8 AS top5,
            (intel->'onChain'->>'insiderPct')::float8 AS insider, (intel->'onChain'->>'holderTop10Pct')::float8 AS top10
       FROM onchain_enrichment WHERE candidate_id = ANY($1::uuid[])`,
    [ids],
  ).catch(() => ({ rows: [] as any[] }));
  for (const r of rows) out.set(r.candidate_id, { top1: fin(r.top1), top5: fin(r.top5), insider: fin(r.insider), top10: fin(r.top10) });
  return out;
}

/** The lab's collected series nearest to a moment (within 25 minutes), merged into the signals a snapshot can use. */
async function loadSignals(db: Queryable, mints: string[]): Promise<Map<string, Array<{ ts: number; s: Signals }>>> {
  const out = new Map<string, Array<{ ts: number; s: Signals }>>();
  const { rows } = await db.query(
    `SELECT mint, EXTRACT(EPOCH FROM taken_at)::float8 AS ts, source, payload FROM lab_signals_ts
      WHERE source IN ('gecko_multi', 'jupiter') AND mint = ANY($1::text[]) ORDER BY taken_at`,
    [mints],
  ).catch(() => ({ rows: [] as any[] }));
  for (const r of rows) {
    const a = out.get(r.mint) ?? [];
    const sig: Signals = {};
    const p = r.payload ?? {};
    if (r.source === "gecko_multi") {
      sig.buyers_h1 = fin(p.buyers_h1); sig.sellers_h1 = fin(p.sellers_h1); sig.buys_h1 = fin(p.buys_h1); sig.sells_h1 = fin(p.sells_h1);
      sig.buyers_h24 = fin(p.buyers_h24); sig.sellers_h24 = fin(p.sellers_h24);
    } else {
      sig.organic_score = fin(p.organic_score); sig.holders = fin(p.holders); sig.organic_buyers_h24 = fin(p.organic_buyers_h24);
    }
    a.push({ ts: r.ts, s: sig });
    out.set(r.mint, a);
  }
  return out;
}

function signalsNear(list: Array<{ ts: number; s: Signals }> | undefined, t: number): Signals | null {
  if (!list?.length) return null;
  let merged: Signals | null = null;
  for (const e of list) {
    if (Math.abs(e.ts - t) > 25 * 60) continue;
    merged = { ...(merged ?? {}), ...Object.fromEntries(Object.entries(e.s).filter(([, v]) => v != null)) };
  }
  return merged;
}

export interface BuildResult {
  coins: LabCoin[];
  skipped: Array<{ mint: string; reason: string }>;
}

/** Turn candidate rows into lessons. `now` is epoch seconds (the end of the data when replaying history). */
export async function buildCoins(db: Queryable, rows: CandRow[], now: number): Promise<BuildResult> {
  const result: BuildResult = { coins: [], skipped: [] };
  if (!rows.length) return result;
  const obsBy = await loadObs(db, rows);
  const enrBy = await loadEnrichment(db, rows.map((r) => r.candidate_id).filter((x): x is string => !!x));
  const sigBy = await loadSignals(db, rows.map((r) => r.mint));

  // Decide which readings need their stored snapshot, then fetch them in one go.
  interface Prep { row: CandRow; raw: RawObs[]; clean: RawObs[]; phantoms: number; picks: Array<{ tau: number; idx: number }> }
  const preps: Prep[] = [];
  const want = new Set<string>();
  for (const row of rows) {
    const raw = obsBy.get(row.pool_id) ?? [];
    if (raw.length < 1) {
      result.skipped.push({ mint: row.mint, reason: "no readings" });
      continue;
    }
    const { clean: c0, phantoms } = cleanObs(raw);
    const clean = c0 as RawObs[];
    if (clean.length < 1) {
      result.skipped.push({ mint: row.mint, reason: "no clean readings" });
      continue;
    }
    const t0 = clean[0]!.t;
    const picks: Array<{ tau: number; idx: number }> = [];
    // The coin as it stands now (tau -1) feeds the live view; it is not a decision moment of its own.
    const lastIdx = clean.length - 1;
    if (lastIdx > 0 && now - clean[lastIdx]!.t < 6 * 3600 && (clean[lastIdx]!.eventId || clean[lastIdx]!.pay)) {
      if (clean[lastIdx]!.eventId) want.add(clean[lastIdx]!.eventId!);
      picks.push({ tau: -1, idx: lastIdx });
    }
    for (const tau of TAUS) {
      const target = t0 + tau * 3600;
      const idx = tau === 0 ? 0 : nearestIndex(clean, target);
      if (idx < 0) continue;
      const tol = tau === 0 ? 0 : Math.max(1800, 0.3 * tau * 3600);
      if (Math.abs(clean[idx]!.t - target) > tol) continue;
      if (picks.some((q) => q.tau >= 0 && q.idx === idx)) continue;
      picks.push({ tau, idx });
      const ev = clean[idx]!.eventId;
      if (ev) want.add(ev);
    }
    preps.push({ row, raw, clean, phantoms, picks });
  }
  const payloads = await loadPayloads(db, [...want]);
  const payOf = (o: RawObs): PayloadRow | null => o.pay ?? (o.eventId ? payloads.get(o.eventId) ?? null : null);

  for (const pr of preps) {
    const { row, clean } = pr;
    const t0 = clean[0]!.t;
    const first = { t0, p0: clean[0]!.p, liq0: clean.find((o) => o.liq != null && o.liq > 0)?.liq ?? null };
    const trackingEnded = row.state === "REJECTED" || row.state === "EXPIRED" || row.tier === "TIER0_DORMANT";
    const outcome = buildOutcome(clean, { now, trackingEnded });
    if (!outcome) {
      result.skipped.push({ mint: row.mint, reason: "no usable outcome" });
      continue;
    }
    const firstPay = payOf(clean[0]!);
    const tags = tagsFor(row.name, row.symbol, firstPay?.site);
    if (row.watch && row.discovery_source) tags.push(`via:${row.discovery_source}`);
    const rule = "auto" as const;
    const enr = row.candidate_id ? enrBy.get(row.candidate_id) ?? null : null;
    const sigList = sigBy.get(row.mint);
    const snaps: Snap[] = [];
    for (const { tau, idx } of pr.picks) {
      const pay = payOf(clean[idx]!);
      const f = buildFeatures({ tau, clean, idx, first, pay, enr, tags, signals: signalsNear(sigList, clean[idx]!.t) });
      if (tau < 0) outcome.now = { ts: clean[idx]!.t, ageH: (clean[idx]!.t - t0) / 3600, f };
      else snaps.push({ tau, ts: clean[idx]!.t, f, y: forwardLabels(clean, idx, { rule }) });
    }
    const ageH = outcome.ageH;
    const status: "open" | "final" = outcome.censored || (outcome.cls !== "OPEN" && ageH >= 100) || now - t0 > 8 * 86400 ? "final" : "open";
    result.coins.push({
      mint: row.mint,
      chain: row.chain || "solana",
      candidateId: row.candidate_id,
      symbol: row.symbol,
      name: row.name,
      lane: row.lane ?? "fresh",
      firstSeenAt: t0,
      pairCreatedAt: row.pool_created,
      firstPrice: first.p0,
      firstMcap: clean[0]!.mcap ?? null,
      firstLiq: first.liq0,
      lastSeenAt: outcome.lastT,
      observations: clean.length,
      phantoms: pr.phantoms,
      tags,
      snaps,
      outcome,
      status,
    });
  }
  return result;
}

/**
 * A rebuilt lesson replaces the stored one only if it is at least as complete. A database that keeps 7 days of history
 * rebuilds a truncated lesson for an older coin, and a lesson pushed from the laptop may be built from more readings: neither
 * may be overwritten by the poorer one. Same start (within 45 minutes): the one with more readings or a later end wins.
 * A clearly earlier start wins (more of the coin's life). A later start never wins.
 */
export const REPLACE_IF_MORE_COMPLETE = `(
  EXCLUDED.first_seen_at < lab_coins.first_seen_at - interval '45 minutes'
  OR (EXCLUDED.first_seen_at <= lab_coins.first_seen_at + interval '45 minutes'
      AND (EXCLUDED.observations >= lab_coins.observations OR EXCLUDED.last_seen_at > lab_coins.last_seen_at)))`;

/** Write lessons; a stored lesson is only replaced by one that is at least as complete (see REPLACE_IF_MORE_COMPLETE). */
export async function saveCoins(db: Queryable, coins: LabCoin[], source: string): Promise<number> {
  let n = 0;
  for (const c of coins) {
    const r = await db.query(
      `INSERT INTO lab_coins (mint, chain, candidate_id, symbol, name, lane, first_seen_at, pair_created_at, first_price, first_mcap, first_liq,
                              last_seen_at, observations, phantoms, tags, snaps, outcome, status, source, built_at)
       VALUES ($1,$2,$3,$4,$5,$6, to_timestamp($7), CASE WHEN $8::float8 IS NULL THEN NULL ELSE to_timestamp($8::float8) END, $9,$10,$11,
               to_timestamp($12), $13,$14,$15::text[],$16::jsonb,$17::jsonb,$18,$19, now())
       ON CONFLICT (mint) DO UPDATE SET
         candidate_id = EXCLUDED.candidate_id, symbol = EXCLUDED.symbol, name = EXCLUDED.name, lane = EXCLUDED.lane,
         first_seen_at = EXCLUDED.first_seen_at, pair_created_at = EXCLUDED.pair_created_at, first_price = EXCLUDED.first_price,
         first_mcap = EXCLUDED.first_mcap, first_liq = EXCLUDED.first_liq, last_seen_at = EXCLUDED.last_seen_at,
         observations = EXCLUDED.observations, phantoms = EXCLUDED.phantoms, tags = EXCLUDED.tags, snaps = EXCLUDED.snaps,
         outcome = EXCLUDED.outcome, status = EXCLUDED.status, source = EXCLUDED.source, built_at = now()
       WHERE ${REPLACE_IF_MORE_COMPLETE}`,
      [
        c.mint, c.chain, c.candidateId, c.symbol, c.name, c.lane, c.firstSeenAt, c.pairCreatedAt, c.firstPrice, c.firstMcap, c.firstLiq,
        c.lastSeenAt, c.observations, c.phantoms, c.tags, JSON.stringify(c.snaps), JSON.stringify(c.outcome), c.status, source,
      ],
    );
    if ((r.rowCount ?? 0) > 0) n++;
    // A richer lesson from another database is kept; still note that this one was looked at, so it is not picked again at once.
    else await db.query(`UPDATE lab_coins SET built_at = now() WHERE mint = $1`, [c.mint]);
  }
  return n;
}

/** Read every lesson back for the reports (small rows, one pass). */
export async function loadLabCoins(db: Queryable): Promise<LabCoin[]> {
  const { rows } = await db.query(
    `SELECT mint, chain, candidate_id, symbol, name, lane, EXTRACT(EPOCH FROM first_seen_at)::float8 AS first_seen,
            EXTRACT(EPOCH FROM pair_created_at)::float8 AS pair_created, first_price::float8 AS first_price, first_mcap::float8 AS first_mcap,
            first_liq::float8 AS first_liq, EXTRACT(EPOCH FROM last_seen_at)::float8 AS last_seen, observations, phantoms, tags, snaps, outcome, status
       FROM lab_coins ORDER BY first_seen_at`,
  );
  return rows.map((r) => ({
    mint: r.mint, chain: r.chain, candidateId: r.candidate_id, symbol: r.symbol, name: r.name, lane: r.lane,
    firstSeenAt: r.first_seen, pairCreatedAt: r.pair_created, firstPrice: r.first_price, firstMcap: r.first_mcap, firstLiq: r.first_liq,
    lastSeenAt: r.last_seen, observations: r.observations, phantoms: r.phantoms, tags: r.tags ?? [], snaps: r.snaps ?? [], outcome: r.outcome, status: r.status,
  }));
}
