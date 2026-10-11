import { describe, it, expect } from "vitest";
import { fetchFresh, judgeCoin, lastCheck, recentChecks, recentCount, recordCheck, type Fresh } from "./coinCheck";

const MINT = "So11111111111111111111111111111111111111112";
const alive: Fresh = { symbol: "OTTER", pair: "PAIR", priceUsd: 0.0004, liq: 22_000, mcap: 90_000, vol1: 8_000, vol24: 85_000, buys1: 160, sells1: 120, ch1: 4, ch24: 35, ageH: 30 };

const pairsResponse = (pairs: any[], status = 200) => (async () => new Response(JSON.stringify(pairs), { status })) as unknown as typeof fetch;
const dexPair = (o: Record<string, unknown> = {}) => ({
  baseToken: { address: MINT, symbol: "OTTER" },
  pairAddress: "PAIR",
  priceUsd: "0.0004",
  liquidity: { usd: 22000 },
  marketCap: 90000,
  volume: { h1: 8000, h24: 85000 },
  txns: { h1: { buys: 160, sells: 120 } },
  priceChange: { h1: 4, h24: 35 },
  pairCreatedAt: 1_800_000_000_000,
  ...o,
});

describe("looking at the coin again", () => {
  it("takes the pool with the most liquidity of this coin, and reads its numbers", async () => {
    const f = await fetchFresh("solana", MINT, pairsResponse([dexPair({ pairAddress: "SMALL", liquidity: { usd: 900 } }), dexPair({ pairAddress: "BIG" }), dexPair({ baseToken: { address: "OtherOtherOtherOtherOtherOtherOtherOther1", symbol: "X" }, liquidity: { usd: 9e9 } })]), 1_800_000_000_000 + 30 * 3_600_000);
    expect(f).toEqual({ symbol: "OTTER", pair: "BIG", priceUsd: 0.0004, liq: 22000, mcap: 90000, vol1: 8000, vol24: 85000, buys1: 160, sells1: 120, ch1: 4, ch24: 35, ageH: 30 });
  });
  it("says null when no pool is listed and 'error' when it could not ask (or the address is not one)", async () => {
    expect(await fetchFresh("solana", MINT, pairsResponse([]))).toBeNull();
    expect(await fetchFresh("solana", MINT, pairsResponse([], 429))).toBe("error");
    expect(await fetchFresh("solana", MINT, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe("error");
    expect(await fetchFresh("solana", "not-an-address", pairsResponse([dexPair()]))).toBe("error");
    expect(await fetchFresh("nowhere", MINT, pairsResponse([dexPair()]))).toBe("error");
  });
});

describe("what the site says, and that it does not just agree", () => {
  it("agrees when no pool is listed, or the pool is under $1,000, or nothing traded for an hour and the day was empty", () => {
    expect(judgeCoin(null, { tab: "elite" })).toMatchObject({ verdict: "agree", dead: true, flags: ["no pool listed"] });
    expect(judgeCoin({ ...alive, liq: 400 }, { tab: "elite" })).toMatchObject({ verdict: "agree", dead: true });
    expect(judgeCoin({ ...alive, buys1: 0, sells1: 0, vol24: 300 }, { tab: "elite" })).toMatchObject({ verdict: "agree", dead: true });
  });

  it("does NOT agree with a coin that is alive and shows no warning sign, and says so", () => {
    const j = judgeCoin(alive, { tab: "elite" });
    expect(j).toMatchObject({ verdict: "disagree", dead: false, flags: [] });
    expect(j.lines.join(" ")).toContain("I do not agree");
    expect(j.lines[0]).toContain("Pool $22K");
    expect(j.lines[0]).toContain("280 trades in the last hour");
  });

  it("is unsure with a single warning sign and agrees with two", () => {
    const one = judgeCoin({ ...alive, liq: 4_000 }, { tab: "elite" });
    expect(one).toMatchObject({ verdict: "unclear", dead: false });
    expect(one.flags).toEqual(["pool under $5K"]);
    const two = judgeCoin({ ...alive, liq: 4_000, ch24: -82 }, { tab: "elite" });
    expect(two).toMatchObject({ verdict: "agree", dead: false });
    expect(two.flags).toEqual(["pool under $5K", "down 82% in 24 hours"]);
    expect(judgeCoin({ ...alive, buys1: 10, sells1: 60 }, { tab: "elite" }).flags).toContain("selling outweighs buying 3 to 1 in the last hour");
  });

  it("does not guess when it could not look", () => {
    const j = judgeCoin("error", { tab: "elite" });
    expect(j).toMatchObject({ verdict: "unclear", dead: null });
    expect(j.lines[0]).toContain("could not look");
  });

  it("applies the Hot tab's own 'new and small' rule on the fresh numbers, and only on that tab", () => {
    const old = { ...alive, ageH: 24 * 90, ch24: 5, liq: 40_000, vol24: 90_000 };
    const hot = judgeCoin(old, { tab: "hot" });
    expect(hot.flags[0]).toContain("no longer fits the Hot tab (older than 30 days and not exploding)");
    expect(judgeCoin(old, { tab: "elite" }).flags).toEqual([]);
    expect(judgeCoin({ ...alive, liq: 8_000, vol24: 9_000 }, { tab: "hot" }).flags[0]).toContain("pool under $10K, 24 h volume under $10K");
  });
});

describe("keeping the checks", () => {
  const rec: any[] = [];
  const db = (rows: any[] = []) => ({
    query: async (text: string, params: unknown[] = []) => {
      rec.push({ text, params });
      return { rows };
    },
  });

  it("writes one row with the verdict, the warning signs, the lines and what was measured (numbers only)", async () => {
    rec.length = 0;
    const at = await recordCheck(db([{ created_at: "2026-10-11T21:00:00Z" }]), { chain: "solana", mint: MINT, symbol: "OTTER", tab: "elite", judgement: judgeCoin(alive, { tab: "elite" }), fresh: alive });
    expect(at).toBe("2026-10-11T21:00:00.000Z");
    expect(rec[0].text).toContain("INSERT INTO coin_checks");
    expect(rec[0].params.slice(0, 6)).toEqual([MINT, "solana", "OTTER", "elite", "disagree", false]);
    expect(JSON.parse(rec[0].params[8] as string)).toMatchObject({ liq: 22000 });
  });

  it("counts the checks of the last minute, returns the last minute's answer for the same coin and tab, and lists the latest checks with whether the coin came back", async () => {
    expect(await recentCount(db([{ n: 7 }]))).toBe(7);
    const again = await lastCheck(db([{ created_at: "2026-10-11T21:00:00Z", verdict: "agree", dead: true, flags: ["no pool listed"], lines: ["x"], symbol: "OTTER" }]), "solana", MINT, "elite");
    expect(again).toEqual({ at: "2026-10-11T21:00:00.000Z", symbol: "OTTER", judgement: { verdict: "agree", dead: true, flags: ["no pool listed"], lines: ["x"] } });
    expect(await lastCheck(db([]), "solana", MINT, "elite")).toBeNull();
    const notes = await recentChecks(db([{ mint: MINT, tab: "elite", created_at: "2026-10-10T08:00:00Z", verdict: "agree", returned: true }, { mint: "B", tab: "hot", created_at: "2026-10-11T08:00:00Z", verdict: "disagree", returned: false }]));
    expect(notes).toEqual([
      { mint: MINT, tab: "elite", at: "2026-10-10T08:00:00.000Z", verdict: "agree", returned: true },
      { mint: "B", tab: "hot", at: "2026-10-11T08:00:00.000Z", verdict: "disagree", returned: false },
    ]);
  });
});
