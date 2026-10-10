/**
 * The lab's own eyes, for the things the scanner does not see or does not keep:
 *
 *  - price tail      one DexScreener reading per hour for coins the scanner stopped following (rejected, expired), for
 *                    100 hours, so that a rejection can finally be graded by what the coin did afterwards
 *  - candle tail     hourly closes from GeckoTerminal for coins that were dropped in the past (one-off repair of old history)
 *  - gecko multi     unique buyers and sellers per window for the coins being followed (30 pools per request)
 *  - jupiter         organic score, holders, organic buyers, developer history (50 coins per request)
 *
 * All sources are free and keyless. Each collector does a bounded amount of work per call, treats a failed request as "try
 * next round", and writes small rows to lab_signals_ts, which the builder folds into the lessons.
 */

import type { Queryable } from "./builder";

const HEADERS = { accept: "application/json", "user-agent": "Aureus-Lab/1.0" };

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000, tries = 2): Promise<any | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      /* try once more, then give up on this request */
    }
  }
  return null;
}

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/**
 * One row per coin this database's scanner has a candidate for (its earliest one): the pool it follows and whether the
 * scanner still follows it. Joined by mint, not by the lesson's stored candidate id, because a lesson pushed from another
 * database carries that database's ids.
 */
const SCANNED = `
  SELECT mint, pool_address, followed FROM (
    SELECT DISTINCT ON (t.mint) t.mint, p.pool_address,
           (c.monitoring_tier::text <> 'TIER0_DORMANT' AND c.current_state::text NOT IN ('REJECTED', 'EXPIRED')) AS followed
      FROM candidates c JOIN tokens t ON t.id = c.token_id JOIN pools p ON p.id = c.pool_id
     ORDER BY t.mint, c.discovered_at
  ) cand
  UNION ALL
  SELECT w.mint, w.pool_address, true AS followed FROM lab_watch w
   WHERE w.pool_address IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = w.mint)`;

async function insertRows(db: Queryable, rows: Array<{ mint: string; source: string; payload: unknown }>): Promise<void> {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO lab_signals_ts (mint, source, payload)
     SELECT m, s, p::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) AS v(m, s, p)`,
    [rows.map((r) => r.mint), rows.map((r) => r.source), rows.map((r) => JSON.stringify(r.payload))],
  );
}

/** Coins the scanner no longer follows, still inside their first 100 hours, without a reading in the last 55 minutes (hourly is enough: paths are judged with the sparse-readings rule). */
export async function collectPriceTail(db: Queryable, opts: { limit?: number } = {}): Promise<{ checked: number; priced: number; gone: number }> {
  const { rows } = await db.query(
    `SELECT l.mint FROM lab_coins l JOIN (${SCANNED}) s ON s.mint = l.mint
      WHERE NOT s.followed
        AND l.first_seen_at > now() - interval '100 hours'
        AND NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = l.mint AND s.source = 'price_tail' AND s.taken_at > now() - interval '55 minutes')
      ORDER BY l.first_seen_at DESC
      LIMIT $1`,
    [opts.limit ?? 150],
  );
  const mints: string[] = rows.map((r) => r.mint);
  const out: Array<{ mint: string; source: string; payload: unknown }> = [];
  let priced = 0;
  let gone = 0;
  let answered = 0;
  const now = Date.now() / 1000;
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`);
    if (!Array.isArray(pairs)) continue; // a failed call proves nothing about the coins in it
    answered += batch.length;
    const best = new Map<string, any>();
    for (const p of pairs) {
      const m = p?.baseToken?.address;
      if (!m || !batch.includes(m)) continue;
      if (!best.has(m) || (p.liquidity?.usd ?? 0) > (best.get(m).liquidity?.usd ?? 0)) best.set(m, p);
    }
    for (const m of batch) {
      const p = best.get(m);
      const price = fin(p?.priceUsd);
      if (p && price != null && price > 0) {
        out.push({ mint: m, source: "price_tail", payload: { t: now, p: price, liq: fin(p.liquidity?.usd), mcap: fin(p.marketCap) ?? fin(p.fdv) } });
        priced++;
      } else if (batch.length >= 3 && best.size > 0) {
        // The exchange answered for other coins of the batch but lists nothing for this one: record it, do not guess.
        out.push({ mint: m, source: "price_tail", payload: { t: now, gone: true } });
        gone++;
      }
    }
  }
  await insertRows(db, out);
  return { checked: answered, priced, gone };
}

/** Unique buyers/sellers per window for coins still being followed, 30 pools per request, at most `maxCalls` requests. */
export async function collectGeckoMulti(db: Queryable, opts: { maxCalls?: number } = {}): Promise<{ pools: number; saved: number }> {
  const { rows } = await db.query(
    `SELECT l.mint, s.pool_address FROM lab_coins l JOIN (${SCANNED}) s ON s.mint = l.mint
      WHERE l.first_seen_at > now() - interval '60 hours' AND l.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = l.mint AND s.source = 'gecko_multi' AND s.taken_at > now() - interval '55 minutes')
      ORDER BY l.first_seen_at DESC
      LIMIT $1`,
    [(opts.maxCalls ?? 3) * 30],
  );
  const poolToMint = new Map<string, string>(rows.map((r) => [r.pool_address, r.mint]));
  const addrs = [...poolToMint.keys()];
  const out: Array<{ mint: string; source: string; payload: unknown }> = [];
  for (let i = 0; i < addrs.length; i += 30) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_200)); // the free API counts bursts; a refused call is simply tried again next round
    const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${addrs.slice(i, i + 30).join(",")}`, { accept: "application/json;version=20230302" }, 20_000, 1);
    for (const d of json?.data ?? []) {
      const a = d?.attributes;
      const mint = poolToMint.get(a?.address);
      if (!mint) continue;
      const tx = a.transactions ?? {};
      out.push({
        mint, source: "gecko_multi",
        payload: {
          buyers_h1: fin(tx.h1?.buyers), sellers_h1: fin(tx.h1?.sellers), buys_h1: fin(tx.h1?.buys), sells_h1: fin(tx.h1?.sells),
          buyers_h24: fin(tx.h24?.buyers), sellers_h24: fin(tx.h24?.sellers), buyers_m30: fin(tx.m30?.buyers), sellers_m30: fin(tx.m30?.sellers),
          vol_h1: fin(a.volume_usd?.h1), reserve: fin(a.reserve_in_usd), locked: fin(a.locked_liquidity_percentage),
        },
      });
    }
  }
  await insertRows(db, out);
  return { pools: addrs.length, saved: out.length };
}

/** Organic score, holder count and developer history from Jupiter, 50 coins per request. */
export async function collectJupiter(db: Queryable, opts: { maxCalls?: number } = {}): Promise<{ coins: number; saved: number }> {
  const { rows } = await db.query(
    `SELECT l.mint FROM lab_coins l JOIN (${SCANNED}) sc ON sc.mint = l.mint
      WHERE l.first_seen_at > now() - interval '60 hours' AND l.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = l.mint AND s.source = 'jupiter' AND s.taken_at > now() - interval '115 minutes')
      ORDER BY l.first_seen_at DESC
      LIMIT $1`,
    [(opts.maxCalls ?? 3) * 50],
  );
  const mints: string[] = rows.map((r) => r.mint);
  const out: Array<{ mint: string; source: string; payload: unknown }> = [];
  for (let i = 0; i < mints.length; i += 50) {
    const json = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 50).join(",")}`);
    if (!Array.isArray(json)) continue;
    for (const t of json) {
      if (!mints.includes(t?.id)) continue;
      out.push({
        mint: t.id, source: "jupiter",
        payload: {
          organic_score: fin(t.organicScore), holders: fin(t.holderCount), organic_buyers_h24: fin(t.stats24h?.numOrganicBuyers),
          traders_h24: fin(t.stats24h?.numTraders), traders_h1: fin(t.stats1h?.numTraders), holder_change_24h: fin(t.stats24h?.holderChange),
          dev_mints: fin(t.audit?.devMints), dev_migrations: fin(t.audit?.devMigrations), top_holders_pct: fin(t.audit?.topHoldersPercentage),
          launchpad: t.launchpad ?? null,
        },
      });
    }
  }
  await insertRows(db, out);
  return { coins: mints.length, saved: out.length };
}

/**
 * One-off repair of history: for coins the scanner dropped long ago, fetch the hourly closes after its last reading from
 * GeckoTerminal so that what happened next is known. One request per coin, at most `limit` coins per call. GeckoTerminal
 * allows about 30 requests a minute per address; callers should leave `delayMs` between requests.
 */
export async function repairWithCandles(db: Queryable, opts: { limit: number; delayMs: number; onProgress?: (done: number, total: number) => void }): Promise<{ done: number; empty: number; failed: number }> {
  const { rows } = await db.query(
    `SELECT l.mint, s.pool_address, EXTRACT(EPOCH FROM l.last_seen_at)::float8 AS last_seen
       FROM lab_coins l JOIN (${SCANNED}) s ON s.mint = l.mint
      WHERE l.outcome->>'censored' = 'true' AND l.first_seen_at > now() - interval '40 days'
        AND NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = l.mint AND s.source = 'candle_tail')
      ORDER BY l.first_seen_at DESC
      LIMIT $1`,
    [opts.limit],
  );
  let done = 0;
  let empty = 0;
  let failed = 0;
  for (const r of rows) {
    const json = await getJson(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${r.pool_address}/ohlcv/hour?aggregate=1&limit=1000&currency=usd`,
      { accept: "application/json;version=20230302" }, 25_000, 4,
    );
    if (json === null) {
      failed++;
    } else {
      const list: Array<[number, number, number, number, number, number]> = json?.data?.attributes?.ohlcv_list ?? [];
      // [open time, o, h, l, c, v] newest first; keep closes (at open + 1 h) from the last scanner reading onwards, at most 5 days
      const candles = list
        .map((c) => [c[0] + 3600, c[4]] as [number, number])
        .filter((c) => c[0] > r.last_seen && c[0] <= r.last_seen + 5 * 86400 && c[1] > 0)
        .sort((a, b) => a[0] - b[0]);
      if (!candles.length) empty++;
      await insertRows(db, [{ mint: r.mint, source: "candle_tail", payload: { candles } }]);
      done++;
    }
    opts.onProgress?.(done + failed, rows.length);
    await new Promise((res) => setTimeout(res, opts.delayMs));
  }
  return { done, empty, failed };
}
