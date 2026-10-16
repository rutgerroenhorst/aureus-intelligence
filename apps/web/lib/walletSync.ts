/**
 * Keeps the trade journal in step with what the user's wallet really did (lib/wallet.ts reads the chain, this stores it).
 *
 *   syncWallet      new signatures -> wallet_txs; unread ones are read a few at a time (the free RPC is rate limited, so a
 *                   backfill takes several rounds and resumes by itself); what each did -> wallet_fills
 *   applyToJournal  one journal row per coin the wallet bought: real entry price and size, what was sold and when
 *
 * The address is only ever read from wallet_watch (local and hosted database), never from code, and is masked wherever it is shown.
 */

import { decodeFills, decodeFlows, fetchSignatures, fetchTransaction, rpc, solUsdLookup, type Fill, type Flow } from "./wallet";
import { MAX_RESCUES, rescuePair } from "./dexPairs";

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const maskAddress = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const MAX_TRIES = 8;

/** What DexScreener says about a coin right now (kept small on purpose: this file must run outside Next, where "@/" paths do not exist). */
interface Pair {
  dexId?: string;
  baseToken?: { address?: string; symbol?: string };
  priceUsd?: string | number;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
}

async function fetchPairs(mints: string[]): Promise<Map<string, Pair> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`, { headers: { accept: "application/json", "user-agent": "Aureus-Wallet/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_200));
        continue;
      }
      if (!res.ok) return null;
      const pairs = (await res.json()) as Pair[];
      if (!Array.isArray(pairs)) return null;
      const best = new Map<string, Pair>();
      const unpriced: string[] = [];
      const curve: string[] = [];
      for (const p of pairs) {
        const m = p.baseToken?.address;
        if (!m || !mints.includes(m)) continue;
        if (!((num(p.priceUsd) ?? 0) > 0)) {
          unpriced.push(m);
          continue;
        }
        const cur = best.get(m);
        if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(m, p);
        if (p.dexId === "pumpfun") curve.push(m);
      }
      // a coin whose batch pair has no price (an old bonding-curve pair, lib/dexPairs.ts) would be valued at nothing in the journal, and one whose pair is the curve's frozen price at the wrong value: ask for its other pools
      const getJson = async (url: string): Promise<unknown> => {
        try {
          const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Aureus-Wallet/1.0" }, signal: AbortSignal.timeout(15_000) });
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      };
      for (const m of [...new Set([...unpriced.filter((x) => !best.has(x)), ...curve])].slice(0, MAX_RESCUES)) {
        const alt = await rescuePair(m, getJson);
        if (alt) best.set(m, alt as unknown as Pair);
      }
      return best;
    } catch {
      /* once more, then give up on this batch */
    }
  }
  return null;
}

export interface WalletSyncResult {
  address: string;
  newSignatures: number;
  read: number;
  unreadable: number;
  pending: number;
  fills: number;
  journal: { inserted: number; updated: number; skipped: number } | null;
}

/** Follow an address (idempotent). */
export async function watchWallet(db: Queryable, address: string, label?: string): Promise<void> {
  await db.query(`INSERT INTO wallet_watch (address, label) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`, [address, label ?? null]);
}

export async function syncWallet(db: Queryable, address: string, opts: { maxRead?: number; budgetMs?: number } = {}): Promise<WalletSyncResult> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 25_000;
  const result: WalletSyncResult = { address: maskAddress(address), newSignatures: 0, read: 0, unreadable: 0, pending: 0, fills: 0, journal: null };

  // 1. what is new on the chain
  const w = (await db.query(`SELECT newest_sig FROM wallet_watch WHERE address = $1`, [address])).rows[0];
  if (!w) return result;
  const sigs = await fetchSignatures(address, { untilSig: w.newest_sig ?? undefined, max: 3000 });
  if (sigs.length) {
    await db.query(
      `INSERT INTO wallet_txs (signature, address, block_time, state)
       SELECT s, $1, to_timestamp(t), CASE WHEN failed THEN 'skipped' ELSE 'pending' END
         FROM unnest($2::text[], $3::float8[], $4::bool[]) AS v(s, t, failed)
       ON CONFLICT (signature) DO NOTHING`,
      [address, sigs.map((x) => x.signature), sigs.map((x) => x.blockTime ?? Math.floor(Date.now() / 1000)), sigs.map((x) => x.err != null)],
    );
    await db.query(`UPDATE wallet_watch SET newest_sig = $2 WHERE address = $1`, [address, sigs[0]!.signature]);
    result.newSignatures = sigs.length;
  }

  // 2. read what has not been read yet, newest first, as many as the budget allows
  const todo = (await db.query(`SELECT signature FROM wallet_txs WHERE address = $1 AND state = 'pending' ORDER BY block_time DESC NULLS LAST LIMIT $2`, [address, opts.maxRead ?? 40])).rows;
  let solUsd: ((t: number) => number) | null = null;
  const fills: Array<Fill & { usd: number }> = [];
  const flows: Flow[] = [];
  const transfers: Array<{ sig: string; t: number; mint: string; tokens: number }> = [];
  for (const r of todo) {
    if (Date.now() - t0 > budget) break;
    const tx = await fetchTransaction(r.signature);
    if (!tx) {
      result.unreadable++;
      await db.query(`UPDATE wallet_txs SET tries = tries + 1, last_try = now(), state = CASE WHEN tries + 1 >= $2 THEN 'skipped' ELSE 'pending' END WHERE signature = $1`, [r.signature, MAX_TRIES]);
      continue;
    }
    const d = decodeFills(tx, address);
    const fl = decodeFlows(tx, address);
    if ((d.fills.some((f) => f.quote === "SOL") || fl.length) && !solUsd) solUsd = await solUsdLookup(Number(tx.blockTime ?? Date.now() / 1000) - 7 * 86400);
    for (const f of d.fills) fills.push({ ...f, usd: f.quote === "USD" ? f.quoteAmount : f.quoteAmount * (solUsd ? solUsd(f.t) : 0) });
    for (const t of d.transfers) transfers.push(t);
    for (const f of fl) flows.push(f);
    await db.query(`UPDATE wallet_txs SET state = 'done', flows_read = true, tries = tries + 1, last_try = now() WHERE signature = $1`, [r.signature]);
    result.read++;
  }
  if (fills.length || transfers.length) {
    const rows = [
      ...fills.map((f) => ({ sig: f.sig, t: f.t, mint: f.mint, side: f.side, tokens: f.tokens, quote: f.quote, qa: f.quoteAmount, usd: f.usd })),
      ...transfers.map((x) => ({ sig: x.sig, t: x.t, mint: x.mint, side: x.tokens > 0 ? "in" : "out", tokens: Math.abs(x.tokens), quote: null as string | null, qa: null as number | null, usd: null as number | null })),
    ];
    await db.query(
      `INSERT INTO wallet_fills (signature, address, t, mint, side, tokens, quote, quote_amount, usd)
       SELECT v.sig, $1, to_timestamp(v.t), v.mint, v.side, v.tokens, v.quote, v.qa, v.usd
         FROM unnest($2::text[], $3::float8[], $4::text[], $5::text[], $6::float8[], $7::text[], $8::float8[], $9::float8[]) AS v(sig, t, mint, side, tokens, quote, qa, usd)
       ON CONFLICT (signature, mint, side) DO NOTHING`,
      [address, rows.map((r) => r.sig), rows.map((r) => r.t), rows.map((r) => r.mint), rows.map((r) => r.side), rows.map((r) => r.tokens), rows.map((r) => r.quote), rows.map((r) => r.qa), rows.map((r) => r.usd)],
    );
    result.fills = fills.length;
  }
  if (flows.length) await storeFlows(db, address, flows, solUsd);
  result.pending = Number((await db.query(`SELECT count(*)::int AS n FROM wallet_txs WHERE address = $1 AND state = 'pending'`, [address])).rows[0]?.n ?? 0);
  await db.query(`UPDATE wallet_watch SET synced_at = now() WHERE address = $1`, [address]);

  // 3. the journal, for the coins that just changed
  const touched = [...new Set(fills.map((f) => f.mint))];
  if (touched.length) result.journal = await applyToJournal(db, address, { mints: touched });
  return result;
}

/** Deposits and withdrawals found in what was just read: stored with their dollar value at the time (SOL at that hour's price). Idempotent. */
export async function storeFlows(db: Queryable, address: string, flows: Flow[], solUsd: ((t: number) => number) | null): Promise<void> {
  // the position of each transfer inside its transaction, so that two transfers in one transaction are two rows
  const seen = new Map<string, number>();
  const rows = flows.map((f) => {
    const k = `${f.sig}|${f.direction}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    const price = solUsd ? solUsd(f.t) : 0;
    // no price for that time: the dollars are unknown (null), never 0 and never today's price
    return { ...f, n, usd: price > 0 ? f.amount * price : null };
  });
  await db.query(
    `INSERT INTO wallet_flows (signature, address, t, asset, direction, amount, usd, counterparty, n)
     SELECT v.sig, $1, to_timestamp(v.t), v.asset, v.dir, v.amount, v.usd, v.cp, v.n
       FROM unnest($2::text[], $3::float8[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::text[], $9::int[]) AS v(sig, t, asset, dir, amount, usd, cp, n)
     ON CONFLICT (signature, direction, n) DO NOTHING`,
    [address, rows.map((r) => r.sig), rows.map((r) => r.t), rows.map((r) => r.asset), rows.map((r) => r.direction), rows.map((r) => r.amount), rows.map((r) => r.usd), rows.map((r) => r.counterparty), rows.map((r) => r.n)],
  );
}

/** Follow every address in wallet_watch; a no-op when there is none. */
export async function syncAllWallets(db: Queryable, opts: { maxRead?: number; budgetMs?: number } = {}): Promise<WalletSyncResult[]> {
  const addrs = (await db.query(`SELECT address FROM wallet_watch`).catch(() => ({ rows: [] as any[] }))).rows.map((r) => r.address as string);
  const out: WalletSyncResult[] = [];
  for (const a of addrs) out.push(await syncWallet(db, a, opts));
  return out;
}

interface Agg {
  mint: string;
  bought: number;
  usdIn: number;
  sold: number;
  usdOut: number;
  firstBuy: Date;
  lastSell: Date | null;
}

const supplyCache = new Map<string, number>();

/** Circulating supply of a coin: from DexScreener's market cap over its price, else asked of the chain; remembered, because it never changes here. */
async function supplyOf(mint: string, pair: Pair | undefined): Promise<number | null> {
  const known = supplyCache.get(mint);
  if (known) return known;
  const mc = [num(pair?.marketCap), num(pair?.fdv)].find((v) => v != null && v > 0) ?? null;
  const price = num(pair?.priceUsd);
  let supply = mc && price && price > 0 ? mc / price : null;
  if (!supply) supply = num((await rpc("getTokenSupply", [mint], { tries: 3 }))?.value?.uiAmount);
  if (supply && supply > 0) supplyCache.set(mint, supply);
  return supply;
}

/**
 * One journal row per coin the wallet bought: the real average price paid (and so market cap at entry), dollars put in, what was sold.
 * A row the user already made with the Enter button (same coin, within a day and a half of the real buy) is corrected instead of
 * duplicated and keeps its tab; new rows are marked source = 'wallet'. Coins whose supply cannot be found are skipped and counted.
 * `opts.mints` limits the work to the coins that just changed (a quick sync must not re-price the whole history).
 */
export async function applyToJournal(db: Queryable, address: string, opts: { mints?: string[] } = {}): Promise<{ inserted: number; updated: number; skipped: number }> {
  const { rows } = await db.query(
    `SELECT mint,
            COALESCE(sum(tokens) FILTER (WHERE side = 'buy'), 0) AS bought, COALESCE(sum(usd) FILTER (WHERE side = 'buy'), 0) AS usd_in,
            COALESCE(sum(tokens) FILTER (WHERE side = 'sell'), 0) AS sold, COALESCE(sum(usd) FILTER (WHERE side = 'sell'), 0) AS usd_out,
            min(t) FILTER (WHERE side = 'buy') AS first_buy, max(t) FILTER (WHERE side = 'sell') AS last_sell
       FROM wallet_fills WHERE address = $1 AND ($2::text[] IS NULL OR mint = ANY($2::text[])) GROUP BY mint HAVING sum(tokens) FILTER (WHERE side = 'buy') > 0`,
    [address, opts.mints ?? null],
  );
  const aggs: Agg[] = rows.map((r) => ({ mint: r.mint, bought: Number(r.bought), usdIn: Number(r.usd_in), sold: Number(r.sold), usdOut: Number(r.usd_out), firstBuy: new Date(r.first_buy), lastSell: r.last_sell ? new Date(r.last_sell) : null }));
  const out = { inserted: 0, updated: 0, skipped: 0 };
  if (!aggs.length) return out;

  const market = new Map<string, Pair>();
  for (let i = 0; i < aggs.length; i += 30) {
    const found = await fetchPairs(aggs.slice(i, i + 30).map((a) => a.mint));
    if (found) for (const [m, p] of found) market.set(m, p);
  }
  const existing = (await db.query(`SELECT id, mint, source, entered_at FROM my_trades WHERE mint = ANY($1::text[]) ORDER BY entered_at`, [aggs.map((a) => a.mint)])).rows;

  for (const a of aggs) {
    const pair = market.get(a.mint);
    const supply = await supplyOf(a.mint, pair);
    if (!supply || supply <= 0 || a.bought <= 0 || a.usdIn <= 0) {
      out.skipped++;
      continue;
    }
    const entryPrice = a.usdIn / a.bought;
    const entryMcap = entryPrice * supply;
    const exited = a.sold >= 0.95 * a.bought;
    const exitMcap = a.sold > 0 ? (a.usdOut / a.sold) * supply : null;
    const held = Math.max(0, a.bought - a.sold);
    const lastMcap = [num(pair?.marketCap), num(pair?.fdv)].find((v) => v != null && v > 0) ?? null;
    const symbol = pair?.baseToken?.symbol ? String(pair.baseToken.symbol).replace(/[^\p{L}\p{N}_.\-$@ ]/gu, "").slice(0, 40) : null;
    const mine = existing.filter((e) => e.mint === a.mint);
    const target =
      mine.find((e) => e.source === "wallet") ??
      mine.filter((e) => Math.abs(new Date(e.entered_at).getTime() - a.firstBuy.getTime()) < 36 * 3_600_000).at(-1);
    if (target) {
      await db.query(
        `UPDATE my_trades SET entry_price_usd = $2, entry_mcap_usd = $3, size_usd = $4, entered_at = $5,
                sold_usd = $6, sold_fraction = $7, tokens_held = $8,
                status = $9, exit_mcap_usd = $10, exited_at = $11,
                last_mcap_usd = COALESCE($12, last_mcap_usd),
                peak_mcap_usd = GREATEST(COALESCE(peak_mcap_usd, $3), $3), low_mcap_usd = LEAST(COALESCE(low_mcap_usd, $3), $3)
          WHERE id = $1`,
        [target.id, entryPrice, entryMcap, a.usdIn, a.firstBuy, a.sold > 0 ? a.usdOut : null, Math.min(1, a.sold / a.bought), held, exited ? "exited" : "active", exited ? exitMcap : null, exited ? a.lastSell : null, exited ? exitMcap : lastMcap],
      );
      out.updated++;
    } else {
      await db.query(
        `INSERT INTO my_trades (mint, symbol, tab_name, source, entered_at, entry_mcap_usd, entry_price_usd, size_usd, note, status,
                                last_mcap_usd, peak_mcap_usd, low_mcap_usd, last_checked_at, exit_mcap_usd, exited_at, sold_usd, sold_fraction, tokens_held, peak_known)
         VALUES ($1, $2, NULL, 'wallet', $3, $4, $5, $6, 'from wallet', $7, $8, $9, $10, now(), $11, $12, $13, $14, $15, $16)`,
        [a.mint, symbol, a.firstBuy, entryMcap, entryPrice, a.usdIn, exited ? "exited" : "active", exited ? exitMcap : lastMcap ?? 0.01, Math.max(entryMcap, lastMcap ?? 0), Math.min(entryMcap, lastMcap ?? entryMcap), exited ? exitMcap : null, exited ? a.lastSell : null, a.sold > 0 ? a.usdOut : null, Math.min(1, a.sold / a.bought), held, Date.now() - a.firstBuy.getTime() < 2 * 3_600_000],
      );
      out.inserted++;
    }
  }
  await fillSymbols(db);
  return out;
}

/** Coins DexScreener no longer lists have no symbol yet: Jupiter's token search still knows most of them. */
async function fillSymbols(db: Queryable): Promise<void> {
  const { rows } = await db.query(`SELECT DISTINCT mint FROM my_trades WHERE (symbol IS NULL OR symbol = '') LIMIT 200`);
  const mints = rows.map((r) => r.mint as string);
  for (let i = 0; i < mints.length; i += 50) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 50).join(",")}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const list = (await res.json()) as Array<{ id?: string; symbol?: string }>;
      for (const t of list) {
        const sym = t.symbol ? String(t.symbol).replace(/[^\p{L}\p{N}_.\-$@ ]/gu, "").slice(0, 40) : "";
        if (t.id && sym) await db.query(`UPDATE my_trades SET symbol = $2 WHERE mint = $1 AND (symbol IS NULL OR symbol = '')`, [t.id, sym]);
      }
    } catch {
      /* the symbols stay empty and show as "?" */
    }
  }
}

/**
 * Copy what the laptop has read since the hosted database last heard about this wallet, and update the hosted journal for those coins.
 * Idempotent; a no-op when the hosted database is already level. Used by the worker loop when LAB_SYNC_URL is set.
 */
export async function pushWalletRows(local: Queryable, hosted: Queryable, address: string, opts: { full?: boolean } = {}): Promise<{ txs: number; fills: number; journal: { inserted: number; updated: number; skipped: number } | null } | null> {
  const h = (await hosted.query(`SELECT max(block_time) AS m FROM wallet_txs WHERE address = $1`, [address])).rows[0];
  const since = h?.m && !opts.full ? new Date(new Date(h.m).getTime() - 3_600_000) : new Date(0);
  // every column the table has: jsonb_populate_recordset turns a missing key into NULL, not into the column's default (flows_read is NOT NULL)
  const txs = (await local.query(`SELECT signature, address, block_time, state, tries, last_try, flows_read FROM wallet_txs WHERE address = $1 AND block_time > $2`, [address, since])).rows;
  const fills = (await local.query(`SELECT * FROM wallet_fills WHERE address = $1 AND t > $2`, [address, since])).rows;
  if (!txs.length && !fills.length) return null;
  const w = (await local.query(`SELECT label, added_at, synced_at, newest_sig FROM wallet_watch WHERE address = $1`, [address])).rows[0];
  await hosted.query(
    `INSERT INTO wallet_watch (address, label, added_at, synced_at, newest_sig) VALUES ($1, $2, COALESCE($3, now()), $4, $5)
     ON CONFLICT (address) DO UPDATE SET synced_at = EXCLUDED.synced_at, newest_sig = EXCLUDED.newest_sig`,
    [address, w?.label ?? null, w?.added_at ?? null, w?.synced_at ?? null, w?.newest_sig ?? null],
  );
  for (let i = 0; i < txs.length; i += 400) {
    await hosted.query(
      `INSERT INTO wallet_txs SELECT * FROM jsonb_populate_recordset(NULL::wallet_txs, $1::jsonb) ON CONFLICT (signature) DO UPDATE SET state = EXCLUDED.state, tries = EXCLUDED.tries, last_try = EXCLUDED.last_try, flows_read = wallet_txs.flows_read OR EXCLUDED.flows_read`,
      [JSON.stringify(txs.slice(i, i + 400))],
    );
  }
  for (let i = 0; i < fills.length; i += 400) {
    await hosted.query(`INSERT INTO wallet_fills SELECT * FROM jsonb_populate_recordset(NULL::wallet_fills, $1::jsonb) ON CONFLICT (signature, mint, side) DO NOTHING`, [JSON.stringify(fills.slice(i, i + 400))]);
  }
  const mints = [...new Set(fills.filter((f) => f.side === "buy" || f.side === "sell").map((f) => f.mint as string))];
  const journal = mints.length ? await applyToJournal(hosted, address, { mints }) : null;
  return { txs: txs.length, fills: fills.length, journal };
}

/** The deposits and withdrawals the laptop has found that the hosted database does not have yet. Idempotent. */
export async function pushWalletFlows(local: Queryable, hosted: Queryable, address: string): Promise<number> {
  // two counts first: nearly always the hosted database is already level, and then nothing else is read
  const nLocal = Number((await local.query(`SELECT count(*)::int AS n FROM wallet_flows WHERE address = $1`, [address]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);
  const nHosted = Number((await hosted.query(`SELECT count(*)::int AS n FROM wallet_flows WHERE address = $1`, [address]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);
  if (nLocal === 0 || nHosted >= nLocal) return 0;
  const have = new Set(((await hosted.query(`SELECT signature || '|' || direction || '|' || n AS k FROM wallet_flows WHERE address = $1`, [address]).catch(() => ({ rows: [] as any[] }))).rows).map((r) => r.k as string));
  const rows = (await local.query(`SELECT * FROM wallet_flows WHERE address = $1`, [address]).catch(() => ({ rows: [] as any[] }))).rows.filter((r) => !have.has(`${r.signature}|${r.direction}|${r.n}`));
  for (let i = 0; i < rows.length; i += 400) {
    await hosted.query(`INSERT INTO wallet_flows SELECT * FROM jsonb_populate_recordset(NULL::wallet_flows, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 400))]);
  }
  return rows.length;
}

let lastLight = 0;
let lightRunning: Promise<void> | null = null;

/**
 * A quick look at the wallets for whoever has the trade journal open: at most once a minute per server, a few seconds long, only new
 * signatures plus a handful of unread transactions. Never throws; the journal simply stays as it was when the chain is unreachable.
 */
export async function syncWalletsLight(db: Queryable): Promise<void> {
  if (Date.now() - lastLight < 60_000) return lightRunning ?? undefined;
  lastLight = Date.now();
  lightRunning = syncAllWallets(db, { maxRead: 10, budgetMs: 8_000 })
    .then(() => undefined)
    .catch((e) => console.error("[wallet] light sync failed", String((e as Error)?.message ?? e).slice(0, 120)))
    .finally(() => {
      lightRunning = null;
    });
  return lightRunning;
}
