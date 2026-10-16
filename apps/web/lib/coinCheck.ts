/**
 * "Check this coin". The user sees a coin on a Radar tab that is dead or does not belong there and presses Check. The site looks at the coin again right now
 * and says what it finds, without simply agreeing: it agrees only when the data show a dead coin, a serious problem or at least two warning signs, says
 * "I do not agree" when the coin is alive and every check that could be run passed, and says so when it cannot tell. Every check is kept (table coin_checks,
 * migration 0038) with what was measured and what the site concluded, so the Learning page can later grade the user's doubts against how those coins really
 * ended (lib/lab/reports/checks.ts), and a coin that is listed on the same tab again after a check carries a note (GET /api/coin-checks).
 *
 * What is looked at (every line is shown on the card with a mark, and a check that could not be run says so instead of passing silently):
 *   DexScreener      the pool, the 24 h volume, the trades of the last hour, the 24 h move, buying against selling (and the Hot tab's own "new and small" rule)
 *   a test sale      Jupiter's quote for selling $5 of the coin right now: no route, or a sale that loses most of the money to price impact, is what a coin you cannot get out of looks like
 *   RugCheck         flagged as rugged, whether the creator can still mint or freeze (Jupiter's audit is the second opinion), the largest wallet, linked insider wallets,
 *                    how much of the liquidity is locked or burned, whether the creator has rugged before
 *   Jupiter          what the creator still holds, how many tokens that wallet has minted
 *   this system      how far the price is below the highest this system recorded for the coin, and liquidity against its recorded peak
 * What is NOT done: re-running the tab's own filter. The tabs have different, long rules (CATE, Elite, Buy Signals, ...); a check measures the coin itself and,
 * for the Hot tab, its simple rule. The panel says so.
 */

import { CHAIN_BY_ID, isTokenAddress } from "./chains";
import type { JupToken } from "./graduateFeed";
import { rugSnapshot, type RugRow } from "./lab/rugcheck";
import { rpc } from "./wallet";
import { needsRescue, rescuePair } from "./dexPairs";
import { ageNote } from "./ageRates";

export interface Fresh {
  symbol: string | null;
  pair: string | null;
  /** which exchange the pool is on (DexScreener's dexId: "pumpswap", "raydium", ...) */
  dex?: string | null;
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
    let best = [...mine].sort((a, b) => (fin(b?.liquidity?.usd) ?? 0) - (fin(a?.liquidity?.usd) ?? 0))[0]!;
    // the batch answer is one pair per coin and can be an old pump.fun bonding-curve pair with no price: a coin that is running would then read as dead ($VEIL, 2026-10-13).
    // Ask for its other pools before saying there is no pool (Solana only: the other endpoint is asked with the same address).
    if (c.dex === "solana" && needsRescue(best)) {
      const alt = await rescuePair(address, async (u) => {
        try {
          const r = await fetchImpl(u, { headers: { accept: "application/json", "user-agent": "Aureus-Check/1.0" }, signal: AbortSignal.timeout(15_000) });
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      });
      if (alt) best = alt as typeof best;
    }
    const created = fin(best.pairCreatedAt);
    return {
      symbol: typeof best.baseToken?.symbol === "string" ? best.baseToken.symbol : null,
      pair: typeof best.pairAddress === "string" ? best.pairAddress : null,
      dex: typeof best.dexId === "string" ? best.dexId : null,
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

// ---------------------------------------------------------------- the other sources (all optional: a source that fails leaves a "not checked" line, never an error)

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** One GET, asked a second time (after a short pause) when the answer was a refusal to slow down, a server error or no answer at all: these sources are free and now and then busy. */
async function getJson(url: string, ms: number, fetchImpl: typeof fetch, pauseMs = 700): Promise<{ ok: boolean; status: number; json: any }> {
  let last = { ok: false, status: 0, json: null as any };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Aureus-Check/1.0" }, signal: AbortSignal.timeout(ms) });
      last = { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
    } catch {
      last = { ok: false, status: 0, json: null };
    }
    if (last.ok || !(last.status === 0 || last.status === 429 || last.status >= 500)) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return last;
}

/** Jupiter's record of a coin: decimals and price for the test sale, the authorities, holders and creator as a second opinion. null: Jupiter answered and does not list the coin; "error": it could not be asked. */
export async function fetchJupiterToken(mint: string, fetchImpl: typeof fetch = fetch): Promise<JupToken | null | "error"> {
  const r = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, 8_000, fetchImpl);
  if (!r.ok || !Array.isArray(r.json)) return "error";
  return (r.json as JupToken[]).find((x) => x?.id === mint) ?? null;
}

/** How many decimals a coin has, from the chain itself (for the test sale when Jupiter's record is missing). null when no node answered. */
export async function fetchDecimals(mint: string, rpcImpl: typeof rpc = rpc): Promise<number | null> {
  const r = await rpcImpl("getTokenSupply", [mint], { tries: 2, timeoutMs: 6_000 });
  const d = r?.value?.decimals;
  return Number.isInteger(d) && d >= 0 && d <= 18 ? d : null;
}

/** RugCheck's report of a coin, reduced to the figures the check uses (lib/lab/rugcheck.ts reads it the same way for the lab). */
export async function fetchRug(mint: string, fetchImpl: typeof fetch = fetch, nowS = Date.now() / 1000): Promise<RugRow | null> {
  const r = await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, 10_000, fetchImpl);
  return r.ok && r.json ? rugSnapshot(r.json, nowS) : null;
}

/**
 * Is there a way out, and how deep is it: Jupiter's own router quotes the sale of about $5 of the coin into USDC. What is judged is whether a route exists and the price impact the router
 * reports for the sale; the dollars it brings in are NOT compared with DexScreener's price: the two prices differ by 10 to 30% on fast-moving coins (DexScreener lags on young pools),
 * which looked like a "loss" of that size at every sale size until this was checked on 2026-10-12.
 */
export const SELL_TEST_USD = 5;
export interface SellResult {
  state: "ok" | "no-route" | "error";
  usdOut?: number;
  /** the router's estimate of how far the sale moves the price, as a fraction (0.01 = 1%); absent when the answer did not carry one */
  impact?: number;
  code?: string;
}
export async function sellTest(mint: string, priceUsd: number | null, decimals: number | null, fetchImpl: typeof fetch = fetch): Promise<SellResult> {
  if (!(priceUsd != null && priceUsd > 0) || decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return { state: "error" };
  const coins = Math.floor(SELL_TEST_USD / priceUsd);
  if (!Number.isFinite(coins) || coins < 1) return { state: "error" };
  const raw = BigInt(coins) * 10n ** BigInt(decimals);
  const r = await getJson(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${USDC}&amount=${raw.toString()}&slippageBps=500`, 10_000, fetchImpl);
  if (r.ok && r.json?.outAmount != null) {
    const out = Number(r.json.outAmount) / 1e6;
    if (!Number.isFinite(out) || out <= 0) return { state: "error" };
    const impact = r.json.priceImpactPct == null ? NaN : Math.abs(Number(r.json.priceImpactPct));
    return { state: "ok", usdOut: out, ...(Number.isFinite(impact) ? { impact } : {}) };
  }
  const code = typeof r.json?.errorCode === "string" ? r.json.errorCode : undefined;
  if (code && /NOT_TRADABLE|NO_ROUTE|COULD_NOT_FIND/i.test(code)) return { state: "no-route", code };
  return { state: "error" };
}

/** What this system itself recorded of the coin: the first and the highest price and the peak liquidity (null when it never saw the coin). */
export interface Memory {
  firstAt: number;
  firstP: number | null;
  maxP: number | null;
  maxLiq: number | null;
}
export async function fetchMemory(db: Db, chain: string, mint: string): Promise<Memory | null> {
  if (chain !== "solana") return null;
  try {
    const pools = (await db.query(`SELECT pl.id FROM tokens t JOIN pools pl ON pl.token_id = t.id WHERE t.mint = $1`, [mint])).rows.map((r) => r.id as string);
    if (!pools.length) return null;
    const r = (
      await db.query(
        `SELECT EXTRACT(EPOCH FROM min(observed_at))::float8 AS first_at, max(price_usd)::float8 AS max_p,
                (SELECT price_usd::float8 FROM prices WHERE pool_id = ANY($1::uuid[]) ORDER BY observed_at ASC LIMIT 1) AS first_p,
                (SELECT max(liquidity_usd)::float8 FROM liquidity_snapshots WHERE pool_id = ANY($1::uuid[])) AS max_liq
           FROM prices WHERE pool_id = ANY($1::uuid[])`,
        [pools],
      )
    ).rows[0];
    return r?.first_at == null ? null : { firstAt: Number(r.first_at), firstP: fin(r.first_p), maxP: fin(r.max_p), maxLiq: fin(r.max_liq) };
  } catch {
    return null;
  }
}

export interface Extras {
  jup?: JupToken | null;
  sell?: SellResult | null;
  rug?: RugRow | null;
  memory?: Memory | null;
  /** why a source is missing, for a "not checked" line */
  skipped?: Partial<Record<"sell" | "rug" | "memory", string>>;
}

/** Everything the check can add, fetched together; each part is allowed to fail. Only on Solana (RugCheck, the test sale and this system's memory know nothing of the other networks). */
export async function fetchExtras(chain: string, mint: string, fresh: Fresh, db: Db, fetchImpl: typeof fetch = fetch, rpcImpl: typeof rpc = rpc): Promise<Extras> {
  if (chain !== "solana") return { skipped: { sell: "only on Solana", rug: "only on Solana", memory: "only for coins this system scanned" } };
  const [jupAnswer, rug, memory] = await Promise.all([fetchJupiterToken(mint, fetchImpl).catch((): "error" => "error"), fetchRug(mint, fetchImpl).catch(() => null), fetchMemory(db, chain, mint)]);
  const jup = jupAnswer === "error" ? null : jupAnswer;
  const price = fresh.priceUsd ?? jup?.usdPrice ?? null;
  // the sale needs the coin's decimals: Jupiter's record has them, the chain is the second source
  const decimals = jup?.decimals ?? (await fetchDecimals(mint, rpcImpl).catch(() => null));
  const sell = await sellTest(mint, price, decimals, fetchImpl).catch((): SellResult => ({ state: "error" }));
  return {
    jup,
    sell,
    rug,
    memory,
    skipped: {
      ...(sell.state === "error" ? { sell: decimals == null ? "the coin's decimals could not be read" : price == null ? "no price to size the sale with" : "Jupiter did not answer the quote just now" } : {}),
      ...(!rug ? { rug: "RugCheck has no report for it (yet)" } : {}),
      ...(!memory ? { memory: "this system never scanned it" } : {}),
    },
  };
}

// ---------------------------------------------------------------- the verdict

/** The thresholds, in one place: a pool under this is dead (the same line the lab and the wallet review use for "no real pool"). */
export const DEAD_LIQ_USD = 1_000;
const WEAK_LIQ_USD = 5_000;
const WEAK_TRADES_H1 = 10;
const WEAK_VOL24_USD = 3_000;
const CRASH_24H_PCT = -70;
const SELL_PRESSURE = 3;
/**
 * The price impact the router reports for a $5 sale. A pool of $1,000 moves about 1%, so 3% or more means the depth Jupiter can use is thinner than the pool's size suggests (a warning sign), and
 * 10% or more that most of that liquidity cannot be sold into (serious).
 */
const SELL_IMPACT_WARN = 0.03;
const SELL_IMPACT_BAD = 0.1;
const ONE_WALLET = 0.25;
/** Linked insider wallets: 13% was common among the Radar's coins on 2026-10-12 (calibration over 42 listed coins), so the line is where it becomes unusual. */
const INSIDERS = 0.2;
const TOP10_PCT = 60;
const LP_LOCKED_MIN = 50;
const CREATOR_HOLDS_PCT = 20;
const SERIAL_MINTS = 50;
const DRAWDOWN_WARN = 0.8;
const DRAWDOWN_BAD = 0.95;
const LIQ_OF_PEAK = 0.2;

/** A coin that is dead on DexScreener's own numbers needs no further proof (no test sale, no RugCheck). */
export const looksDead = (f: Fresh): boolean => (f.liq ?? 0) < DEAD_LIQ_USD || ((f.buys1 ?? 0) + (f.sells1 ?? 0) === 0 && (f.vol24 ?? 0) < 1_000);

/** ok: fine; warn: a warning sign; bad: serious; skip: could not be checked; note: shown, but counted as neither (a figure that cannot tell a bad sign from a harmless one). */
export type CheckState = "ok" | "warn" | "bad" | "skip" | "note";
/** One line of the check: what was looked at and what it showed. `flag` is the short wording kept in the record (when different from the text). */
export interface CheckLine {
  key: string;
  state: CheckState;
  text: string;
  flag?: string;
  /** for a line that was not run: what was not checked, in two or three words */
  label?: string;
}

export interface Judgement {
  verdict: "agree" | "disagree" | "unclear";
  /** the coin looks dead (no pool, a pool under $1,000, or no trades for an hour with next to no volume): null when it could not be measured */
  dead: boolean | null;
  /** the warning signs found, in words */
  flags: string[];
  /** what the panel says: the facts, then the conclusion */
  lines: string[];
  /** every check that was looked at, with its result (absent in records made before the checks were itemised) */
  checks?: CheckLine[];
}

const usd = (v: number | null) => (v == null ? "?" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}%`;

/** The Hot tab lists new or exploding small coins with a pool that can be traded (HotChains.tsx isNewSmall): the same rule on fresh numbers. */
function hotFit(f: Fresh): string | null {
  const reasons: string[] = [];
  if (f.mcap != null && f.mcap > 300e6) reasons.push("market cap over $300M");
  if (!((f.ageH ?? 1e9) <= 720 || (f.ch24 ?? 0) >= 100)) reasons.push("older than 30 days and not exploding");
  if ((f.liq ?? 0) < 10_000) reasons.push("pool under $10K");
  if ((f.vol24 ?? 0) < 10_000) reasons.push("24 h volume under $10K");
  return reasons.length ? `no longer fits the Hot tab (${reasons.join(", ")})` : null;
}

const ago = (secs: number) => {
  const d = secs / 86400;
  return d >= 2 ? `${Math.round(d)} days ago` : `${Math.max(1, Math.round(secs / 3600))} h ago`;
};

export function judgeCoin(fresh: Fresh | null | "error", ctx: { tab: string }, extra: Extras = {}, nowS = Date.now() / 1000): Judgement {
  if (fresh === "error") return { verdict: "unclear", dead: null, flags: [], lines: ["I could not look at the coin just now (DexScreener did not answer). Nothing was concluded; try again in a minute."] };
  if (fresh === null) {
    return {
      verdict: "agree",
      dead: true,
      flags: ["no pool listed"],
      lines: ["DexScreener lists no pool for this coin any more.", "You are right: it is dead. The lists catch up at their next scan; this check is kept."],
      checks: [{ key: "pool", state: "bad", text: "No pool is listed any more", flag: "no pool listed" }],
    };
  }
  const trades1 = (fresh.buys1 ?? 0) + (fresh.sells1 ?? 0);
  const liq = fresh.liq ?? 0;
  const silent = trades1 === 0 && (fresh.vol24 ?? 0) < 1_000;
  const dead = liq < DEAD_LIQ_USD || silent;
  const checks: CheckLine[] = [];
  const add = (key: string, state: CheckState, text: string, flag?: string, label?: string) => checks.push({ key, state, text, ...(flag ? { flag } : {}), ...(label ? { label } : {}) });

  // the market, from DexScreener
  if (liq < DEAD_LIQ_USD) add("pool", "bad", `Pool ${usd(fresh.liq)}: under ${usd(DEAD_LIQ_USD)}`, `pool under ${usd(DEAD_LIQ_USD)}`);
  else if (liq < WEAK_LIQ_USD) add("pool", "warn", `Pool ${usd(fresh.liq)}: under ${usd(WEAK_LIQ_USD)}`, `pool under ${usd(WEAK_LIQ_USD)}`);
  else add("pool", "ok", `Pool ${usd(fresh.liq)}`);
  if (silent) add("trades", "bad", "No trades for an hour and almost no volume in a day", "no trades for an hour and almost no volume in a day");
  else if (trades1 < WEAK_TRADES_H1) add("trades", dead ? "bad" : "warn", `Only ${trades1} trade${trades1 === 1 ? "" : "s"} in the last hour`, `only ${trades1} trade${trades1 === 1 ? "" : "s"} in the last hour`);
  else add("trades", "ok", `${trades1} trades in the last hour`);
  if (!dead) {
    if ((fresh.vol24 ?? 0) < WEAK_VOL24_USD) add("volume", "warn", `24 h volume ${usd(fresh.vol24)}: under ${usd(WEAK_VOL24_USD)}`, `24 h volume under ${usd(WEAK_VOL24_USD)}`);
    else add("volume", "ok", `24 h volume ${usd(fresh.vol24)}`);
    if (fresh.ch24 != null) {
      if (fresh.ch24 <= CRASH_24H_PCT) add("move", "warn", `Down ${Math.abs(Math.round(fresh.ch24))}% in 24 hours`, `down ${Math.abs(Math.round(fresh.ch24))}% in 24 hours`);
      else add("move", "ok", `${signed(fresh.ch24)} in 24 hours`);
    }
    if (trades1 >= 20) {
      if ((fresh.sells1 ?? 0) > SELL_PRESSURE * (fresh.buys1 ?? 0)) add("pressure", "warn", `Selling outweighs buying ${SELL_PRESSURE} to 1 in the last hour (${fresh.buys1 ?? 0} buys, ${fresh.sells1 ?? 0} sells)`, "selling outweighs buying 3 to 1 in the last hour");
      else add("pressure", "ok", `Buying and selling in balance (${fresh.buys1 ?? 0} buys, ${fresh.sells1 ?? 0} sells in the last hour)`);
    }
    // how old the pool is, with what the lab measured for PumpSwap coins of that age: shown, never counted (a group's rate says nothing about this coin, and a young coin must not be hidden for being young)
    if (fresh.dex === "pumpswap" && fresh.ageH != null) {
      const note = ageNote(fresh.ageH);
      if (note) add("age", "note", note);
    }
  }

  // the rest only for a coin that is alive: a dead coin needs no further proof
  if (!dead) {
    const { jup, sell, rug, memory, skipped } = extra;
    // can the money be got out
    if (sell?.state === "ok") {
      const imp = sell.impact;
      const shown = imp == null ? null : imp >= 0.01 ? `${Math.round(imp * 100)}%` : imp < 0.001 ? "under 0.1%" : `${(imp * 100).toFixed(1)}%`;
      if (imp != null && imp >= SELL_IMPACT_BAD) add("sell", "bad", `A $${SELL_TEST_USD} sale would move the price ${shown}: almost none of the pool can be sold into`, `a $${SELL_TEST_USD} sale would move the price ${shown}`);
      else if (imp != null && imp >= SELL_IMPACT_WARN) add("sell", "warn", `A $${SELL_TEST_USD} sale would move the price ${shown}: thinner than the pool's size suggests`, `a $${SELL_TEST_USD} sale would move the price ${shown}`);
      else add("sell", "ok", `A $${SELL_TEST_USD} sale finds a route${shown ? ` (price impact ${shown})` : ""}`);
    } else if (sell?.state === "no-route") add("sell", "bad", `It cannot be sold: Jupiter finds no route (${sell.code ?? "no route"})`, "it cannot be sold (no route)");
    else add("sell", "skip", `Test sale not run: ${skipped?.sell ?? "not available"}`, undefined, "the test sale");

    // what the creator can still do (RugCheck first, Jupiter as the second opinion)
    const mintOff = rug?.mintOff ?? jup?.audit?.mintAuthorityDisabled ?? null;
    const freezeOff = rug?.freezeOff ?? jup?.audit?.freezeAuthorityDisabled ?? null;
    if (mintOff === false) add("mint", "bad", "The creator can still mint more coins", "the creator can still mint more coins");
    if (freezeOff === false) add("freeze", "bad", "The creator can freeze wallets", "the creator can freeze wallets");
    if (mintOff === true && freezeOff === true) add("authority", "ok", "Mint and freeze authority are switched off");
    else if (mintOff == null && freezeOff == null) add("authority", "skip", "Mint and freeze authority not known", undefined, "the mint and freeze authority");

    if (rug?.rugged) add("rugged", "bad", "RugCheck marks this coin as rugged", "RugCheck marks it as rugged");
    // who holds it
    if (rug && (rug.top1 != null || rug.insPct != null)) {
      let bad = false;
      if (rug.top1 != null && rug.top1 >= ONE_WALLET) {
        add("top1", "warn", `One wallet holds ${pct(rug.top1)}`, `one wallet holds ${pct(rug.top1)}`);
        bad = true;
      }
      if (rug.insPct != null && rug.insPct >= INSIDERS) {
        add("insiders", "warn", `Linked insider wallets hold ${pct(rug.insPct)}`, `insider networks hold ${pct(rug.insPct)}`);
        bad = true;
      }
      if (!bad) add("holders", "ok", `Largest wallet ${rug.top1 == null ? "?" : pct(rug.top1)}, linked insider wallets ${rug.insPct == null ? "?" : pct(rug.insPct)}`);
    } else if (jup?.audit?.topHoldersPercentage != null) {
      const top = jup.audit.topHoldersPercentage;
      if (top >= TOP10_PCT) add("top10", "warn", `The 10 largest holders hold ${Math.round(top)}%`, `top 10 hold ${Math.round(top)}%`);
      else add("holders", "ok", `The 10 largest holders hold ${Math.round(top)}%`);
    } else add("holders", "skip", `Holders not checked: ${skipped?.rug ?? "no data"}`, undefined, "the holders");
    if (rug?.lp != null && rug.lp < LP_LOCKED_MIN && liq >= WEAK_LIQ_USD) add("lp", "warn", `Only ${Math.round(rug.lp)}% of the liquidity is locked or burned`, `only ${Math.round(rug.lp)}% of the liquidity is locked`);
    // the creator
    const holds = jup?.audit?.devBalancePercentage;
    if (holds != null && holds >= CREATOR_HOLDS_PCT) add("creator-holds", "warn", `The creator still holds ${Math.round(holds)}%`, `the creator still holds ${Math.round(holds)}%`);
    const minted = jup?.audit?.devMints;
    // 17 of the 42 coins on the Radar on 2026-10-12 had a creator wallet with 50 or more tokens, up to 191,441: launch tools mint thousands of tokens from one wallet, and this count cannot tell them from
    // a serial launcher, so it is shown but not counted (counting it made the check agree with 36% of the Radar's coins, mostly on the strength of this and one other mild sign)
    if (minted != null && minted >= SERIAL_MINTS) add("creator-mints", "note", `The creator's wallet has minted ${minted} tokens (noted, not counted: a launch tool and a serial launcher look the same here)`);
    if (rug?.risks.some((x) => /creator history of rugged/i.test(x))) add("creator-rugs", "warn", "The creator has rugged coins before (RugCheck)", "the creator has rugged before");
    // this system's memory of the coin
    if (memory && memory.maxP != null && memory.maxP > 0 && fresh.priceUsd != null) {
      const dd = 1 - fresh.priceUsd / memory.maxP;
      const when = ago(Math.max(0, nowS - memory.firstAt));
      if (dd >= DRAWDOWN_BAD) add("memory", "bad", `Down ${pct(dd)} from the highest price this system recorded (first seen ${when})`, `down ${pct(dd)} from the highest price recorded`);
      else if (dd >= DRAWDOWN_WARN) add("memory", "warn", `Down ${pct(dd)} from the highest price this system recorded (first seen ${when})`, `down ${pct(dd)} from the highest price recorded`);
      else add("memory", "ok", `${dd > 0.02 ? `${pct(dd)} below` : "At or near"} the highest price this system recorded (first seen ${when})`);
      if (memory.maxLiq != null && memory.maxLiq >= 10_000 && liq < LIQ_OF_PEAK * memory.maxLiq) add("memory-liq", "warn", `Liquidity is ${pct(liq / memory.maxLiq)} of its recorded peak (${usd(memory.maxLiq)})`, "liquidity far below its peak");
    } else add("memory", "skip", `This system's own record not used: ${skipped?.memory ?? "no record"}`, undefined, "this system's own record");
  }
  const tabFit = ctx.tab === "hot" ? hotFit(fresh) : null;
  if (tabFit) add("hot-rule", "warn", tabFit.charAt(0).toUpperCase() + tabFit.slice(1), tabFit);

  const bad = checks.filter((c) => c.state === "bad");
  const warn = checks.filter((c) => c.state === "warn");
  const flags = [...bad, ...warn].map((c) => c.flag ?? c.text);
  const ran = checks.filter((c) => c.state !== "skip" && c.state !== "note").length;
  const notRun = checks.filter((c) => c.state === "skip").map((c) => c.label ?? c.key);
  const facts = `Pool ${usd(fresh.liq)} · 24 h volume ${usd(fresh.vol24)} · ${trades1} trade${trades1 === 1 ? "" : "s"} in the last hour${fresh.ch24 != null ? ` · ${signed(fresh.ch24)} in 24 h` : ""}.`;
  const base = { checks };
  if (dead) return { verdict: "agree", dead: true, flags, lines: [facts, `You are right: it looks dead (${flags[0]}).`], ...base };
  if (bad.length) return { verdict: "agree", dead: false, flags, lines: [facts, `You are right: ${bad.map((c) => c.flag ?? c.text).join("; ")}${warn.length ? `. Also: ${warn.map((c) => c.flag ?? c.text).join("; ")}` : ""}.`], ...base };
  if (warn.length >= 2) return { verdict: "agree", dead: false, flags, lines: [facts, `You have a point: ${flags.join("; ")}.`], ...base };
  if (warn.length === 1) return { verdict: "unclear", dead: false, flags, lines: [facts, `One warning sign (${flags[0]}), not enough to call it dead or out of place. I have noted it.`], ...base };
  return {
    verdict: "disagree",
    dead: false,
    flags,
    lines: [
      facts,
      `I do not agree: the coin is alive and passes the ${ran} checks I could run${notRun.length ? ` (not checked: ${notRun.join(", ")})` : ""}. I have noted your doubt and will grade it against how the coin ends.`,
    ],
    ...base,
  };
}

// ---------------------------------------------------------------- storage

interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** The tab names the learning system and the trade journal use (the page's JOURNAL_TAB values). */
/** The tabs a Check can come from; "pasted" is a coin pasted into the box at the top of the Radar and Home (on no tab at all). */
export const CHECK_TABS = new Set(["cate", "buy_signals", "ultra_momentum", "elite", "incubation", "runners", "graduates", "hot", "pasted"]);

/** At most this many checks a minute for the whole site (it is public, and every check asks DexScreener, Jupiter twice, RugCheck and the database; Jupiter's free API allows about 60 requests a minute). */
export const CHECKS_PER_MINUTE = 15;

export async function recentCount(db: Db): Promise<number> {
  return Number((await db.query(`SELECT count(*)::int AS n FROM coin_checks WHERE created_at > now() - interval '1 minute'`)).rows[0]?.n ?? 0);
}

/** The same coin on the same tab checked less than a minute ago: that answer (so a double click, or two devices, make one row). */
export async function lastCheck(db: Db, chain: string, mint: string, tab: string): Promise<{ at: string; judgement: Judgement; symbol: string | null } | null> {
  const r = (
    await db.query(
      `SELECT created_at, verdict, dead, flags, lines, symbol, snapshot->'checks' AS checks FROM coin_checks WHERE mint = $1 AND chain = $2 AND tab = $3 AND created_at > now() - interval '1 minute' ORDER BY created_at DESC LIMIT 1`,
      [mint, chain, tab],
    )
  ).rows[0];
  if (!r) return null;
  return { at: new Date(r.created_at).toISOString(), symbol: r.symbol ?? null, judgement: { verdict: r.verdict, dead: r.dead, flags: r.flags ?? [], lines: r.lines ?? [], ...(Array.isArray(r.checks) ? { checks: r.checks } : {}) } };
}

export async function recordCheck(db: Db, c: { chain: string; mint: string; symbol: string | null; tab: string; judgement: Judgement; fresh: Fresh | null | "error" }): Promise<string> {
  const snapshot = { fresh: c.fresh && c.fresh !== "error" ? c.fresh : null, checks: c.judgement.checks ?? [] };
  const { rows } = await db.query(
    `INSERT INTO coin_checks (mint, chain, symbol, tab, verdict, dead, flags, lines, snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::jsonb) RETURNING created_at`,
    [c.mint, c.chain, c.symbol, c.tab, c.judgement.verdict, c.judgement.dead, c.judgement.flags, c.judgement.lines, JSON.stringify(snapshot)],
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
