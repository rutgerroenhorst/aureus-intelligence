/**
 * DexScreener's batch endpoint (tokens/v1/solana/<mints>) answers with ONE pair per coin. For a coin with several pools that one pair can be an old pump.fun
 * bonding-curve pair that has no price (found on 2026-10-13: $VEIL, a graduation that went about 50x, was answered with its dead bonding-curve pair for
 * hours; the lab marked it "never listed" after twelve polls, the Graduations tab hid it, the exit alerts could not have priced it and the Check button would have
 * called it dead). The other endpoint (latest/dex/tokens/<mint>) lists every pool of a coin, so for the rare coin whose batch answer has no price the code asks that one.
 *
 * Measured on 2026-10-13 over 1,430 coins (96 hours of graduations and every coin the wallet ever bought): 1,021 were answered with a price, 2 with a pair without one,
 * 407 not at all; of those 409 exactly one (VEIL) had a live pool, so the extra calls are rare (scripts/dex-pair-check.ts).
 *
 * Pure apart from the injected fetch function; no database, no environment.
 */

export interface DexPairLike {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string | number | null;
  liquidity?: { usd?: number | null };
  marketCap?: number | null;
  fdv?: number | null;
  pairCreatedAt?: number | null;
  [k: string]: unknown;
}

export type GetJson = (url: string) => Promise<unknown>;

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

export const isPriced = (p: DexPairLike | null | undefined): boolean => (fin(p?.priceUsd) ?? 0) > 0;

/** The most liquid pair of the coin that has a price (null when none has). Only pairs whose base token is the coin and that are on the chain count. */
export function bestPricedPair<T extends DexPairLike>(pairs: T[], mint: string, chain = "solana"): T | null {
  let best: T | null = null;
  for (const p of pairs) {
    if (!p || p.baseToken?.address !== mint) continue;
    if (p.chainId && p.chainId !== chain) continue;
    if (!isPriced(p)) continue;
    if (!best || (fin(p.liquidity?.usd) ?? 0) > (fin(best.liquidity?.usd) ?? 0)) best = p;
  }
  return best;
}

/** All pools of one coin from the endpoint that lists every pool. Null when the call failed (that proves nothing about the coin). */
export async function fetchAllPairs(mint: string, getJson: GetJson): Promise<DexPairLike[] | null> {
  const j = (await getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)) as { pairs?: unknown } | null;
  if (!j || typeof j !== "object") return null;
  return Array.isArray(j.pairs) ? (j.pairs as DexPairLike[]) : [];
}

/** The best priced pool of a coin whose batch answer had no price: from the all-pools endpoint. Null when it has no priced pool either (it really is gone) or the call failed. */
export async function rescuePair(mint: string, getJson: GetJson, chain = "solana"): Promise<DexPairLike | null> {
  const all = await fetchAllPairs(mint, getJson);
  return all ? bestPricedPair(all, mint, chain) : null;
}

/** How many rescue calls one pass may make: the coins that need one are one in a thousand, and a bug must never turn into hundreds of calls. */
export const MAX_RESCUES = 8;
