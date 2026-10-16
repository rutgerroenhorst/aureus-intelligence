import { beforeEach, describe, expect, it } from "vitest";
import { liveGateGraduates, type GraduateRow, type GraduatesReport } from "./graduates";
import { resetLiveCache } from "./liveQuotes";

const M = (n: number) => `Grad${n}`.padEnd(44, "x");
const row = (n: number, over: Partial<GraduateRow> = {}): GraduateRow => ({
  mint: M(n), symbol: `G${n}`, name: null, ageMin: 180, createToMigrateMin: 30, devBuySol: 1, mayhem: false, creatorLaunches: 0, kind: "organic", healthy: true, hiddenWhy: null, empty: false, drained: false,
  mcap: 60_000, liq: 18_000, change1h: 4, change5m: 1, sinceFirst: 1.1, peakMultiple: 1.4, buys1h: 80, sells1h: 60, readingAgeMin: 90, flags: ["creator bought 6 SOL at launch"], rc: null, ...over,
});
const pair = (n: number, over: Record<string, unknown> = {}) => ({
  chainId: "solana", dexId: "pumpswap", baseToken: { address: M(n) }, priceUsd: "0.00006", marketCap: 60_000, liquidity: { usd: 18_000 }, priceChange: { h1: 3, h6: 10, h24: 30 },
  txns: { h1: { buys: 90, sells: 70 } }, pairCreatedAt: Date.now() - 3 * 3_600_000, ...over,
});
const dex = (pairs: unknown[] | null) => (async (url: string) => (url.includes("/tokens/v1/") ? pairs : { pairs: [] })) as never;
const report = (candidates: GraduateRow[]): GraduatesReport => ({ at: new Date().toISOString(), candidates, summary: [], lab: null, source: "laptop" });

beforeEach(() => resetLiveCache());

describe("the Graduations default view judged on what the coins look like now", () => {
  it("keeps a coin that stands and puts today's numbers on its card", async () => {
    const r = await liveGateGraduates(report([row(1)]), dex([pair(1, { marketCap: 66_000, liquidity: { usd: 20_000 }, priceChange: { h1: 7, h6: 12, h24: 33 } })]));
    const c = r.candidates[0]!;
    expect(c.healthy).toBe(true);
    expect(c).toMatchObject({ mcap: 66_000, liq: 20_000, change1h: 7, readingAgeMin: 0 });
    expect(c.sinceFirst).toBeCloseTo(1.1 * (66_000 / 60_000), 6);
  });
  it("a graduation that rugged after its good first hour leaves the default view with the reason on its card", async () => {
    const r = await liveGateGraduates(report([row(1, { mcap: 61_000 })]), dex([pair(1, { marketCap: 3_800, liquidity: { usd: 700 }, priceChange: { h1: -2, h6: -60, h24: -93 } })]));
    const c = r.candidates[0]!;
    expect(c.healthy).toBe(false);
    expect(c.hiddenWhy).toBe("drained");
    expect(c.drained).toBe(true);
    expect(c.flags.slice(0, 3)).toEqual(["pool drained: $700 left", "market cap only $3.8K", expect.stringMatching(/^collapsed: /)]);
    expect(c.flags).toContain("creator bought 6 SOL at launch");
  });
  it("a graduation that fell apart with its pool still standing is 'collapsed' (down 80% since first seen, the pool at $9K)", async () => {
    const r = await liveGateGraduates(report([row(1, { sinceFirst: 0.2, peakMultiple: 1.4, mcap: 12_000 })]), dex([pair(1, { marketCap: 12_000, liquidity: { usd: 9_000 }, priceChange: { h1: -30, h6: -60, h24: -70 } })]));
    expect(r.candidates[0]).toMatchObject({ healthy: false, hiddenWhy: "collapsed" });
    expect(r.candidates[0]!.flags[0]).toMatch(/80% below where it was first seen/);
  });
  it("a coin nobody trades is 'dead', a coin the exchange no longer lists is 'gone'", async () => {
    const r = await liveGateGraduates(report([row(1), row(2), row(3)]), dex([pair(1, { txns: { h1: { buys: 1, sells: 0 } } }), pair(3)]));
    expect(r.candidates.map((c) => [c.symbol, c.healthy, c.hiddenWhy])).toEqual([["G1", false, "dead"], ["G2", false, "gone"], ["G3", true, null]]);
  });
  it("a call that failed changes nothing: the coins stay as they were", async () => {
    const before = report([row(1), row(2)]);
    const r = await liveGateGraduates(before, dex(null));
    expect(r.candidates).toEqual(before.candidates);
  });
  it("coins that were already hidden are not looked up (no calls for them) and keep their reason", async () => {
    let asked = "";
    const spy = (async (url: string) => {
      asked += url;
      return [pair(1)];
    }) as never;
    const r = await liveGateGraduates(report([row(1), row(2, { healthy: false, hiddenWhy: "born", kind: "born" })]), spy);
    expect(asked).toContain(M(1));
    expect(asked).not.toContain(M(2));
    expect(r.candidates[1]).toMatchObject({ healthy: false, hiddenWhy: "born" });
  });
});
