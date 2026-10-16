/**
 * Red flags that take a coin off every list, judged on what the coin looks like RIGHT NOW (docs/RED_FLAGS.md).
 *
 * Why this exists (2026-10-16): the owner kept seeing coins on the tabs that had rugged, stood at $3-4K or had fallen apart. They were listed because every tab judged a coin when it
 * qualified (or in its first hour) and never again: a graduation was "healthy" if its first hour looked fine, a signal stayed a signal until the next scan, a runner stayed a runner
 * with a minute-old reading. A live look at the 23 graduations shown by default found 13 with a severe flag (down 70% in 6 hours, a pool under $5K, a market cap under $10K) and 17 of
 * the 60 runners (nobody trading, a market cap under $10K).
 *
 * Only flags that are facts about the present are used, each one either mechanical (nobody can buy or sell there) or measured:
 *   - a pool under $5,000 or a market cap under $10,000: there is nothing to sell into (a rug looks like this: the price stands still, the pool is gone);
 *   - no priced pool at all: DexScreener lists nothing (after asking for every pool of the coin, lib/dexPairs.ts);
 *   - collapsed: down 50% in an hour, 70% in six or 80% in a day, or (for a graduation) below half of its first price or below 35% of its high: the lab's own "fallen apart" line
 *     (lib/lab/reports/common.ts isStanding), after which coins doubled half as often (8-10% against 16-18%, 315-805 coins per age);
 *   - blown off: up 300% in a day and down 40% in the last hour (a pump that has turned);
 *   - dumping: sellers at least three times the buyers (30 trades or more) while the price is falling;
 *   - no trading: fewer than 5 trades in the last hour for a coin that is not brand new.
 * Holders and wallets (the owner, 2026-10-16: "a coin with insider networks holding 99% I do not want at all"; `holderRedFlags` below): who holds a coin is a flag on its own, whatever the chart does.
 *   - linked insider wallets (RugCheck's insider networks) hold 20% of the supply or more; one wallet holds 20% or more; the ten largest wallets hold 60% or more; the creator still holds 20% or more;
 *   - RugCheck marks the coin as rugged, or the creator has rugged coins before.
 * A "wallet" is an address somebody can sign for (lib/solanaKeys.ts): the coin's own pump.fun bonding curve, a pool and other program accounts are not counted. On 2026-10-16 the largest holder of 30 of the 35
 * coins on the tabs with a "one wallet holds 20% or more" flag was such an account (22 bonding curves, 4 pools, 4 other programs), so the old card line was mostly a false alarm.
 * Evidence: of the 13 graduations (not "born", lab's 264, first look) whose insider networks held 20% or more NONE held 2x (0 of 13, against 10% of the rest), although RugCheck's insider figure is noisy (for half of
 * the coins that carry it the figure is more than the other holders leave of the supply: it double counts). The lab's largest-wallet and top-ten figures counted program accounts, so there is no evidence for the wallet
 * rules; their thresholds are the Check's own. The launch stories (graduated within 2 minutes, creator bought 5 SOL or more, serial creator) are NOT hiding flags: those coins held 2x about as often as the rest
 * (15%, 10% and 10% against 10%) and they are 24%, 12% and 35% of the graduations that were not "born".
 *
 * Pure: no network, no database. lib/liveQuotes.ts fetches the market numbers, lib/holderFacts.ts the holder shares, lib/liveGate.ts applies this to a list.
 */

/** What a coin looks like now (percent changes as DexScreener gives them: -50 is half). null = not known. */
export interface LiveState {
  price: number | null;
  mcap: number | null;
  liq: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
  buys1h: number | null;
  sells1h: number | null;
  /** age of the pool in minutes, when DexScreener says */
  pairAgeMin: number | null;
}

/** What a list already knows of a coin, to judge it against its own history. */
export interface FlagContext {
  /** price now over the price when the lab first saw the coin, at the last reading */
  sinceFirst?: number | null;
  /** highest price seen over the first price */
  peakMultiple?: number | null;
  /** market cap at that last reading: moves `sinceFirst` to the live price (the supply of these coins does not change) */
  rowMcap?: number | null;
}

export type LiveFlagCode = "no_pool" | "drained" | "tiny_cap" | "collapsed" | "blowoff" | "dumping" | "dead_flow";
export type HolderFlagCode = "rugged" | "insiders" | "one_wallet" | "top10" | "creator_holds" | "creator_rugged";
export type FlagCode = LiveFlagCode | HolderFlagCode;
export interface RedFlag {
  code: FlagCode;
  text: string;
}

export const LIMITS = {
  /** a pool smaller than this is "drained": the Check calls under $5K a warning, the Graduations tab has hidden such pools since the start */
  MIN_LIQ: 5_000,
  MIN_MCAP: 10_000,
  /** percent change lines for "collapsed" */
  H1: -50,
  H6: -70,
  H24: -80,
  /** the lab's "fallen apart": below half of the first price, or below 35% of the high */
  FELL_FROM_FIRST: 0.5,
  FELL_FROM_HIGH: 0.35,
  BLOWOFF_H24: 300,
  BLOWOFF_H1: -40,
  DUMP_RATIO: 3,
  DUMP_MIN_TRADES: 30,
  DUMP_H1: -20,
  DEAD_TRADES: 5,
  /** a pool younger than this has not had an hour to show trades in */
  DEAD_MIN_POOL_AGE_MIN: 15,
} as const;

/** Who holds a coin, as RugCheck's report reads it (lib/lab/rugcheck.ts rugSnapshot: the pool's and the burn accounts are left out of the holders). Shares are fractions 0..1 of the supply; null = not known. */
export interface HolderState {
  /** the largest wallet */
  top1: number | null;
  /** the ten largest wallets */
  top10: number | null;
  /** wallets linked to each other (RugCheck's insider networks) */
  insPct: number | null;
  /** the creator's own wallet */
  creatorPct: number | null;
  rugged: boolean;
  /** RugCheck lists "creator history of rugged tokens" among its risks */
  creatorRugged: boolean;
}

export const HOLDER_LIMITS = {
  /** the Graduations card has warned from here since the tab began ("insider networks hold N%") */
  INSIDERS: 0.2,
  /** ... and "one wallet holds N%" */
  ONE_WALLET: 0.2,
  /** the Check's own line for the ten largest holders (60%) */
  TOP10: 0.6,
  /** the Check's own line for a creator who still holds the coin (20%) */
  CREATOR_HOLDS: 0.2,
} as const;

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`);
const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * The severe flags of a coin. `live` null means DexScreener lists no priced pool for it; a coin whose numbers could not be fetched must not be passed in (the caller keeps it: failing open).
 * An empty list is a coin that stands.
 */
export function liveRedFlags(live: LiveState | null, ctx: FlagContext = {}): RedFlag[] {
  if (!live) return [{ code: "no_pool", text: "no live pool: nothing to buy or sell" }];
  const out: RedFlag[] = [];
  if (fin(live.liq) && live.liq < LIMITS.MIN_LIQ) out.push({ code: "drained", text: `pool drained: ${usd(live.liq)} left` });
  if (fin(live.mcap) && live.mcap < LIMITS.MIN_MCAP) out.push({ code: "tiny_cap", text: `market cap only ${usd(live.mcap)}` });

  const why: string[] = [];
  if (fin(live.h1) && live.h1 <= LIMITS.H1) why.push(`down ${Math.round(-live.h1)}% in the last hour`);
  if (fin(live.h6) && live.h6 <= LIMITS.H6) why.push(`down ${Math.round(-live.h6)}% in 6 hours`);
  if (fin(live.h24) && live.h24 <= LIMITS.H24) why.push(`down ${Math.round(-live.h24)}% in a day`);
  // against its own history (graduations, runners): the row's numbers are moved to the live price, because a row can be hours old
  const moved = fin(ctx.sinceFirst) && fin(ctx.rowMcap) && ctx.rowMcap > 0 && fin(live.mcap) ? ctx.sinceFirst * (live.mcap / ctx.rowMcap) : fin(ctx.sinceFirst) ? ctx.sinceFirst : null;
  if (moved != null) {
    if (moved < LIMITS.FELL_FROM_FIRST) why.push(`${Math.round((1 - moved) * 100)}% below where it was first seen`);
    else {
      const high = Math.max(fin(ctx.peakMultiple) ? ctx.peakMultiple : 1, moved);
      if (moved / high < LIMITS.FELL_FROM_HIGH) why.push(`${Math.round((1 - moved / high) * 100)}% under its high`);
    }
  }
  if (why.length) out.push({ code: "collapsed", text: `collapsed: ${why[0]}` });

  if (fin(live.h24) && live.h24 >= LIMITS.BLOWOFF_H24 && fin(live.h1) && live.h1 <= LIMITS.BLOWOFF_H1) out.push({ code: "blowoff", text: `pump that turned: up ${Math.round(live.h24)}% in a day, down ${Math.round(-live.h1)}% in the last hour` });

  const b = live.buys1h, s = live.sells1h;
  if (fin(b) && fin(s)) {
    if (b + s >= LIMITS.DUMP_MIN_TRADES && s >= LIMITS.DUMP_RATIO * b && fin(live.h1) && live.h1 <= LIMITS.DUMP_H1) out.push({ code: "dumping", text: `being dumped: ${s} sells against ${b} buys in the last hour` });
    const old = !fin(live.pairAgeMin) || live.pairAgeMin >= LIMITS.DEAD_MIN_POOL_AGE_MIN;
    if (old && b + s < LIMITS.DEAD_TRADES) out.push({ code: "dead_flow", text: `no trading: ${b + s} trade${b + s === 1 ? "" : "s"} in the last hour` });
  }
  return out;
}

const share = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The holder and wallet flags of a coin (docs/RED_FLAGS.md). `null` / undefined means the holder shares could not be read: that is not a flag (the caller keeps the coin, failing open).
 * The words are the ones the Graduations card and the Check already use.
 */
export function holderRedFlags(h: HolderState | null | undefined): RedFlag[] {
  if (!h) return [];
  const out: RedFlag[] = [];
  if (h.rugged) out.push({ code: "rugged", text: "RugCheck marks it as rugged" });
  if (fin(h.insPct) && h.insPct >= HOLDER_LIMITS.INSIDERS) out.push({ code: "insiders", text: `insider networks hold ${share(h.insPct)}` });
  if (fin(h.top1) && h.top1 >= HOLDER_LIMITS.ONE_WALLET) out.push({ code: "one_wallet", text: `one wallet holds ${share(h.top1)}` });
  if (fin(h.top10) && h.top10 >= HOLDER_LIMITS.TOP10) out.push({ code: "top10", text: `the 10 largest wallets hold ${share(h.top10)}` });
  if (fin(h.creatorPct) && h.creatorPct >= HOLDER_LIMITS.CREATOR_HOLDS) out.push({ code: "creator_holds", text: `the creator still holds ${share(h.creatorPct)}` });
  if (h.creatorRugged) out.push({ code: "creator_rugged", text: "the creator has rugged before" });
  return out;
}

/** Short word for the "hidden" line of a tab. */
export const FLAG_WORD: Record<FlagCode, string> = {
  no_pool: "no pool",
  drained: "drained",
  tiny_cap: "tiny cap",
  collapsed: "collapsed",
  blowoff: "pump turned",
  dumping: "dumped",
  dead_flow: "no trading",
  rugged: "rugged",
  insiders: "insider wallets",
  one_wallet: "one big wallet",
  top10: "top 10 hold most",
  creator_holds: "creator holds a lot",
  creator_rugged: "creator rugged before",
};
