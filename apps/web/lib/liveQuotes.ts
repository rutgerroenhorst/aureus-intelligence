/**
 * What coins look like right now: one DexScreener call per 30 coins, the best priced pool of each (with a second look at every pool for the rare coin whose batch answer is a dead pair, lib/dexPairs.ts), kept for a minute.
 * Used by the live red-flag gate (lib/liveGate.ts) so that a list never shows a coin by what it looked like when it qualified.
 *
 * Failing open is the rule: a call that does not answer (a rate limit, a timeout) leaves its coins OUT of the answer, and the gate keeps coins it could not read. A coin that is in the answer with `null` is a coin DexScreener
 * lists no priced pool for (after the second look): the gate treats that as "no pool".
 */
import { bestPricedPair, isCurvePair, MAX_RESCUES, rescuePair, type DexPairLike, type GetJson } from "./dexPairs";
import type { LiveState } from "./redFlags";

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

interface Pair extends DexPairLike {
  priceChange?: { h1?: number; h6?: number; h24?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
}

/** The numbers of one pool as the gate reads them. */
export function liveStateOf(p: Pair, nowMs = Date.now()): LiveState | null {
  const price = num(p.priceUsd);
  if (!(price != null && price > 0)) return null;
  const created = num(p.pairCreatedAt);
  return {
    price,
    mcap: num(p.marketCap) ?? num(p.fdv),
    liq: num(p.liquidity?.usd),
    h1: num(p.priceChange?.h1),
    h6: num(p.priceChange?.h6),
    h24: num(p.priceChange?.h24),
    buys1h: num(p.txns?.h1?.buys),
    sells1h: num(p.txns?.h1?.sells),
    pairAgeMin: created != null ? Math.max(0, (nowMs - created) / 60_000) : null,
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; state: LiveState | null }>();
/** For tests: forget what was kept. */
export const resetLiveCache = () => cache.clear();

const realGetJson: GetJson = async (url) => {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" }, signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

/**
 * mint -> its state now (null = no priced pool). Mints that could not be read are not in the map. Solana only (the tab lists are).
 * `getJson` is for tests.
 */
export async function fetchLive(mints: string[], getJson: GetJson = realGetJson, nowMs = Date.now()): Promise<Map<string, LiveState | null>> {
  const out = new Map<string, LiveState | null>();
  const todo: string[] = [];
  for (const m of new Set(mints.filter(Boolean))) {
    const hit = cache.get(m);
    if (hit && nowMs - hit.at < TTL_MS) out.set(m, hit.state);
    else todo.push(m);
  }
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += 30) batches.push(todo.slice(i, i + 30));
  // a few calls at a time: a list is about 150 coins, five calls
  const answers = await Promise.all(batches.map((b) => getJson(`https://api.dexscreener.com/tokens/v1/solana/${b.join(",")}`).catch(() => null)));
  let rescues = 0;
  for (let i = 0; i < batches.length; i++) {
    const pairs = answers[i];
    if (!Array.isArray(pairs)) continue; // the call failed: these coins stay unknown
    // an answer that lists nothing for a whole batch of three or more coins is a hiccup of the exchange, not a batch of dead coins (the same rule as lib/learning-engine.ts updateOutcomes)
    if (pairs.length === 0 && batches[i]!.length >= 3) continue;
    for (const m of batches[i]!) {
      const mine = (pairs as Pair[]).filter((p) => p?.baseToken?.address === m);
      let best = bestPricedPair(mine, m) as Pair | null;
      // one pair per coin comes back, and for a coin on many venues it can be an old bonding-curve pair, without a price or frozen at the curve's last price: ask for every pool before judging the coin
      if ((!best || isCurvePair(best)) && mine.length && rescues < MAX_RESCUES) {
        rescues++;
        const alt = (await rescuePair(m, getJson).catch(() => null)) as Pair | null;
        if (alt) best = alt;
      }
      const state = best ? liveStateOf(best, nowMs) : null;
      cache.set(m, { at: nowMs, state });
      out.set(m, state);
    }
  }
  if (cache.size > 5_000) for (const [k, v] of cache) if (nowMs - v.at > TTL_MS) cache.delete(k);
  return out;
}
