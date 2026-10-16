import { beforeEach, describe, expect, it } from "vitest";
import { liveGateGraduates, type GraduateRow, type GraduatesReport } from "./graduates";
import { resetLiveCache } from "./liveQuotes";
import { resetHolderCache, type RugFetch } from "./holderFacts";

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

beforeEach(() => {
  resetLiveCache();
  resetHolderCache();
});

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

describe("the Graduations default view judged on who holds the coins (the owner, 2026-10-16: insider networks at 99%, I do not want that coin at all)", () => {
  const rc = (over: Partial<NonNullable<GraduateRow["rc"]>> = {}) => ({ holders: 900, top1: 0.05, top10: 0.2, insPct: 0.01, ins: 2, lp: 100, risks: [], ...over });
  const rugReport = (o: { ins?: number; top1?: number } = {}) => ({
    score_normalised: 10, rugged: false, totalHolders: 900, token: { supply: 1_000_000 }, creatorBalance: 0, risks: [], insiderNetworks: o.ins ? [{ currentHolding: o.ins * 1_000_000 }] : [],
    markets: [{ pubkey: "POOL", liquidityA: "PA", liquidityB: "PB", lp: { lpLockedPct: 100 } }],
    topHolders: [{ address: "PA", owner: "POOL", pct: 30 }, { address: "W1", owner: "O1", pct: (o.top1 ?? 0.05) * 100 }],
  });
  const rug = (answers: Record<string, unknown>) => {
    const asked: string[] = [];
    const fn: RugFetch = async (mint) => {
      asked.push(mint);
      const a = answers[mint];
      return a === "miss" ? { status: "miss" } : { status: "ok", json: a ?? rugReport() };
    };
    return Object.assign(fn, { asked });
  };
  const good = () => dex([pair(1), pair(2), pair(3)]);

  it("a graduation where insider networks hold 99% leaves the default view, with the words on its card", async () => {
    const f = rug({ [M(1)]: rugReport({ ins: 0.99 }) });
    const r = await liveGateGraduates(report([row(1, { flags: ["insider networks hold 99%", "creator bought 6 SOL at launch"] }), row(2)]), good(), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ healthy: false, hiddenWhy: "holders" });
    // the words are on the card once (the row already said them) and the other flags stay
    expect(r.candidates[0]!.flags).toEqual(["insider networks hold 99%", "creator bought 6 SOL at launch"]);
    expect(r.candidates[1]).toMatchObject({ healthy: true, hiddenWhy: null });
  });
  it("one wallet at 32%, and RugCheck's report of today wins over the lab's old snapshot on the row", async () => {
    const f = rug({ [M(1)]: rugReport({ top1: 0.32 }), [M(2)]: rugReport({ ins: 0.02 }) });
    const r = await liveGateGraduates(report([row(1), row(2, { rc: rc({ insPct: 0.99 }) })]), good(), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ healthy: false, hiddenWhy: "holders" });
    expect(r.candidates[0]!.flags[0]).toBe("one wallet holds 32%");
    // the snapshot on the second row said 99% at the first look; today's report says 2%: it stays
    expect(r.candidates[1]).toMatchObject({ healthy: true });
  });
  it("a coin RugCheck has no report for yet is judged on the lab's snapshot on the row, when there is one", async () => {
    const f = rug({ [M(1)]: "miss", [M(2)]: "miss", [M(3)]: "miss" });
    const r = await liveGateGraduates(report([row(1, { rc: rc({ insPct: 0.64 }) }), row(2, { rc: rc() }), row(3)]), good(), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates.map((c) => [c.symbol, c.healthy, c.hiddenWhy])).toEqual([["G1", false, "holders"], ["G2", true, null], ["G3", true, null]]);
    expect(r.candidates[0]!.flags[0]).toBe("insider networks hold 64%");
  });
  it("the market comes first: a rugged coin is 'drained', not 'holders', and is not looked up for its holders; hidden coins are not looked up at all", async () => {
    const f = rug({ [M(1)]: rugReport({ ins: 0.99 }) });
    const r = await liveGateGraduates(report([row(1), row(2, { healthy: false, hiddenWhy: "born", kind: "born" })]), dex([pair(1, { marketCap: 3_800, liquidity: { usd: 700 } }), pair(2)]), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ hiddenWhy: "drained" });
    expect(f.asked).toHaveLength(0);
  });
  it("the lab's snapshot cannot say who the largest wallet is (it counted the coin's own bonding curve): a coin is not hidden on it", async () => {
    const f = rug({ [M(1)]: "miss" });
    const r = await liveGateGraduates(report([row(1, { rc: rc({ top1: 0.4, top10: 0.9 }) })]), good(), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ healthy: true });
  });
  it("a coin that passes once it has been read again loses the card's old 'one wallet holds N%' line, which counted the bonding curve", async () => {
    const f = rug({});
    const r = await liveGateGraduates(report([row(1, { flags: ["one wallet holds 32%", "creator bought 6 SOL at launch"], rc: rc({ top1: 0.32 }) })]), good(), { fetchReport: f, store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ healthy: true });
    expect(r.candidates[0]!.flags).toEqual(["creator bought 6 SOL at launch"]);
  });
  it("a creator who rugged before, and holders that could not be read at all (kept)", async () => {
    const rugged = { ...rugReport(), risks: [{ name: "Creator history of rugged tokens" }] };
    const r = await liveGateGraduates(report([row(1), row(2)]), good(), { fetchReport: rug({ [M(1)]: rugged, [M(2)]: "miss" }), store: null, gapMs: 0 });
    expect(r.candidates[0]).toMatchObject({ healthy: false, hiddenWhy: "holders" });
    expect(r.candidates[0]!.flags[0]).toBe("the creator has rugged before");
    expect(r.candidates[1]).toMatchObject({ healthy: true });
  });
  it("`holders: false` and the off switch leave the list as the market gate made it", async () => {
    const f = rug({ [M(1)]: rugReport({ ins: 0.99 }) });
    const a = await liveGateGraduates(report([row(1, { rc: rc({ insPct: 0.99 }) })]), good(), false);
    expect(a.candidates[0]).toMatchObject({ healthy: true });
    const b = await liveGateGraduates(report([row(1, { rc: rc({ insPct: 0.99 }) })]), good());
    expect(b.candidates[0]).toMatchObject({ healthy: true });
    expect(f.asked).toHaveLength(0);
  });
});
