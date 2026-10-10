/**
 * The lab's own watch list: coins the Radar's door does not let in.
 *
 * Two feeds put coins on it (lab_watch, migration 0029):
 *   - the worker's discovery pass writes what the door refused as too young (lane "graduate") or too big (lane "runner");
 *   - this file reads Jupiter's free "top organic score / most traded / trending" lists and adds coins that look like HOTBOT did
 *     when the user found it: a few hours to two months old, $0.3M-$150M, real liquidity, organic trading, thousands of holders.
 *
 * `collectWatch` then polls every watched coin from DexScreener (30 mints a call) and stores one compact snapshot per reading in
 * lab_signals_ts (source "watch"); the builder turns those readings into lessons exactly like scanner readings. None of this
 * touches the Radar's candidates, tabs or scoring.
 */

import type { Queryable } from "./builder";

const HEADERS = { accept: "application/json", "user-agent": "Aureus-Lab/1.0" };
const HOSTED = Boolean(process.env.VERCEL);

/** How many coins may be watched at once, and how many new ones one pass may add (the hosted database is small). */
export const WATCH_CAP = HOSTED ? 120 : 600;
const MAX_NEW_PER_SCAN = HOSTED ? 12 : 30;
export const WATCH_DAYS = 7;
/** Minutes between two readings of one coin: first 6 hours, then up to 48 hours, then the rest of the week. */
const POLL_EVERY_MIN = HOSTED ? [20, 60, 180] : [8, 30, 120];
/** How often Jupiter's lists are read. */
const RUNNER_SCAN_EVERY_MIN = HOSTED ? 50 : 20;
/** A coin the exchange has not listed this many polls in a row is dropped from the watch list. */
const GONE_AFTER = 4;

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

async function getJson(url: string, timeoutMs = 20_000): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** What a coin from one of Jupiter's lists must look like to join the runner lane. */
export const RUNNER = {
  minMcap: 300_000,
  maxMcap: 150_000_000,
  minLiq: 40_000,
  /** days since the first pool (3 hours to 60 days): younger coins are the Radar's, older ones are established tokens */
  minAgeDays: 0.125,
  maxAgeDays: 60,
  minOrganic: 30,
  minHolders: 300,
};

export interface JupToken {
  id?: string;
  symbol?: string;
  name?: string;
  mcap?: number;
  fdv?: number;
  liquidity?: number;
  holderCount?: number;
  organicScore?: number;
  launchpad?: string | null;
  firstPool?: { createdAt?: string };
  stats24h?: { numTraders?: number };
}

export function isRunnerLike(t: JupToken, nowMs: number): boolean {
  const mcap = fin(t.mcap) ?? fin(t.fdv);
  const liq = fin(t.liquidity);
  const created = t.firstPool?.createdAt ? Date.parse(t.firstPool.createdAt) : NaN;
  if (!t.id || mcap == null || liq == null || !Number.isFinite(created)) return false;
  const ageDays = (nowMs - created) / 86_400_000;
  if (mcap < RUNNER.minMcap || mcap > RUNNER.maxMcap || liq < RUNNER.minLiq) return false;
  if (ageDays < RUNNER.minAgeDays || ageDays > RUNNER.maxAgeDays) return false;
  if ((fin(t.organicScore) ?? 0) < RUNNER.minOrganic) return false;
  // holder count is sometimes missing for very new coins: then the number of distinct traders has to carry it
  const holders = fin(t.holderCount) ?? fin(t.stats24h?.numTraders) ?? 0;
  return holders >= RUNNER.minHolders;
}

const LISTS: Array<{ path: string; reason: "jupiter_organic" | "jupiter_traded" | "jupiter_trending" }> = [
  { path: "toporganicscore/24h", reason: "jupiter_organic" },
  { path: "toporganicscore/6h", reason: "jupiter_organic" },
  { path: "toptraded/24h", reason: "jupiter_traded" },
  { path: "toptraded/6h", reason: "jupiter_traded" },
  { path: "toptrending/6h", reason: "jupiter_trending" },
];

/**
 * Read Jupiter's top lists and put coins that look like runners on the watch list. At most every RUNNER_SCAN_EVERY_MIN minutes,
 * at most MAX_NEW_PER_SCAN new coins, never a coin the Radar already follows, and never beyond WATCH_CAP coins at once.
 */
export async function discoverRunners(db: Queryable, opts: { force?: boolean } = {}): Promise<{ skipped?: string; lists?: number; seen?: number; runnerLike?: number; added?: number }> {
  if (!opts.force) {
    const { rows } = await db.query(
      `SELECT EXTRACT(EPOCH FROM (now() - max(taken_at)))::float8 AS age_s FROM lab_signals_ts WHERE source = 'runner_scan'`,
    );
    const age = rows[0]?.age_s;
    if (age != null && age < RUNNER_SCAN_EVERY_MIN * 60) return { skipped: `scanned ${Math.round(age / 60)} min ago` };
  }
  const { rows: cnt } = await db.query(`SELECT count(*)::int AS n FROM lab_watch WHERE active`);
  const room = WATCH_CAP - (cnt[0]?.n ?? 0);
  const now = Date.now();
  const found = new Map<string, { t: JupToken; reason: string }>();
  let lists = 0;
  for (const l of LISTS) {
    const json = await getJson(`https://lite-api.jup.ag/tokens/v2/${l.path}?limit=100`);
    if (!Array.isArray(json)) continue;
    lists++;
    for (const t of json as JupToken[]) if (t.id && !found.has(t.id) && isRunnerLike(t, now)) found.set(t.id, { t, reason: l.reason });
  }
  let added = 0;
  if (room > 0 && found.size) {
    // biggest first: a $5M coin with half a million of liquidity says more about "runners" than a $350K one
    const pick = [...found.values()].sort((a, b) => (fin(b.t.mcap) ?? 0) - (fin(a.t.mcap) ?? 0));
    const res = await db.query(
      `INSERT INTO lab_watch (mint, lane, reason, symbol, name, launchpad, pair_created_at, first_mcap, first_liq, watch_until)
       SELECT v.mint, 'runner', v.reason, v.symbol, v.name, v.launchpad, v.created::timestamptz, v.mcap, v.liq, now() + make_interval(days => $9)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::float8[], $8::float8[]) AS v(mint, reason, symbol, name, launchpad, created, mcap, liq)
        WHERE NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = v.mint)
          AND NOT EXISTS (SELECT 1 FROM lab_coins l WHERE l.mint = v.mint)
          AND NOT EXISTS (SELECT 1 FROM lab_watch w WHERE w.mint = v.mint)
        ORDER BY v.mcap DESC NULLS LAST
        LIMIT $10
       ON CONFLICT (mint) DO NOTHING
       RETURNING mint`,
      [
        pick.map((x) => x.t.id),
        pick.map((x) => x.reason),
        pick.map((x) => x.t.symbol ?? null),
        pick.map((x) => x.t.name ?? null),
        pick.map((x) => x.t.launchpad ?? null),
        pick.map((x) => x.t.firstPool?.createdAt ?? null),
        pick.map((x) => fin(x.t.mcap) ?? fin(x.t.fdv)),
        pick.map((x) => fin(x.t.liquidity)),
        WATCH_DAYS,
        Math.min(room, MAX_NEW_PER_SCAN),
      ],
    );
    added = res.rowCount ?? 0;
    // What Jupiter said about each new coin at this moment is its first "organic score / holders" reading (the first lesson snapshot uses it).
    const fresh = new Set<string>(res.rows.map((r: { mint: string }) => r.mint));
    const sig = pick.filter((x) => fresh.has(x.t.id!));
    if (sig.length) {
      await db.query(
        `INSERT INTO lab_signals_ts (mint, source, payload) SELECT m, 'jupiter', p::jsonb FROM unnest($1::text[], $2::text[]) AS v(m, p)`,
        [sig.map((x) => x.t.id), sig.map((x) => JSON.stringify({ organic_score: fin(x.t.organicScore), holders: fin(x.t.holderCount), traders_h24: fin(x.t.stats24h?.numTraders), launchpad: x.t.launchpad ?? null }))],
      );
    }
  }
  await db.query(`INSERT INTO lab_signals_ts (mint, source, payload) VALUES ('_scan_', 'runner_scan', $1::jsonb)`, [JSON.stringify({ lists, seen: found.size, added })]);
  return { lists, seen: found.size, runnerLike: found.size, added };
}

/** A DexScreener pair reduced to the numbers the lab's features read (same field names as a stored scanner snapshot). */
export function pairToRow(p: any, t: number): Record<string, unknown> {
  const arr4 = (o: any) => [fin(o?.m5), fin(o?.h1), fin(o?.h6), fin(o?.h24)];
  const tx = (side: "buys" | "sells") => [fin(p.txns?.m5?.[side]), fin(p.txns?.h1?.[side]), fin(p.txns?.h6?.[side]), fin(p.txns?.h24?.[side])];
  return {
    t,
    p: fin(p.priceUsd),
    liq: fin(p.liquidity?.usd),
    mcap: fin(p.marketCap),
    fdv: fin(p.fdv),
    pc: arr4(p.priceChange),
    v: arr4(p.volume),
    b: tx("buys"),
    s: tx("sells"),
    dex: p.dexId ?? null,
    q: p.quoteToken?.symbol ?? null,
    nw: Array.isArray(p.info?.websites) ? p.info.websites.length : 0,
    ns: Array.isArray(p.info?.socials) ? p.info.socials.length : 0,
    site: p.info?.websites?.[0]?.url ?? null,
    bo: fin(p.boosts?.active) ?? 0,
    pcm: fin(p.pairCreatedAt),
  };
}

/**
 * Poll the coins that are due: first 6 hours every few minutes, then less often. One DexScreener call per 30 coins, at most
 * `maxCalls` calls. A call that fails proves nothing about its coins and is simply tried again next round.
 */
export async function collectWatch(db: Queryable, opts: { maxCalls?: number } = {}): Promise<{ polled: number; saved: number; gone: number; closed: number }> {
  // The Radar adopted these coins (they now have a candidate and a normal lesson), or their week is over.
  const adopted = await db.query(
    `UPDATE lab_watch w SET active = false, note = 'radar'
      WHERE w.active AND EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = w.mint)`,
  );
  const expired = await db.query(`UPDATE lab_watch SET active = false, note = COALESCE(note, 'done') WHERE active AND watch_until < now()`);
  const { rows } = await db.query(
    `SELECT mint FROM lab_watch w
      WHERE w.active AND (w.last_polled_at IS NULL OR w.last_polled_at < now() - make_interval(mins =>
              CASE WHEN w.first_seen_at > now() - interval '6 hours' THEN $1::int
                   WHEN w.first_seen_at > now() - interval '48 hours' THEN $2::int ELSE $3::int END))
      ORDER BY w.last_polled_at NULLS FIRST, w.first_seen_at DESC
      LIMIT $4`,
    [POLL_EVERY_MIN[0], POLL_EVERY_MIN[1], POLL_EVERY_MIN[2], (opts.maxCalls ?? 5) * 30],
  );
  const mints: string[] = rows.map((r) => r.mint);
  const out: Array<{ mint: string; payload: unknown }> = [];
  const polled = new Set<string>();
  const seenNow = new Map<string, any>();
  const goneNow: string[] = [];
  const now = Date.now() / 1000;
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`);
    if (!Array.isArray(pairs)) continue;
    const best = new Map<string, any>();
    for (const p of pairs) {
      const m = p?.baseToken?.address;
      if (!m || !batch.includes(m)) continue;
      if (!best.has(m) || (p.liquidity?.usd ?? 0) > (best.get(m).liquidity?.usd ?? 0)) best.set(m, p);
    }
    for (const m of batch) {
      polled.add(m);
      const p = best.get(m);
      if (p && (fin(p.priceUsd) ?? 0) > 0) {
        out.push({ mint: m, payload: pairToRow(p, now) });
        seenNow.set(m, p);
      } else if (batch.length >= 3 && best.size > 0) {
        // The exchange answered for other coins of the batch but lists nothing for this one: record it, do not guess.
        out.push({ mint: m, payload: { t: now, gone: true } });
        goneNow.push(m);
      }
    }
  }
  if (out.length) {
    await db.query(
      `INSERT INTO lab_signals_ts (mint, source, payload) SELECT m, 'watch', p::jsonb FROM unnest($1::text[], $2::text[]) AS v(m, p)`,
      [out.map((r) => r.mint), out.map((r) => JSON.stringify(r.payload))],
    );
  }
  if (seenNow.size) {
    const ms = [...seenNow.keys()];
    await db.query(
      `UPDATE lab_watch w SET last_polled_at = now(), polls = polls + 1, gone_polls = 0,
              pool_address = COALESCE(v.pool, w.pool_address), symbol = COALESCE(w.symbol, v.symbol), name = COALESCE(w.name, v.name),
              pair_created_at = COALESCE(w.pair_created_at, CASE WHEN v.created IS NULL THEN NULL ELSE to_timestamp(v.created / 1000.0) END)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::float8[]) AS v(mint, pool, symbol, name, created)
        WHERE w.mint = v.mint`,
      [ms, ms.map((m) => seenNow.get(m).pairAddress ?? null), ms.map((m) => seenNow.get(m).baseToken?.symbol ?? null), ms.map((m) => seenNow.get(m).baseToken?.name ?? null), ms.map((m) => fin(seenNow.get(m).pairCreatedAt))],
    );
  }
  let closed = 0;
  if (goneNow.length) {
    const r = await db.query(
      `UPDATE lab_watch SET last_polled_at = now(), polls = polls + 1, gone_polls = gone_polls + 1,
              active = (gone_polls + 1 < $2::int), note = CASE WHEN gone_polls + 1 >= $2::int THEN 'gone' ELSE note END
        WHERE mint = ANY($1::text[]) RETURNING active`,
      [goneNow, GONE_AFTER],
    );
    closed = r.rows.filter((x) => !x.active).length;
  }
  return { polled: polled.size, saved: out.length - goneNow.length, gone: goneNow.length, closed: closed + (adopted.rowCount ?? 0) + (expired.rowCount ?? 0) };
}
