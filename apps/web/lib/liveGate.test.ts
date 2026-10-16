import { beforeEach, describe, expect, it } from "vitest";
import { fetchLive, liveStateOf, resetLiveCache } from "./liveQuotes";
import { flaggedPayload, gateLive } from "./liveGate";

const M = (n: number) => `Mint${n}`.padEnd(44, "x");
const pair = (n: number, over: Record<string, unknown> = {}) => ({
  chainId: "solana",
  dexId: "pumpswap",
  baseToken: { address: M(n), symbol: `C${n}` },
  priceUsd: "0.0001",
  marketCap: 80_000,
  liquidity: { usd: 25_000 },
  priceChange: { h1: 5, h6: 10, h24: 20 },
  txns: { h1: { buys: 100, sells: 80 } },
  pairCreatedAt: Date.now() - 5 * 3_600_000,
  pairAddress: `P${n}`,
  ...over,
});
/** a fake DexScreener: the batch endpoint answers with `pairs`, the all-pools endpoint with `all[mint]` */
const dex = (pairs: unknown[] | null, all: Record<string, unknown[]> = {}) => {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (url.includes("/tokens/v1/")) return pairs;
    const m = url.split("/tokens/")[1]!;
    return { pairs: all[m] ?? [] };
  };
  return Object.assign(fn, { calls });
};

beforeEach(() => resetLiveCache());

describe("live quotes", () => {
  it("reads price, cap, pool, the three changes, the hour's trades and the pool's age", () => {
    const s = liveStateOf(pair(1) as never, Date.now())!;
    expect(s).toMatchObject({ price: 0.0001, mcap: 80_000, liq: 25_000, h1: 5, h6: 10, h24: 20, buys1h: 100, sells1h: 80 });
    expect(Math.round(s.pairAgeMin!)).toBe(300);
  });
  it("a pair without a price is no state", () => {
    expect(liveStateOf(pair(1, { priceUsd: null }) as never)).toBeNull();
  });
  it("asks 30 coins a call, keeps the answer for a minute, and does not ask again", async () => {
    const mints = Array.from({ length: 45 }, (_, i) => M(i));
    const d = dex(mints.map((_, i) => pair(i)));
    const a = await fetchLive(mints, d as never);
    expect(a.size).toBe(45);
    expect(d.calls.filter((u) => u.includes("/tokens/v1/"))).toHaveLength(2);
    await fetchLive(mints, d as never);
    expect(d.calls.filter((u) => u.includes("/tokens/v1/"))).toHaveLength(2);
  });
  it("a coin the exchange lists nothing for is 'no pool' (null), a call that failed leaves its coins unknown (not in the map)", async () => {
    const ok = await fetchLive([M(1), M(2), M(3)], dex([pair(1), pair(2)]) as never);
    expect(ok.get(M(1))).not.toBeNull();
    expect(ok.has(M(3))).toBe(true);
    expect(ok.get(M(3))).toBeNull();
    resetLiveCache();
    const failed = await fetchLive([M(1), M(2)], dex(null) as never);
    expect(failed.size).toBe(0);
  });
  it("an empty answer for a batch of three or more is a hiccup, not a batch of dead coins", async () => {
    const out = await fetchLive([M(1), M(2), M(3), M(4)], dex([]) as never);
    expect(out.size).toBe(0);
  });
  it("a coin whose batch pair has no price is asked for its other pools before it is called gone (the $VEIL case)", async () => {
    const dead = pair(1, { priceUsd: null, dexId: "pumpfun", liquidity: { usd: 0 } });
    const d = dex([dead], { [M(1)]: [dead, pair(1, { dexId: "pumpswap", marketCap: 3_800_000, liquidity: { usd: 180_000 } })] });
    const out = await fetchLive([M(1)], d as never);
    expect(out.get(M(1))?.mcap).toBe(3_800_000);
  });
});

describe("the stale bonding-curve pair (two graduations shown at $43K while their pool stood at $2.3K, 2026-10-16)", () => {
  it("reads the live pool instead of the curve's frozen numbers, and takes the coin out", async () => {
    const curve = pair(1, { dexId: "pumpfun", priceUsd: "0.00004367", marketCap: 43_676, liquidity: null, priceChange: { h1: 1368, h6: 1368, h24: 1368 } });
    const livePool = pair(1, { dexId: "pumpswap", priceUsd: "0.000002372", marketCap: 2_373, liquidity: { usd: 2_360 }, priceChange: { h1: -95, h6: -95, h24: -95 } });
    const d = dex([curve], { [M(1)]: [livePool, curve] });
    const g = await gateLive([{ mint: M(1), symbol: "C1" }], { mintOf: (x) => x.mint, getJson: d as never });
    expect(g.kept).toEqual([]);
    expect(g.flaggedOut[0]!.flags.map((f) => f.code)).toEqual(["drained", "tiny_cap", "collapsed"]);
    expect(d.calls.some((u) => u.includes(`/latest/dex/tokens/${M(1)}`))).toBe(true);
  });
  it("a coin that really is still on the curve keeps its curve pair (the other pools list only that one)", async () => {
    const curve = pair(1, { dexId: "pumpfun", marketCap: 40_000, liquidity: null });
    const g = await gateLive([{ mint: M(1) }], { mintOf: (x) => x.mint, getJson: dex([curve], { [M(1)]: [curve] }) as never });
    expect(g.kept).toHaveLength(1);
  });
});

describe("the live gate", () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ mint: M(n), symbol: `C${n}` }));
  const get = (pairs: unknown[] | null) => dex(pairs) as never;

  it("takes out the rugged, the collapsed and the dead, keeps what stands, and says why", async () => {
    const pairs = [
      pair(1),
      pair(2, { marketCap: 3_400, liquidity: { usd: 500 } }), // rugged: tiny and drained
      pair(3, { priceChange: { h1: -60, h6: -75, h24: -90 } }), // collapsed
      pair(4, { txns: { h1: { buys: 1, sells: 0 } } }), // nobody trades
      pair(5, { priceChange: { h1: -3, h6: 4, h24: 8 } }), // stands
    ];
    const g = await gateLive(items, { mintOf: (x) => x.mint, getJson: get(pairs) });
    expect(g.kept.map((x) => x.symbol)).toEqual(["C1", "C5"]);
    expect(g.flaggedOut.map((f) => [f.item.symbol, f.flags.map((x) => x.code)])).toEqual([
      ["C2", ["drained", "tiny_cap"]],
      ["C3", ["collapsed"]],
      ["C4", ["dead_flow"]],
    ]);
    expect(g.checked).toBe(5);
    expect(g.unknown).toBe(0);
  });
  it("a coin with no pool is taken out; a coin the exchange could not be asked about is kept", async () => {
    const some = await gateLive(items, { mintOf: (x) => x.mint, getJson: get([pair(1), pair(2), pair(3)]) });
    expect(some.flaggedOut.map((f) => f.item.symbol)).toEqual(["C4", "C5"]);
    expect(some.flaggedOut[0]!.flags[0]!.code).toBe("no_pool");
    resetLiveCache();
    const down = await gateLive(items, { mintOf: (x) => x.mint, getJson: get(null) });
    expect(down.kept).toHaveLength(5);
    expect(down.unknown).toBe(5);
    expect(down.flaggedOut).toHaveLength(0);
  });
  it("judges a graduation against its own history, moved to today's price", async () => {
    const rows = [
      { mint: M(1), symbol: "A", sinceFirst: 0.9, peakMultiple: 1.2, mcap: 80_000 },
      { mint: M(2), symbol: "B", sinceFirst: 0.9, peakMultiple: 1.2, mcap: 160_000 },
    ];
    const g = await gateLive(rows, { mintOf: (x) => x.mint, ctxOf: (x) => ({ sinceFirst: x.sinceFirst, peakMultiple: x.peakMultiple, rowMcap: x.mcap }), getJson: get([pair(1, { marketCap: 80_000 }), pair(2, { marketCap: 40_000 })]) });
    expect(g.kept.map((x) => x.symbol)).toEqual(["A"]);
    expect(g.flaggedOut[0]!.item.symbol).toBe("B");
  });
  it("what a route sends next to its list: the coins left out with their reasons", async () => {
    const g = await gateLive(items.slice(0, 2), { mintOf: (x) => x.mint, getJson: get([pair(1), pair(2, { liquidity: { usd: 900 } })]) });
    const p = flaggedPayload(g);
    expect(p.flaggedOut).toEqual([{ mint: M(2), symbol: "C2", redFlags: [{ code: "drained", text: "pool drained: $900 left" }] }]);
    expect(p.flagCheck).toEqual({ checked: 2, unknown: 0 });
  });
  it("an empty list costs nothing", async () => {
    const d = dex([]);
    const g = await gateLive([] as Array<{ mint: string }>, { mintOf: (x) => x.mint, getJson: d as never });
    expect(g).toEqual({ kept: [], flaggedOut: [], checked: 0, unknown: 0 });
    expect(d.calls).toHaveLength(0);
  });
});
