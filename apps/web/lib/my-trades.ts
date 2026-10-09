import { getPool } from "@aureus/db";
import { fetchPairs, type Pair } from "./learning-engine";

/**
 * The trade journal: the coins the user pressed "Enter" on (or logged by hand), the Radar tab they came from, a live
 * snapshot at entry, and what happened afterwards (highest and lowest market cap seen). See migration 0027.
 */

/** The learning tabs an entry can come from; anything else is stored as "unknown". */
export const TRADE_TABS = ["cate", "buy_signals", "ultra_momentum", "elite", "incubation"] as const;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** The site's address is public, so the journal is bounded: no more open trades than this, and a repeat click is idempotent. */
const MAX_ACTIVE = 300;
const DEDUPE_MINUTES = 10;
/** GET refreshes live prices at most this often, however many screens ask. */
const REFRESH_EVERY_MS = 15_000;

export type TradeRow = {
  id: string;
  mint: string;
  symbol: string | null;
  tab_name: string | null;
  source: string;
  entered_at: Date | string;
  entry_mcap_usd: string | number;
  entry_liquidity_usd: string | number | null;
  size_usd: string | number | null;
  note: string | null;
  status: "active" | "exited";
  last_mcap_usd: string | number | null;
  peak_mcap_usd: string | number | null;
  peak_at: Date | string | null;
  low_mcap_usd: string | number | null;
  last_checked_at: Date | string | null;
  exit_mcap_usd: string | number | null;
  exited_at: Date | string | null;
};

export interface ApiTrade {
  id: string;
  symbol: string;
  mint: string;
  tab: string | null;
  source: string;
  enteredAt: string;
  entryMcap: number;
  currentMcap: number;
  /** now / entry (or exit / entry once exited) */
  multiplier: number;
  /** highest market cap seen since entry / entry */
  peakMultiple: number;
  /** lowest market cap seen since entry / entry */
  lowMultiple: number;
  peakAt: string | null;
  status: "active" | "exited";
  exitMcap?: number;
  exitedAt?: string;
  sizeUsd: number | null;
  note: string | null;
  lastCheckedAt: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export const isValidMint = (s: unknown): s is string => typeof s === "string" && MINT_RE.test(s);

export function toApi(r: TradeRow): ApiTrade {
  const entry = num(r.entry_mcap_usd) ?? 1;
  const last = num(r.last_mcap_usd) ?? entry;
  const exit = num(r.exit_mcap_usd);
  const now = r.status === "exited" && exit != null ? exit : last;
  const peak = Math.max(num(r.peak_mcap_usd) ?? entry, entry, last);
  const low = Math.min(num(r.low_mcap_usd) ?? entry, entry, last);
  return {
    id: r.id,
    symbol: r.symbol ?? "?",
    mint: r.mint,
    tab: r.tab_name,
    source: r.source,
    enteredAt: new Date(r.entered_at).toISOString(),
    entryMcap: entry,
    currentMcap: now,
    multiplier: now / entry,
    peakMultiple: peak / entry,
    lowMultiple: low / entry,
    peakAt: iso(r.peak_at),
    status: r.status,
    ...(exit != null ? { exitMcap: exit } : {}),
    ...(r.exited_at ? { exitedAt: new Date(r.exited_at).toISOString() } : {}),
    sizeUsd: num(r.size_usd),
    note: r.note,
    lastCheckedAt: iso(r.last_checked_at),
  };
}

export interface TradeStats {
  active: number;
  exited: number;
  winners: number;
  avgProfit: number;
  /** trades whose market cap reached 2x their entry at some point */
  touched2x: number;
  /** ... of which the open ones now sit below their entry: a gain that was given back */
  gaveBack: number;
}

export function summarize(trades: ApiTrade[]): TradeStats {
  const active = trades.filter((t) => t.status === "active");
  const exited = trades.filter((t) => t.status === "exited");
  return {
    active: active.length,
    exited: exited.length,
    winners: exited.filter((t) => t.multiplier >= 2).length,
    avgProfit: exited.length ? Math.round((exited.reduce((s, t) => s + t.multiplier, 0) / exited.length) * 100) / 100 : 0,
    touched2x: trades.filter((t) => t.peakMultiple >= 2).length,
    gaveBack: active.filter((t) => t.peakMultiple >= 2 && t.multiplier < 1).length,
  };
}

const mcapOf = (p: Pair | undefined | null): number | null => (p ? num(p.marketCap) ?? num(p.fdv) : null);

export interface AddTradeInput {
  mint: unknown;
  symbol?: unknown;
  tab?: unknown;
  /** what the page showed; only used when DexScreener cannot be reached */
  entryMcap?: unknown;
  sizeUsd?: unknown;
}

/** Record an entry. Idempotent for the same coin within a few minutes; bounded because the address is public. */
export async function addTrade(input: AddTradeInput): Promise<{ trade?: ApiTrade; error?: string; status: number }> {
  if (!isValidMint(input.mint)) return { error: "invalid mint", status: 400 };
  const mint = input.mint;
  const tab = typeof input.tab === "string" && (TRADE_TABS as readonly string[]).includes(input.tab) ? input.tab : null;
  const symbol = typeof input.symbol === "string" ? input.symbol.replace(/[^\p{L}\p{N}_.\-$@ ]/gu, "").slice(0, 40) || null : null;
  const size = num(input.sizeUsd);
  const pool = getPool();

  const open = await pool.query(`SELECT count(*)::int AS n FROM my_trades WHERE status = 'active'`);
  if ((open.rows[0]?.n ?? 0) >= MAX_ACTIVE) return { error: "too many open trades", status: 429 };

  const dup = await pool.query<TradeRow>(
    `SELECT * FROM my_trades WHERE mint = $1 AND status = 'active' AND entered_at > now() - make_interval(mins => $2) ORDER BY entered_at DESC LIMIT 1`,
    [mint, DEDUPE_MINUTES],
  );
  if (dup.rows[0]) return { trade: toApi(dup.rows[0]), status: 200 };

  // The live market cap at the moment of the click is the best stand-in for the fill: the card on screen can be minutes old.
  const live = (await fetchPairs("solana", [mint]))?.get(mint) ?? null;
  const entryMcap = mcapOf(live) ?? num(input.entryMcap);
  if (entryMcap == null || entryMcap <= 0) return { error: "no market data for this coin", status: 400 };
  const created = live?.pairCreatedAt ?? null;

  const ins = await pool.query<TradeRow>(
    `INSERT INTO my_trades (mint, symbol, tab_name, source, entry_mcap_usd, entry_liquidity_usd, entry_price_usd,
                            pair_age_minutes_at_entry, size_usd, last_mcap_usd, peak_mcap_usd, low_mcap_usd, last_checked_at)
     VALUES ($1, $2, $3, 'radar', $4, $5, $6, $7, $8, $4, $4, $4, now())
     RETURNING *`,
    [
      mint, symbol, tab, entryMcap, num(live?.liquidity?.usd), num(live?.priceUsd),
      created ? Math.max(0, Math.round((Date.now() - created) / 60_000)) : null,
      size != null && size >= 0 && size < 1_000_000 ? size : null,
    ],
  );
  return { trade: toApi(ins.rows[0]!), status: 201 };
}

/** Close a trade at the current market cap (or at the given one). */
export async function exitTrade(id: unknown, exitMcap?: unknown): Promise<ApiTrade | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const pool = getPool();
  const cur = await pool.query<TradeRow>(`SELECT * FROM my_trades WHERE id = $1`, [id]);
  const row = cur.rows[0];
  if (!row) return null;
  if (row.status === "exited") return toApi(row);
  const live = (await fetchPairs("solana", [row.mint]))?.get(row.mint) ?? null;
  const mcap = num(exitMcap) ?? mcapOf(live) ?? num(row.last_mcap_usd) ?? num(row.entry_mcap_usd);
  const upd = await pool.query<TradeRow>(
    `UPDATE my_trades SET status = 'exited', exit_mcap_usd = $2, exited_at = now(), last_mcap_usd = $2 WHERE id = $1 RETURNING *`,
    [id, mcap],
  );
  return upd.rows[0] ? toApi(upd.rows[0]) : null;
}

/**
 * Re-measure every open trade: current market cap, and the highest/lowest seen since entry. Called by the Results page
 * (at most every 15 s) and by the learning tick, so the peak is captured as long as a screen is open.
 */
export async function refreshActiveTrades(): Promise<{ checked: number; updated: number }> {
  const pool = getPool();
  const { rows } = await pool.query<TradeRow>(
    `SELECT * FROM my_trades WHERE status = 'active' AND entered_at > now() - interval '60 days' ORDER BY entered_at DESC LIMIT $1`,
    [MAX_ACTIVE],
  );
  if (rows.length === 0) return { checked: 0, updated: 0 };
  const mints = [...new Set(rows.map((r) => r.mint))];
  const market = new Map<string, Pair>();
  let answered = true;
  for (let i = 0; i < mints.length; i += 30) {
    const found = await fetchPairs("solana", mints.slice(i, i + 30));
    if (!found) { answered = false; continue; }
    for (const [m, p] of found) market.set(m, p);
  }
  const ids: string[] = [], mcaps: Array<number | null> = [];
  for (const r of rows) {
    const mc = mcapOf(market.get(r.mint));
    // A coin DexScreener no longer lists, an hour after entry, is worth nothing; a failed call proves nothing.
    const gone = answered && !market.has(r.mint) && Date.now() - new Date(r.entered_at).getTime() > 3_600_000;
    if (mc == null && !gone) continue;
    ids.push(r.id);
    mcaps.push(mc ?? 0);
  }
  if (ids.length === 0) return { checked: rows.length, updated: 0 };
  await pool.query(
    `UPDATE my_trades t SET
        last_mcap_usd = v.mcap,
        peak_at = CASE WHEN v.mcap > COALESCE(t.peak_mcap_usd, t.entry_mcap_usd) THEN now() ELSE t.peak_at END,
        peak_mcap_usd = GREATEST(COALESCE(t.peak_mcap_usd, t.entry_mcap_usd), v.mcap),
        low_mcap_usd = LEAST(COALESCE(t.low_mcap_usd, t.entry_mcap_usd), v.mcap),
        last_checked_at = now()
       FROM unnest($1::uuid[], $2::numeric[]) AS v(id, mcap)
      WHERE t.id = v.id`,
    [ids, mcaps],
  );
  return { checked: rows.length, updated: ids.length };
}

let lastRefresh = 0;
let inflight: Promise<unknown> | null = null;

/** All trades (newest first) with live numbers; the refresh is shared by every caller within 15 s. */
export async function listTrades(): Promise<{ trades: ApiTrade[]; stats: TradeStats }> {
  if (Date.now() - lastRefresh > REFRESH_EVERY_MS) {
    inflight ??= refreshActiveTrades()
      .catch((err) => console.error("[my-trades] refresh failed", err))
      .finally(() => {
        lastRefresh = Date.now();
        inflight = null;
      });
    await inflight;
  }
  const { rows } = await getPool().query<TradeRow>(`SELECT * FROM my_trades ORDER BY entered_at DESC LIMIT 200`);
  const trades = rows.map(toApi);
  return { trades, stats: summarize(trades) };
}
