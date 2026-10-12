/**
 * pump.fun graduations read from the chain, so the Graduations tab keeps running when the laptop sleeps.
 *
 * Until now the tab came from pump.fun's live event stream (PumpPortal's websocket, apps/worker/src/pumpFeed.ts). A websocket needs a process that stays
 * awake, which the site (serverless) is not and the laptop is only sometimes: a laptop that slept for 11 hours left the same coins on the screen for 11 hours.
 * The other tabs never had this problem because they ask ordinary web APIs on a timer. This does the same for graduations, from three plain requests:
 *
 *   1. The Solana RPC lists the transactions of pump.fun's migration authority (an account that signs only migrations): that list IS the list of graduations,
 *      complete, with the second each one happened (the stream's own count for the same three hours was 7 against 177 on the chain, because the laptop slept).
 *      The coin is in the migration instruction (account 2) and in the transaction's token balances.
 *   2. Jupiter's token API (free, 100 coins a call) says what the coin is: name, symbol, launch time (so minutes from launch to graduation), supply (2 billion
 *      means Mayhem Mode), the creator, the pool's liquidity, price and market cap, and trades and price change over 5 minutes to 24 hours.
 *   3. For a coin that graduated within two minutes of its launch, the creating transaction says what the creator bought (the stream's "creator bought 85 SOL"):
 *      the bonding curve account (the owner of the coin's tokens before the migration) has only a few transactions, the oldest is the creation, and what the
 *      creator spent in it, less the pump.fun fee and the rent, is the buy. That is what separates "born graduated" (the creator bought the whole curve) from a
 *      curve that was filled fast by others.
 *
 * Every 3 minutes (pg_cron -> /api/cron/graduates): new migrations are written to pump_graduates (via = 'chain'), and the coins of the last day that are still
 * worth watching get a fresh reading folded into pump_graduates.facts, a compact record (first, peak liquidity, highest price, about one hour after graduation,
 * newest) from which the tab's rows are built exactly like from the lab's readings. Young coins are read every tick, coins under 90 minutes every third tick,
 * the standing, non-hidden ones of the last day every tenth. Nothing here writes to lab_watch or lab_signals_ts: the hosted database is small.
 */

import { fetchTransaction, rpc } from "./wallet";
import { JUDGE_FROM_MIN, JUDGE_TO_MIN } from "./lab/pump";

export const MIGRATION_AUTHORITY = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUBLICNODE = "https://solana-rpc.publicnode.com";
const OFFICIAL = "https://api.mainnet-beta.solana.com";
export const LEASE = "grad-feed";
/** the most migration transactions read in one tick: a longer backlog (the site was down) is worked off over the next ticks */
const MAX_TX_PER_TICK = 30;
/** a graduation within this many minutes of the launch gets its creating transaction read */
const QUICK_MIN = 2;
const MAYHEM_SUPPLY = 1.5e9;

// ---------------------------------------------------------------- the compact record of a coin's readings

/** [time (seconds), price, liquidity, market cap] */
export type Rd = [number, number | null, number | null, number | null];
/** the newest reading also keeps what the tab shows: price change, buys and sells over 5 minutes, 1 hour, 6 hours and 24 hours */
export type Last = [number, number | null, number | null, number | null, Array<number | null>, Array<number | null>, Array<number | null>];
export interface FeedLog {
  /** the first reading */
  f?: Rd;
  /** the reading with the most liquidity so far */
  k?: Rd;
  /** the reading with the highest price so far */
  h?: Rd;
  /** the first reading 55 to 100 minutes after graduation (what the lab judges at "one hour") */
  o?: Rd;
  /** the newest reading */
  l?: Last;
  /** readings taken */
  n?: number;
  /** how many tokens the creator has minted (Jupiter's audit), a serial-creator hint */
  dm?: number | null;
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const price = (x: unknown): number | null => {
  const n = num(x);
  return n == null ? null : Number(n.toPrecision(6));
};
const whole = (x: unknown): number | null => {
  const n = num(x);
  return n == null ? null : Math.round(n);
};
const pcx = (x: unknown): number | null => {
  const n = num(x);
  return n == null ? null : Number(n.toFixed(1));
};

export interface JupToken {
  id: string;
  name?: string;
  symbol?: string;
  launchpad?: string | null;
  createdAt?: string;
  graduatedAt?: string | null;
  totalSupply?: number;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  fdv?: number;
  dev?: string;
  audit?: { devMints?: number; devMigrations?: number };
  stats5m?: JStats;
  stats1h?: JStats;
  stats6h?: JStats;
  stats24h?: JStats;
}
interface JStats {
  priceChange?: number;
  numBuys?: number;
  numSells?: number;
}

export function readingFromJupiter(t: JupToken, now: number): Last {
  const w = [t.stats5m, t.stats1h, t.stats6h, t.stats24h];
  return [now, price(t.usdPrice), whole(t.liquidity), whole(t.mcap ?? t.fdv), w.map((x) => pcx(x?.priceChange)), w.map((x) => whole(x?.numBuys)), w.map((x) => whole(x?.numSells))];
}

/** DexScreener's pair for a coin (the fallback while Jupiter has not indexed it yet). */
export interface DexPair {
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | number;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  priceChange?: Record<string, number>;
  txns?: Record<string, { buys?: number; sells?: number }>;
}
export function readingFromDex(p: DexPair, now: number): Last {
  const ks = ["m5", "h1", "h6", "h24"];
  return [now, price(p.priceUsd), whole(p.liquidity?.usd), whole(p.marketCap ?? p.fdv), ks.map((k) => pcx(p.priceChange?.[k])), ks.map((k) => whole(p.txns?.[k]?.buys)), ks.map((k) => whole(p.txns?.[k]?.sells))];
}

/** What the stored record says before a new reading is folded in (only these few numbers are read from the database every tick). */
export interface Seen {
  peakLiq: number | null;
  hiP: number | null;
  hasF: boolean;
  hasO: boolean;
  n: number;
}
export const NOTHING_SEEN: Seen = { peakLiq: null, hiP: null, hasF: false, hasO: false, n: 0 };

/** The keys of the record that change when this reading is taken (the database merges them into the stored record): always the newest reading and the count. */
export function foldReading(seen: Seen, last: Last, migratedS: number, dm?: number | null): Partial<FeedLog> {
  const rd: Rd = [last[0], last[1], last[2], last[3]];
  const patch: Partial<FeedLog> = { l: last, n: seen.n + 1 };
  if (!seen.hasF) patch.f = rd;
  if (rd[2] != null && (seen.peakLiq == null || rd[2] > seen.peakLiq)) patch.k = rd;
  if (rd[1] != null && (seen.hiP == null || rd[1] > seen.hiP)) patch.h = rd;
  const ageMin = (rd[0] - migratedS) / 60;
  if (!seen.hasO && ageMin >= JUDGE_FROM_MIN && ageMin <= JUDGE_TO_MIN) patch.o = rd;
  if (dm !== undefined) patch.dm = dm;
  return patch;
}

/** The readings a record stands for, oldest first, in the shape the tab's builder reads (lib/graduates.ts). */
export function readingsOf(log: FeedLog | null | undefined): Array<{ t: number; p: number | null; liq: number | null; mcap: number | null; pc?: Array<number | null>; b?: Array<number | null>; s?: Array<number | null> }> {
  if (!log) return [];
  const seen = new Set<number>();
  const out: Array<{ t: number; p: number | null; liq: number | null; mcap: number | null; pc?: Array<number | null>; b?: Array<number | null>; s?: Array<number | null> }> = [];
  for (const r of [log.f, log.k, log.h, log.o, log.l] as Array<Rd | Last | undefined>) {
    if (!r || seen.has(r[0])) continue;
    seen.add(r[0]);
    const l = r as Last;
    out.push({ t: r[0], p: r[1], liq: r[2], mcap: r[3], ...(Array.isArray(l[4]) ? { pc: l[4], b: l[5], s: l[6] } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- reading a migration off the chain

/** The coin a migration transaction moved to PumpSwap and when, or null when this is not a migration. */
export function migrationOf(tx: any): { mint: string; t: number } | null {
  if (!tx?.meta || tx.meta.err != null) return null;
  for (const ins of tx.transaction?.message?.instructions ?? []) {
    if (ins?.programId !== PUMP_PROGRAM) continue;
    const a: unknown[] = ins.accounts ?? [];
    if (a[1] !== MIGRATION_AUTHORITY || typeof a[2] !== "string") continue;
    const mint = a[2];
    // the coin must be in the transaction's token balances too: a guard against a changed account order
    const balances = [...(tx.meta.postTokenBalances ?? []), ...(tx.meta.preTokenBalances ?? [])];
    if (balances.some((b: any) => b?.mint === mint)) return { mint, t: Number(tx.blockTime) };
  }
  return null;
}

/** The bonding curve of the migrated coin: the owner of the largest balance of the coin before the migration. */
export function curveOf(tx: any, mint: string): string | null {
  const pre = (tx?.meta?.preTokenBalances ?? []).filter((b: any) => b?.mint === mint && typeof b.owner === "string");
  pre.sort((x: any, y: any) => Number(y?.uiTokenAmount?.uiAmountString ?? 0) - Number(x?.uiTokenAmount?.uiAmountString ?? 0));
  return pre[0]?.owner ?? null;
}

/**
 * What the creator bought, from the creating transaction: the creator pays, so what left their wallet less the fee, the rent of the new accounts (about 0.02 SOL)
 * and pump.fun's 1% is the buy. Null when this is not the coin's creation. Accurate to a few hundredths of a SOL against the stream's own figure (85.005 read as
 * 85.2, 9.88 as 9.89), which is plenty for "at least 50 SOL".
 */
export function creatorBuyOf(tx: any, mint: string): number | null {
  if (!tx?.meta || tx.meta.err != null) return null;
  const create = (tx.transaction?.message?.instructions ?? []).find((i: any) => i?.programId === PUMP_PROGRAM && i?.accounts?.[0] === mint);
  if (!create) return null;
  const spent = (Number(tx.meta.preBalances?.[0]) - Number(tx.meta.postBalances?.[0]) - Number(tx.meta.fee ?? 0)) / 1e9;
  if (!Number.isFinite(spent)) return null;
  return Math.max(0, Math.round(((spent - 0.02) / 1.01) * 100) / 100);
}

// ---------------------------------------------------------------- the tick

export interface NewGraduate {
  mint: string;
  migratedS: number;
  createdS: number | null;
  createToMigrateMin: number | null;
  devBuySol: number | null;
  mayhem: boolean;
  creator: string | null;
  name: string | null;
  symbol: string | null;
  signature: string;
  facts: Partial<FeedLog> | null;
}
export interface DueRow extends Seen {
  mint: string;
  migratedS: number;
  /** the coin's name and symbol are not known yet (Jupiter had not indexed it when it was first seen) */
  needsMeta: boolean;
}
export interface FeedStore {
  claim(): Promise<boolean>;
  state(): Promise<{ sig: string | null }>;
  known(mints: string[]): Promise<Set<string>>;
  insert(g: NewGraduate): Promise<boolean>;
  due(tickNo: number): Promise<DueRow[]>;
  patch(rows: Array<{ mint: string; facts: Partial<FeedLog>; meta?: { name: string | null; symbol: string | null; createdS: number | null; createToMigrateMin: number | null; mayhem: boolean; creator: string | null } }>): Promise<void>;
  finish(result: Record<string, unknown>): Promise<void>;
  /** the tick broke: free the lease and say why, but keep where the next tick starts */
  fail(error: string): Promise<void>;
  prune(): Promise<void>;
}
export interface FeedDeps {
  /** the migration authority's signatures, newest first, newer than `until` (null on a failure) */
  sigs(until: string | null): Promise<Array<{ signature: string; err: unknown }> | null>;
  tx(sig: string): Promise<any | null>;
  /** every signature of a bonding curve, newest first; null when there are too many to be the whole story or the RPC failed */
  curveSigs(curve: string): Promise<Array<{ signature: string }> | null>;
  jupiter(mints: string[]): Promise<Map<string, JupToken>>;
  dex(mints: string[]): Promise<Map<string, DexPair>>;
  now(): number;
  log(msg: string, extra?: Record<string, unknown>): void;
}
export interface FeedResult {
  ok: boolean;
  skipped?: string;
  migrations: number;
  added: number;
  refreshed: number;
  creatorBuys: number;
  unreadable: number;
  error?: string;
}

const iso = (s?: string | null): number | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t / 1000 : null;
};

export async function runFeed(deps: FeedDeps, store: FeedStore, tickNo: number): Promise<FeedResult> {
  const res: FeedResult = { ok: true, migrations: 0, added: 0, refreshed: 0, creatorBuys: 0, unreadable: 0 };
  const now = deps.now();

  // 1. the migrations since the last tick (oldest first, so that a failure leaves nothing behind it unread)
  const { sig: since } = await store.state();
  const list = await deps.sigs(since);
  let lastGood = since;
  const found: Array<{ mint: string; t: number; sig: string; curve: string | null }> = [];
  if (list == null) {
    res.error = "the chain could not be asked";
    res.ok = false;
  } else {
    for (const s of [...list].reverse().slice(0, MAX_TX_PER_TICK)) {
      if (s.err != null) {
        lastGood = s.signature;
        continue;
      }
      const tx = await deps.tx(s.signature);
      if (!tx) {
        res.unreadable++;
        break;
      }
      const m = migrationOf(tx);
      if (m) found.push({ ...m, sig: s.signature, curve: curveOf(tx, m.mint) });
      lastGood = s.signature;
    }
  }
  // searchers send the same migration several times within a second or two and the later copies succeed too: the first one of a coin is its graduation
  const firstOf = new Map<string, (typeof found)[number]>();
  for (const f of found) if (!firstOf.has(f.mint)) firstOf.set(f.mint, f);
  const distinct = [...firstOf.values()];
  res.migrations = distinct.length;
  const known = await store.known(distinct.map((f) => f.mint));
  const fresh = distinct.filter((f) => !known.has(f.mint));

  // 2. what the coins are and how they stand now: the new ones and those due for a new reading
  const due = await store.due(tickNo);
  const mints = [...new Set([...fresh.map((f) => f.mint), ...due.map((d) => d.mint)])];
  const jup = mints.length ? await deps.jupiter(mints) : new Map<string, JupToken>();
  const missing = mints.filter((m) => !jup.has(m));
  const dex = missing.length ? await deps.dex(missing) : new Map<string, DexPair>();
  const readingOf = (mint: string): { last: Last; j?: JupToken; d?: DexPair } | null => {
    const j = jup.get(mint);
    if (j) return { last: readingFromJupiter(j, now), j };
    const d = dex.get(mint);
    return d ? { last: readingFromDex(d, now), d } : null;
  };

  // 3. the new graduations
  for (const f of fresh) {
    const r = readingOf(f.mint);
    const j = r?.j;
    const createdS = iso(j?.createdAt);
    const ctm = createdS != null ? Math.max(0, (f.t - createdS) / 60) : null;
    let devBuy: number | null = null;
    if (ctm != null && ctm < QUICK_MIN && f.curve) {
      const sigs = await deps.curveSigs(f.curve);
      const oldest = sigs && sigs.length ? sigs[sigs.length - 1]! : null;
      const ctx = oldest ? await deps.tx(oldest.signature) : null;
      devBuy = ctx ? creatorBuyOf(ctx, f.mint) : null;
      if (devBuy != null) res.creatorBuys++;
    }
    const facts = r ? foldReading(NOTHING_SEEN, r.last, f.t, j?.audit?.devMints ?? null) : null;
    const added = await store.insert({
      mint: f.mint,
      migratedS: f.t,
      createdS,
      createToMigrateMin: ctm,
      devBuySol: devBuy,
      mayhem: (j?.totalSupply ?? 0) > MAYHEM_SUPPLY,
      creator: j?.dev ?? null,
      name: j?.name ?? r?.d?.baseToken?.name ?? null,
      symbol: j?.symbol ?? r?.d?.baseToken?.symbol ?? null,
      signature: f.sig,
      facts,
    });
    if (added) res.added++;
  }

  // 4. the readings that are due (a coin inserted in this tick has its first reading already)
  const patches: Parameters<FeedStore["patch"]>[0] = [];
  const justAdded = new Set(fresh.map((f) => f.mint));
  for (const d of due) {
    if (justAdded.has(d.mint)) continue;
    const r = readingOf(d.mint);
    if (!r) continue;
    const j = r.j;
    const facts = foldReading(d, r.last, d.migratedS, j ? (j.audit?.devMints ?? null) : undefined);
    let meta: Parameters<FeedStore["patch"]>[0][number]["meta"];
    if (d.needsMeta && (j?.symbol || r.d?.baseToken?.symbol)) {
      const createdS = iso(j?.createdAt);
      meta = {
        name: j?.name ?? r.d?.baseToken?.name ?? null,
        symbol: j?.symbol ?? r.d?.baseToken?.symbol ?? null,
        createdS,
        createToMigrateMin: createdS != null ? Math.max(0, (d.migratedS - createdS) / 60) : null,
        mayhem: (j?.totalSupply ?? 0) > MAYHEM_SUPPLY,
        creator: j?.dev ?? null,
      };
    }
    patches.push({ mint: d.mint, facts, ...(meta ? { meta } : {}) });
  }
  if (patches.length) await store.patch(patches);
  res.refreshed = patches.length;

  // 5. where the next tick starts, and the hourly housekeeping
  await store.finish({ ...res, sig: lastGood, at: new Date(now * 1000).toISOString() });
  if (tickNo % 20 === 0) await store.prune().catch(() => undefined);
  return res;
}

// ---------------------------------------------------------------- the real thing: the database, the chain, Jupiter, DexScreener

interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export function pgFeedStore(db: Db): FeedStore {
  return {
    async claim() {
      const r = await db.query(
        `INSERT INTO scan_lease (name, locked_until, last_started) VALUES ($1, now() + interval '100 seconds', now())
         ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until, last_started = EXCLUDED.last_started WHERE scan_lease.locked_until < now()
         RETURNING name`,
        [LEASE],
      );
      return r.rows.length > 0;
    },
    async state() {
      const r = await db.query(`SELECT last_result->>'sig' AS sig FROM scan_lease WHERE name = $1`, [LEASE]);
      return { sig: r.rows[0]?.sig ?? null };
    },
    async known(mints) {
      if (!mints.length) return new Set();
      const r = await db.query(`SELECT mint FROM pump_graduates WHERE mint = ANY($1::text[])`, [mints]);
      return new Set(r.rows.map((x) => x.mint as string));
    },
    async insert(g) {
      const r = await db.query(
        `INSERT INTO pump_graduates (mint, migrated_at, creator, created_at, create_to_migrate_min, initial_buy_sol, mayhem, creator_launches_72h, name, symbol, signature, via, facts)
         VALUES ($1, to_timestamp($2::float8), $3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE to_timestamp($4::float8) END, $5, $6, $7, NULL, $8, $9, $10, 'chain', $11::jsonb)
         ON CONFLICT (mint) DO NOTHING`,
        [g.mint, g.migratedS, g.creator, g.createdS, g.createToMigrateMin, g.devBuySol, g.mayhem, g.name, g.symbol, g.signature, g.facts ? JSON.stringify(g.facts) : null],
      );
      return (r.rowCount ?? 0) > 0;
    },
    async due(tickNo) {
      // young coins every tick, coins under 90 minutes every third tick, and of the last day only those still standing and not hidden by default every tenth
      const r = await db.query(
        `SELECT mint, EXTRACT(EPOCH FROM migrated_at)::float8 AS ms, (facts->'k'->>2)::float8 AS peak_liq, (facts->'h'->>1)::float8 AS hi_p,
                (facts ? 'f') AS has_f, (facts ? 'o') AS has_o, COALESCE((facts->>'n')::int, 0) AS n, (symbol IS NULL) AS needs_meta
           FROM pump_graduates
          WHERE via = 'chain' AND (
                migrated_at > now() - interval '30 minutes'
             OR (migrated_at > now() - interval '90 minutes' AND $1::int % 3 = 0)
             OR (migrated_at > now() - interval '24 hours' AND $1::int % 10 = 0 AND NOT mayhem
                 AND NOT (COALESCE(create_to_migrate_min, 99) < 2 AND COALESCE(initial_buy_sol, 100) >= 50)
                 AND COALESCE((facts->'l'->>2)::float8, 0) >= 5000))`,
        [tickNo],
      );
      return r.rows.map((x) => ({ mint: x.mint, migratedS: Number(x.ms), peakLiq: x.peak_liq == null ? null : Number(x.peak_liq), hiP: x.hi_p == null ? null : Number(x.hi_p), hasF: Boolean(x.has_f), hasO: Boolean(x.has_o), n: Number(x.n), needsMeta: Boolean(x.needs_meta) }));
    },
    async patch(rows) {
      await db.query(
        `UPDATE pump_graduates g SET facts = COALESCE(g.facts, '{}'::jsonb) || v.patch::jsonb FROM (SELECT unnest($1::text[]) AS mint, unnest($2::text[]) AS patch) v WHERE g.mint = v.mint`,
        [rows.map((r) => r.mint), rows.map((r) => JSON.stringify(r.facts))],
      );
      for (const r of rows) {
        if (!r.meta) continue;
        await db.query(
          `UPDATE pump_graduates SET name = COALESCE(name, $2), symbol = COALESCE(symbol, $3), created_at = COALESCE(created_at, CASE WHEN $4::float8 IS NULL THEN NULL ELSE to_timestamp($4::float8) END),
                  create_to_migrate_min = COALESCE(create_to_migrate_min, $5), mayhem = COALESCE(mayhem, $6), creator = COALESCE(creator, $7) WHERE mint = $1`,
          [r.mint, r.meta.name, r.meta.symbol, r.meta.createdS, r.meta.createToMigrateMin, r.meta.mayhem, r.meta.creator],
        );
      }
    },
    async finish(result) {
      await db.query(`UPDATE scan_lease SET locked_until = now(), last_finished = now(), last_result = $2::jsonb WHERE name = $1`, [LEASE, JSON.stringify(result)]);
    },
    async fail(error) {
      await db.query(
        `UPDATE scan_lease SET locked_until = now(), last_finished = now(),
                last_result = jsonb_build_object('ok', false, 'error', $2::text, 'sig', last_result->>'sig', 'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) WHERE name = $1`,
        [LEASE, error.slice(0, 200)],
      );
    },
    async prune() {
      await db.query(`DELETE FROM pump_graduates WHERE via = 'chain' AND migrated_at < now() - interval '4 days'`);
    },
  };
}

async function getJson(url: string, ms: number): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Aureus-Graduates/1.0" }, signal: AbortSignal.timeout(ms) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function realFeedDeps(log: FeedDeps["log"]): FeedDeps {
  return {
    sigs: async (until) => {
      const page = await rpc("getSignaturesForAddress", [MIGRATION_AUTHORITY, { limit: until ? 100 : 40, ...(until ? { until } : {}) }], { endpoints: [PUBLICNODE, OFFICIAL], tries: 3 });
      return Array.isArray(page) ? page : null;
    },
    tx: (sig) => fetchTransaction(sig),
    curveSigs: async (curve) => {
      const page = await rpc("getSignaturesForAddress", [curve, { limit: 1000 }], { endpoints: [PUBLICNODE, OFFICIAL], tries: 3 });
      return Array.isArray(page) && page.length < 1000 ? page : null;
    },
    jupiter: async (mints) => {
      const out = new Map<string, JupToken>();
      for (let i = 0; i < mints.length; i += 50) {
        const j = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 50).join(",")}`, 15_000);
        if (Array.isArray(j)) for (const t of j) if (t?.id) out.set(t.id as string, t as JupToken);
      }
      return out;
    },
    dex: async (mints) => {
      const out = new Map<string, DexPair>();
      for (let i = 0; i < mints.length; i += 30) {
        const j = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`, 15_000);
        if (!Array.isArray(j)) continue;
        for (const p of j as Array<DexPair & { liquidity?: { usd?: number } }>) {
          const m = p?.baseToken?.address;
          if (!m) continue;
          const cur = out.get(m);
          if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) out.set(m, p);
        }
      }
      return out;
    },
    now: () => Date.now() / 1000,
    log,
  };
}
