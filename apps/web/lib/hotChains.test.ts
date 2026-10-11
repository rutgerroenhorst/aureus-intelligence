import { describe, it, expect } from "vitest";
import { CHAIN_BY_ID, dexUrl, isTokenAddress } from "./chains";
import { memecoinLike, parsePools, rankChains, saveHotReport, statsOf, type ChainStats, type HotPool, type HotReport } from "./hotChains";

const pool = (o: Partial<HotPool>): HotPool => ({ chain: "solana", address: "A", pair: "P", symbol: "XYZ", name: "x", dex: null, ageH: 10, mcap: 100_000, liq: 30_000, vol24: 50_000, vol1: 5_000, ch1: 0, ch6: 0, ch24: 0, buys1: 1, sells1: 1, rank: 1, ...o });

describe("chains", () => {
  it("knows an address of each kind and refuses the others", () => {
    expect(isTokenAddress("solana", "CvxQvqNQVRqq96oeoRnf6H64Memd8Weas9gte2xupump")).toBe(true);
    expect(isTokenAddress("solana", "0x4200000000000000000000000000000000000006")).toBe(false);
    expect(isTokenAddress("base", "0x4200000000000000000000000000000000000006")).toBe(true);
    expect(isTokenAddress("base", "CvxQvqNQVRqq96oeoRnf6H64Memd8Weas9gte2xupump")).toBe(false);
    expect(isTokenAddress("base", "0x42000000000000000000000000000000000006")).toBe(false);
    expect(isTokenAddress("nowhere", "0x4200000000000000000000000000000000000006")).toBe(false);
    expect(isTokenAddress("base", 5)).toBe(false);
  });
  it("links to DexScreener with the chain's own id", () => {
    expect(dexUrl("ethereum", "0xabc")).toBe("https://dexscreener.com/ethereum/0xabc");
    expect(dexUrl("solana", "Pair1")).toBe("https://dexscreener.com/solana/Pair1");
    expect(CHAIN_BY_ID.get("ethereum")!.gt).toBe("eth");
  });
  it("marks the networks FOMO supports", () => {
    expect([...CHAIN_BY_ID.values()].filter((c) => c.fomo).map((c) => c.id).sort()).toEqual(["base", "bsc", "monad", "solana"]);
  });
});

describe("reading GeckoTerminal's trending list", () => {
  const body = {
    data: [
      {
        id: "solana_P1", type: "pool",
        attributes: { address: "P1", name: "SEED / SOL", pool_created_at: "2026-10-10T07:01:00Z", fdv_usd: "156344.4", market_cap_usd: null, reserve_in_usd: "33463.18", volume_usd: { h1: "583.3", h24: "168143.4" }, price_change_percentage: { h1: "-5.085", h6: "-40.46", h24: "216.54" }, transactions: { h1: { buys: 7, sells: 20 } } },
        relationships: { base_token: { data: { id: "solana_Mint1" } }, dex: { data: { id: "pumpswap" } } },
      },
      { id: "solana_P2", type: "pool", attributes: { address: "P2", name: "WETH / USDC" }, relationships: { base_token: { data: { id: "solana_Mint2" } }, dex: { data: { id: "orca" } } } },
    ],
    included: [
      { id: "solana_Mint1", type: "token", attributes: { address: "Mint1", name: "Grow a Farm", symbol: "SEED" } },
      { id: "pumpswap", type: "dex", attributes: { name: "PumpSwap" } },
    ],
  };
  it("takes the coin, the pool, the numbers and the order from the response", () => {
    const [p, q] = parsePools("solana", body, Date.parse("2026-10-10T09:01:00Z"));
    expect(p).toMatchObject({ address: "Mint1", pair: "P1", symbol: "SEED", name: "Grow a Farm", dex: "PumpSwap", mcap: 156344.4, liq: 33463.18, vol24: 168143.4, ch6: -40.46, ch24: 216.54, buys1: 7, sells1: 20, rank: 1 });
    expect(p!.ageH).toBeCloseTo(2, 5);
    expect(q!.rank).toBe(2);
    expect(q!.symbol).toBe("WETH"); // no token details included: falls back to the pool name
  });
  it("does not show a market cap of 0 as a size: it falls back to the fully diluted value, or to unknown", () => {
    const one = (attrs: Record<string, unknown>) => parsePools("solana", { data: [{ id: "solana_P", type: "pool", attributes: { address: "P", name: "A / SOL", ...attrs }, relationships: { base_token: { data: { id: "solana_M" } } } }], included: [] })[0]!;
    expect(one({ market_cap_usd: "0", fdv_usd: "4880000" }).mcap).toBe(4_880_000);
    expect(one({ market_cap_usd: "0", fdv_usd: "0" }).mcap).toBeNull();
    expect(one({ market_cap_usd: null, fdv_usd: null }).mcap).toBeNull();
  });
  it("leaves out blue chips, giants and dust when judging a network", () => {
    expect(memecoinLike(pool({ symbol: "WETH" }))).toBe(false);
    expect(memecoinLike(pool({ mcap: 5e9 }))).toBe(false);
    expect(memecoinLike(pool({ liq: 800 }))).toBe(false);
    expect(memecoinLike(pool({}))).toBe(true);
  });
});

describe("ranking the networks", () => {
  const stats = (o: Partial<ChainStats>): ChainStats => ({ n: 20, up20h6: 0, up50h24: 0, young: 0, medH6: 0, medH24: 0, vol24: 1e6, vol1: 1e5, llama: { vol24: 1e9, change1d: -10, change7d: -30 }, ...o });
  const c = (id: string) => CHAIN_BY_ID.get(id)!;
  it("puts the network where coins are moving and new first, and the quiet one last", () => {
    const r = rankChains([
      { chain: c("base"), stats: stats({ up20h6: 2, young: 1, medH24: 3, llama: { vol24: 8e8, change1d: -40, change7d: -40 } }) },
      { chain: c("solana"), stats: stats({ up20h6: 12, up50h24: 8, young: 11, medH24: 28, llama: { vol24: 2e9, change1d: -25, change7d: -28 } }) },
      { chain: c("monad"), stats: stats({ up20h6: 0, young: 0, medH24: 0, llama: { vol24: 3e7, change1d: -36, change7d: -49 } }) },
    ]);
    expect(r.map((x) => x.id)).toEqual(["solana", "base", "monad"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r[0]!.heat).toBe(100);
    expect(r[2]!.heat).toBe(0);
    expect(r[0]!.why).toContain("8 of 20 trending coins are up 50%+");
    expect(r[0]!.fomo).toBe(true);
  });
  it("ranks a network that could not be read last, and says so", () => {
    const r = rankChains([
      { chain: c("ethereum"), stats: stats({ n: 0, error: "rate limited or down", llama: null }) },
      { chain: c("base"), stats: stats({ up20h6: 1 }) },
    ]);
    expect(r[0]!.id).toBe("base");
    expect(r[1]!.id).toBe("ethereum");
    expect(r[1]!.heat).toBe(0);
    expect(r[1]!.why).toContain("could not be read");
  });
  it("counts what a network's list shows", () => {
    const s = statsOf([pool({ ch6: 30, ch24: 80, ageH: 5 }), pool({ ch6: 5, ch24: 10, ageH: 300 }), pool({ symbol: "USDC", ch6: 99 }), pool({ liq: 100 })], null);
    expect(s).toMatchObject({ n: 2, up20h6: 1, up50h24: 1, young: 1 });
  });
});

describe("saveHotReport", () => {
  const report = (bad: string[]): HotReport => ({
    at: "2026-10-11T00:00:00Z",
    note: "n",
    pools: { solana: [pool({})], base: [] },
    chains: ["solana", "base", "bsc"].map((id, i) => ({ id, label: id, fomo: true, rank: i + 1, heat: 50, why: "", stats: { ...({} as ChainStats), ...(bad.includes(id) ? { error: "rate limited or down" } : {}) } })),
  });
  /** a database that holds at most one stored ranking, and says how old it is */
  const fakeDb = (stored: HotReport | null, ageMin = 2) => {
    const writes: any[][] = [];
    return {
      writes,
      query: async (text: string, params?: unknown[]) => {
        if (text.trimStart().startsWith("SELECT")) return { rows: stored ? [{ chains: stored.chains, age_min: ageMin }] : [] };
        writes.push(params ?? []);
        return { rows: [] };
      },
    };
  };
  it("stores the first ranking", async () => {
    const db = fakeDb(null);
    expect(await saveHotReport(db, report([]))).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]![0]).toBe(1);
  });
  it("replaces a ranking with one that is just as complete", async () => {
    const db = fakeDb(report(["base"]));
    expect(await saveHotReport(db, report(["base"]))).toBe(true);
    expect(await saveHotReport(fakeDb(report(["base"])), report([]))).toBe(true);
  });
  it("keeps a good ranking when the new round could read fewer networks, but only while the good one is recent", async () => {
    const recent = fakeDb(report([]), 10);
    expect(await saveHotReport(recent, report(["base"]))).toBe(false);
    expect(recent.writes).toHaveLength(0);
    const old = fakeDb(report([]), 45);
    expect(await saveHotReport(old, report(["base"]))).toBe(true);
    expect(old.writes).toHaveLength(1);
  });
});
