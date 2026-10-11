/**
 * "Check this coin". The user sees a coin on a Radar tab that is dead or does not belong there and presses Check. The site looks at the coin again right now
 * (DexScreener) and says what it finds, without simply agreeing: it agrees only when the data show a dead coin or at least two warning signs, says "I do not agree"
 * when the coin is alive and nothing looks wrong, and says so when it cannot tell. Every check is kept (table coin_checks, migration 0038) with what was measured and
 * what the site concluded, so the Learning page can later grade the user's doubts against how those coins really ended (lib/lab/reports/checks.ts), and a coin that
 * is listed on the same tab again after a check carries a note (GET /api/coin-checks).
 *
 * What is NOT done: re-running the tab's own filter. The tabs have different, long rules (CATE, Elite, Buy Signals, ...); a check measures the coin itself and, for the
 * Hot tab, its simple "new and small" rule. The panel says so.
 */

import { CHAIN_BY_ID, isTokenAddress } from "./chains";

export interface Fresh {
  symbol: string | null;
  pair: string | null;
  priceUsd: number | null;
  liq: number | null;
  mcap: number | null;
  vol1: number | null;
  vol24: number | null;
  buys1: number | null;
  sells1: number | null;
  ch1: number | null;
  ch24: number | null;
  /** hours since the pool was created */
  ageH: number | null;
}

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/** DexScreener's best pool (most liquidity) of the coin right now: null when it lists none, "error" when it could not be asked. */
export async function fetchFresh(chain: string, address: string, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<Fresh | null | "error"> {
  const c = CHAIN_BY_ID.get(chain);
  if (!c || !isTokenAddress(chain, address)) return "error";
  try {
    const res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/${c.dex}/${address}`, { headers: { accept: "application/json", "user-agent": "Aureus-Check/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return "error";
    const pairs = (await res.json()) as any[];
    if (!Array.isArray(pairs)) return "error";
    const mine = pairs.filter((p) => String(p?.baseToken?.address ?? "").toLowerCase() === address.toLowerCase());
    if (!mine.length) return null;
    const best = [...mine].sort((a, b) => (fin(b?.liquidity?.usd) ?? 0) - (fin(a?.liquidity?.usd) ?? 0))[0]!;
    const created = fin(best.pairCreatedAt);
    return {
      symbol: typeof best.baseToken?.symbol === "string" ? best.baseToken.symbol : null,
      pair: typeof best.pairAddress === "string" ? best.pairAddress : null,
      priceUsd: fin(best.priceUsd),
      liq: fin(best.liquidity?.usd),
      mcap: fin(best.marketCap) ?? fin(best.fdv),
      vol1: fin(best.volume?.h1),
      vol24: fin(best.volume?.h24),
      buys1: fin(best.txns?.h1?.buys),
      sells1: fin(best.txns?.h1?.sells),
      ch1: fin(best.priceChange?.h1),
      ch24: fin(best.priceChange?.h24),
      ageH: created != null ? Math.max(0, (nowMs - created) / 3_600_000) : null,
    };
  } catch {
    return "error";
  }
}

/** The thresholds, in one place: a pool under this is dead (the same line the lab and the wallet review use for "no real pool"). */
export const DEAD_LIQ_USD = 1_000;
const WEAK_LIQ_USD = 5_000;
const WEAK_TRADES_H1 = 10;
const WEAK_VOL24_USD = 3_000;
const CRASH_24H_PCT = -70;
const SELL_PRESSURE = 3;

export interface Judgement {
  verdict: "agree" | "disagree" | "unclear";
  /** the coin looks dead (no pool, a pool under $1,000, or no trades for an hour with next to no volume): null when it could not be measured */
  dead: boolean | null;
  /** the warning signs found, in words */
  flags: string[];
  /** what the panel says: facts, then the conclusion */
  lines: string[];
}

const usd = (v: number | null) => (v == null ? "?" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

/** The Hot tab lists new or exploding small coins with a pool that can be traded (HotChains.tsx isNewSmall): the same rule on fresh numbers. */
function hotFit(f: Fresh): string | null {
  const reasons: string[] = [];
  if (f.mcap != null && f.mcap > 300e6) reasons.push("market cap over $300M");
  if (!((f.ageH ?? 1e9) <= 720 || (f.ch24 ?? 0) >= 100)) reasons.push("older than 30 days and not exploding");
  if ((f.liq ?? 0) < 10_000) reasons.push("pool under $10K");
  if ((f.vol24 ?? 0) < 10_000) reasons.push("24 h volume under $10K");
  return reasons.length ? `no longer fits the Hot tab (${reasons.join(", ")})` : null;
}

export function judgeCoin(fresh: Fresh | null | "error", ctx: { tab: string }): Judgement {
  if (fresh === "error") return { verdict: "unclear", dead: null, flags: [], lines: ["I could not look at the coin just now (DexScreener did not answer). Nothing was concluded; try again in a minute."] };
  if (fresh === null) {
    return { verdict: "agree", dead: true, flags: ["no pool listed"], lines: ["DexScreener lists no pool for this coin any more.", "You are right: it is dead. The lists catch up at their next scan; this check is kept."] };
  }
  const trades1 = (fresh.buys1 ?? 0) + (fresh.sells1 ?? 0);
  const dead = (fresh.liq ?? 0) < DEAD_LIQ_USD || (trades1 === 0 && (fresh.vol24 ?? 0) < 1_000);
  const flags: string[] = [];
  if (dead) flags.push((fresh.liq ?? 0) < DEAD_LIQ_USD ? `pool under ${usd(DEAD_LIQ_USD)}` : "no trades for an hour and almost no volume in a day");
  else {
    if ((fresh.liq ?? 0) < WEAK_LIQ_USD) flags.push(`pool under ${usd(WEAK_LIQ_USD)}`);
    if (trades1 < WEAK_TRADES_H1) flags.push(`only ${trades1} trade${trades1 === 1 ? "" : "s"} in the last hour`);
    if ((fresh.vol24 ?? 0) < WEAK_VOL24_USD) flags.push(`24 h volume under ${usd(WEAK_VOL24_USD)}`);
    if (fresh.ch24 != null && fresh.ch24 <= CRASH_24H_PCT) flags.push(`down ${Math.abs(Math.round(fresh.ch24))}% in 24 hours`);
    if (trades1 >= 20 && (fresh.sells1 ?? 0) > SELL_PRESSURE * (fresh.buys1 ?? 0)) flags.push("selling outweighs buying 3 to 1 in the last hour");
  }
  const tabFit = ctx.tab === "hot" ? hotFit(fresh) : null;
  if (tabFit) flags.push(tabFit);

  const facts = `Pool ${usd(fresh.liq)} · 24 h volume ${usd(fresh.vol24)} · ${trades1} trade${trades1 === 1 ? "" : "s"} in the last hour${fresh.ch24 != null ? ` · ${fresh.ch24 >= 0 ? "+" : "−"}${Math.abs(Math.round(fresh.ch24))}% in 24 h` : ""}.`;
  if (dead) return { verdict: "agree", dead: true, flags, lines: [facts, `You are right: it looks dead (${flags[0]}).`] };
  if (flags.length >= 2) return { verdict: "agree", dead: false, flags, lines: [facts, `You have a point: ${flags.join("; ")}.`] };
  if (flags.length === 1) return { verdict: "unclear", dead: false, flags, lines: [facts, `One warning sign (${flags[0]}), not enough to call it dead or out of place. I have noted it.`] };
  return {
    verdict: "disagree",
    dead: false,
    flags,
    lines: [facts, "I do not agree: the coin is alive and I see no warning sign in these numbers. I have noted your doubt and will grade it against how the coin ends."],
  };
}

// ---------------------------------------------------------------- storage

interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** The tab names the learning system and the trade journal use (the page's JOURNAL_TAB values). */
export const CHECK_TABS = new Set(["cate", "buy_signals", "ultra_momentum", "elite", "incubation", "runners", "graduates", "hot"]);

/** At most this many checks a minute for the whole site (it is public, and every check asks DexScreener). */
export const CHECKS_PER_MINUTE = 30;

export async function recentCount(db: Db): Promise<number> {
  return Number((await db.query(`SELECT count(*)::int AS n FROM coin_checks WHERE created_at > now() - interval '1 minute'`)).rows[0]?.n ?? 0);
}

/** The same coin on the same tab checked less than a minute ago: that answer (so a double click, or two devices, make one row). */
export async function lastCheck(db: Db, chain: string, mint: string, tab: string): Promise<{ at: string; judgement: Judgement; symbol: string | null } | null> {
  const r = (
    await db.query(
      `SELECT created_at, verdict, dead, flags, lines, symbol FROM coin_checks WHERE mint = $1 AND chain = $2 AND tab = $3 AND created_at > now() - interval '1 minute' ORDER BY created_at DESC LIMIT 1`,
      [mint, chain, tab],
    )
  ).rows[0];
  if (!r) return null;
  return { at: new Date(r.created_at).toISOString(), symbol: r.symbol ?? null, judgement: { verdict: r.verdict, dead: r.dead, flags: r.flags ?? [], lines: r.lines ?? [] } };
}

export async function recordCheck(db: Db, c: { chain: string; mint: string; symbol: string | null; tab: string; judgement: Judgement; fresh: Fresh | null | "error" }): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO coin_checks (mint, chain, symbol, tab, verdict, dead, flags, lines, snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::jsonb) RETURNING created_at`,
    [c.mint, c.chain, c.symbol, c.tab, c.judgement.verdict, c.judgement.dead, c.judgement.flags, c.judgement.lines, c.fresh && c.fresh !== "error" ? JSON.stringify(c.fresh) : null],
  );
  return new Date(rows[0].created_at).toISOString();
}

export interface CheckNote {
  mint: string;
  tab: string;
  at: string;
  verdict: Judgement["verdict"];
  /** the tab listed the coin again after the check (a new qualification row): it came back */
  returned: boolean;
}

/**
 * The latest check of every coin and tab in the last 14 days, and whether the coin has come back on that tab since: a new row in coin_qualifications
 * (the learning system writes one when a tab lists a coin it was not listing). The Hot, Runners and Graduations lists keep no such record, so their notes
 * only say that the coin was checked.
 */
export async function recentChecks(db: Db): Promise<CheckNote[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (c.mint, c.tab) c.mint, c.tab, c.created_at, c.verdict,
            EXISTS (SELECT 1 FROM coin_qualifications q WHERE q.mint = c.mint AND q.tab_name = c.tab AND q.qualified_at > c.created_at) AS returned
       FROM coin_checks c WHERE c.created_at > now() - interval '14 days' ORDER BY c.mint, c.tab, c.created_at DESC LIMIT 400`,
  );
  return rows.map((r) => ({ mint: r.mint, tab: r.tab, at: new Date(r.created_at).toISOString(), verdict: r.verdict, returned: Boolean(r.returned) }));
}
