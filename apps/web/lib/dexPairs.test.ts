import { describe, it, expect } from "vitest";
import { bestPricedPair, fetchAllPairs, isPriced, rescuePair, type DexPairLike } from "./dexPairs";

const MINT = "HgTGdc29D5bDMrDvsCLnorxz899VyDj7ZN7FPa6vpump";
const pair = (over: Partial<DexPairLike>): DexPairLike => ({ chainId: "solana", dexId: "pumpswap", pairAddress: "P", baseToken: { address: MINT, symbol: "VEIL" }, priceUsd: "0.0025", liquidity: { usd: 142_000 }, ...over });

describe("the best priced pool of a coin", () => {
  it("skips the old bonding-curve pair that has no price and takes the live pool", () => {
    const pairs = [pair({ dexId: "pumpfun", pairAddress: "CURVE", priceUsd: null, liquidity: { usd: null } }), pair({ pairAddress: "LIVE" }), pair({ dexId: "meteora", pairAddress: "SMALL", liquidity: { usd: 12_000 } })];
    expect(bestPricedPair(pairs, MINT)!.pairAddress).toBe("LIVE");
  });
  it("is null when no pool has a price", () => {
    expect(bestPricedPair([pair({ priceUsd: null }), pair({ priceUsd: "0" })], MINT)).toBeNull();
  });
  it("ignores pairs of other coins and of other chains", () => {
    expect(bestPricedPair([pair({ baseToken: { address: "OTHER" } }), pair({ chainId: "base" })], MINT)).toBeNull();
  });
  it("a price of zero or a missing price is not a price", () => {
    expect(isPriced(pair({ priceUsd: "0" }))).toBe(false);
    expect(isPriced(pair({ priceUsd: undefined }))).toBe(false);
    expect(isPriced(pair({ priceUsd: "0.1" }))).toBe(true);
  });
});

describe("asking the endpoint that lists every pool", () => {
  it("returns the pairs of the answer", async () => {
    const urls: string[] = [];
    const all = await fetchAllPairs(MINT, async (u) => {
      urls.push(u);
      return { pairs: [pair({})] };
    });
    expect(all).toHaveLength(1);
    expect(urls[0]).toBe(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`);
  });
  it("a failed call is null (it proves nothing), an empty list is an empty list", async () => {
    expect(await fetchAllPairs(MINT, async () => null)).toBeNull();
    expect(await fetchAllPairs(MINT, async () => ({ pairs: null }))).toEqual([]);
  });
  it("rescues a coin whose batch answer had no price, and says nothing for a coin that is really gone", async () => {
    expect((await rescuePair(MINT, async () => ({ pairs: [pair({ dexId: "pumpfun", priceUsd: null }), pair({ pairAddress: "LIVE" })] })))!.pairAddress).toBe("LIVE");
    expect(await rescuePair(MINT, async () => ({ pairs: [] }))).toBeNull();
    expect(await rescuePair(MINT, async () => null)).toBeNull();
  });
});
