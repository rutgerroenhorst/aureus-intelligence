import { describe, it, expect } from "vitest";
import { fetchDecimals, fetchExtras, fetchFresh, fetchJupiterToken, fetchMemory, fetchRug, judgeCoin, lastCheck, looksDead, recentChecks, recentCount, recordCheck, sellTest, type Extras, type Fresh } from "./coinCheck";
import type { RugRow } from "./lab/rugcheck";

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
    expect(JSON.parse(rec[0].params[8] as string)).toMatchObject({ fresh: { liq: 22000 }, checks: expect.any(Array) });
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

// ---------------------------------------------------------------- the other checks

const NOW = 1_800_000_000;
const rug = (o: Partial<RugRow> = {}): RugRow => ({ at: NOW, score: 7, rugged: false, lp: 100, holders: 5000, liq: 50_000, ins: 0, insPct: 0.01, top1: 0.04, top5: 0.1, top10: 0.15, risks: [], mintOff: true, freezeOff: true, ...o });
const sellOk = { state: "ok", usdOut: 4.9 } as const;
const solid: Extras = { sell: sellOk, rug: rug(), memory: { firstAt: NOW - 2 * 86400, firstP: 0.0001, maxP: 0.0005, maxLiq: 25_000 } };
const verdict = (extra: Extras, f: Fresh = alive, tab = "elite") => judgeCoin(f, { tab }, extra, NOW);
const line = (j: ReturnType<typeof judgeCoin>, key: string) => j.checks!.find((c) => c.key === key)!;

const stub = (answers: Record<string, { body: any; status?: number }>) =>
  (async (url: string) => {
    for (const [k, v] of Object.entries(answers)) if (url.includes(k)) return new Response(JSON.stringify(v.body), { status: v.status ?? 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

describe("the test sale", () => {
  it("asks Jupiter what $5 of the coin brings in, counting in whole coins and the coin's own decimals", async () => {
    let seen = "";
    const f = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify({ outAmount: "4912345" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sellTest(MINT, 0.0038, 9, f);
    expect(r).toEqual({ state: "ok", usdOut: 4.912345 });
    // 5 / 0.0038 = 1315 whole coins, 9 decimals
    expect(seen).toContain("amount=1315000000000");
    expect(seen).toContain(`inputMint=${MINT}`);
    expect(seen).toContain("outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
  it("keeps the amount exact for coins that are worth almost nothing (more than 2^53 base units)", async () => {
    let seen = "";
    const f = (async (url: string) => {
      seen = url;
      return new Response("{}", { status: 400 });
    }) as unknown as typeof fetch;
    await sellTest(MINT, 0.000000005, 9, f); // 1e9 coins x 1e9 = 1e18
    expect(seen).toContain("amount=1000000000000000000");
  });
  it("says there is no route when Jupiter says the coin cannot be traded, and 'error' for anything else", async () => {
    expect(await sellTest(MINT, 1, 6, stub({ "swap/v1/quote": { status: 400, body: { error: "not tradable", errorCode: "TOKEN_NOT_TRADABLE" } } }))).toEqual({ state: "no-route", code: "TOKEN_NOT_TRADABLE" });
    expect(await sellTest(MINT, 1, 6, stub({ "swap/v1/quote": { status: 429, body: { error: "slow down" } } }))).toEqual({ state: "error" });
    expect(await sellTest(MINT, null, 6, stub({}))).toEqual({ state: "error" });
    expect(await sellTest(MINT, 1, null, stub({}))).toEqual({ state: "error" });
    expect(await sellTest(MINT, 0, 6, stub({}))).toEqual({ state: "error" });
  });
});

describe("the other sources", () => {
  it("reads Jupiter's record of the coin (the right one of those returned) and RugCheck's report", async () => {
    const j = await fetchJupiterToken(MINT, stub({ "tokens/v2/search": { body: [{ id: "Other", decimals: 6 }, { id: MINT, decimals: 9, usdPrice: 0.5 }] } }));
    expect(j).toMatchObject({ id: MINT, decimals: 9 });
    // Jupiter answered and does not list the coin, or could not be asked: two different things
    expect(await fetchJupiterToken(MINT, stub({ "tokens/v2/search": { body: [] } }))).toBeNull();
    expect(await fetchJupiterToken(MINT, stub({ "tokens/v2/search": { body: [{ id: "Other" }] } }))).toBeNull();
    expect(await fetchJupiterToken(MINT, stub({}))).toBe("error");
    const r = await fetchRug(MINT, stub({ "report": { body: { rugged: true, mintAuthority: "SomeKey", freezeAuthority: null, topHolders: [{ address: "a", pct: 30 }, { address: "b", pct: 5 }], totalHolders: 900, risks: [{ name: "Creator history of rugged tokens" }] } } }), NOW);
    expect(r).toMatchObject({ rugged: true, mintOff: false, freezeOff: true, holders: 900, top1: 0.3 });
    expect(r!.risks).toEqual(["Creator history of rugged tokens"]);
    expect(await fetchRug(MINT, stub({ "report": { status: 400, body: { error: "not indexed" } } }), NOW)).toBeNull();
  });
  it("reads what this system recorded of the coin, and nothing for another network or a coin it never scanned", async () => {
    const db = (answers: any[]) => {
      let i = 0;
      return { query: async () => ({ rows: answers[i++] ?? [] }) };
    };
    expect(await fetchMemory(db([[{ id: "pool1" }], [{ first_at: 1000, max_p: 0.5, first_p: 0.1, max_liq: 30000 }]]), "solana", MINT)).toEqual({ firstAt: 1000, firstP: 0.1, maxP: 0.5, maxLiq: 30000 });
    expect(await fetchMemory(db([[]]), "solana", MINT)).toBeNull();
    expect(await fetchMemory(db([[{ id: "pool1" }], [{ first_at: null }]]), "solana", MINT)).toBeNull();
    expect(await fetchMemory(db([[{ id: "pool1" }]]), "base", MINT)).toBeNull();
    expect(await fetchMemory({ query: async () => { throw new Error("db down"); } }, "solana", MINT)).toBeNull();
  });
  it("reads a coin's decimals from the chain, and says null when no node answers or the answer makes no sense", async () => {
    expect(await fetchDecimals(MINT, (async () => ({ value: { amount: "1000", decimals: 6, uiAmount: 0.001 } })) as any)).toBe(6);
    expect(await fetchDecimals(MINT, (async () => null) as any)).toBeNull();
    expect(await fetchDecimals(MINT, (async () => ({ value: { decimals: 99 } })) as any)).toBeNull();
    expect(await fetchDecimals(MINT, (async () => ({ value: {} })) as any)).toBeNull();
  });
  it("still runs the test sale when Jupiter's record of the coin is missing: decimals from the chain, and says what failed otherwise", async () => {
    let quoted = "";
    const f = (async (url: string) => {
      if (url.includes("swap/v1/quote")) {
        quoted = url;
        return new Response(JSON.stringify({ outAmount: "4800000" }), { status: 200 });
      }
      return new Response("{}", { status: 404 }); // the record and the RugCheck report are missing
    }) as unknown as typeof fetch;
    const noDb = { query: async () => ({ rows: [] }) };
    const e = await fetchExtras("solana", MINT, alive, noDb, f, (async () => ({ value: { decimals: 6 } })) as any);
    expect(e.sell).toEqual({ state: "ok", usdOut: 4.8 });
    expect(quoted).toContain("amount=12500000000"); // $5 at $0.0004 is 12,500 coins, 6 decimals
    expect(e.skipped).toEqual({ rug: "RugCheck has no report for it (yet)", memory: "this system never scanned it" });
    // no decimals anywhere: the sale is not run, and the reason is the decimals, not Jupiter
    const e2 = await fetchExtras("solana", MINT, alive, noDb, f, (async () => null) as any);
    expect(e2.sell).toEqual({ state: "error" });
    expect(e2.skipped?.sell).toBe("the coin's decimals could not be read");
    // decimals known, the quote does not answer: it says so
    const failing = (async (url: string) => new Response("{}", { status: url.includes("swap/v1/quote") ? 400 : 404 })) as unknown as typeof fetch;
    const e3 = await fetchExtras("solana", MINT, alive, noDb, failing, (async () => ({ value: { decimals: 6 } })) as any);
    expect(e3.skipped?.sell).toBe("Jupiter did not answer the quote just now");
  });
  it("asks a second time when a source says to slow down or does not answer, and not when it refuses for good", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("{}", { status: 429 }) : new Response(JSON.stringify([{ id: MINT, decimals: 6 }]), { status: 200 }))) as unknown as typeof fetch;
    expect(await fetchJupiterToken(MINT, flaky)).toMatchObject({ id: MINT, decimals: 6 });
    expect(calls).toBe(2);
    calls = 0;
    const refusing = (async () => (++calls, new Response("{}", { status: 404 }))) as unknown as typeof fetch;
    expect(await fetchJupiterToken(MINT, refusing)).toBe("error");
    expect(calls).toBe(1);
    calls = 0;
    const offline = (async () => (++calls, Promise.reject(new Error("offline")))) as unknown as typeof fetch;
    expect(await fetchJupiterToken(MINT, offline)).toBe("error");
    expect(calls).toBe(2);
  });
  it("asks nothing on other networks, and says why", async () => {
    const e = await fetchExtras("base", "0x" + "a".repeat(40), alive, { query: async () => ({ rows: [] }) });
    expect(e.sell).toBeUndefined();
    expect(e.skipped).toMatchObject({ sell: "only on Solana", rug: "only on Solana" });
  });
  it("decides from DexScreener's numbers alone whether a coin is dead enough to skip the rest", () => {
    expect(looksDead({ ...alive, liq: 500 })).toBe(true);
    expect(looksDead({ ...alive, buys1: 0, sells1: 0, vol24: 10 })).toBe(true);
    expect(looksDead(alive)).toBe(false);
  });
});

describe("what the extra checks change", () => {
  it("every check that ran is on the card with its result, and a coin that passes them all is not agreed with", () => {
    const j = verdict(solid);
    expect(j.verdict).toBe("disagree");
    expect(j.checks!.map((c) => c.key)).toEqual(expect.arrayContaining(["pool", "trades", "volume", "move", "pressure", "sell", "authority", "holders", "memory"]));
    expect(j.checks!.every((c) => c.state === "ok")).toBe(true);
    expect(j.lines[1]).toContain("passes the");
    expect(line(j, "sell").text).toBe("A $5 sale brings in $4.90 now");
    expect(line(j, "memory").text).toContain("first seen 2 days ago");
  });

  it("agrees at once with a serious problem: no way to sell, a sale that loses most of its money, creator can still mint or freeze, rugged", () => {
    expect(verdict({ ...solid, sell: { state: "no-route", code: "TOKEN_NOT_TRADABLE" } })).toMatchObject({ verdict: "agree", dead: false });
    const noRoute = verdict({ ...solid, sell: { state: "no-route", code: "TOKEN_NOT_TRADABLE" } });
    expect(noRoute.lines[1]).toContain("You are right: it cannot be sold (no route)");
    expect(line(noRoute, "sell").state).toBe("bad");
    expect(line(verdict({ ...solid, sell: { state: "ok", usdOut: 1.2 } }), "sell")).toMatchObject({ state: "bad", flag: "a $5 sale would lose 76%" });
    expect(verdict({ ...solid, rug: rug({ mintOff: false }) }).flags).toContain("the creator can still mint more coins");
    expect(verdict({ ...solid, rug: rug({ freezeOff: false }) }).verdict).toBe("agree");
    expect(verdict({ ...solid, rug: rug({ rugged: true }) }).flags).toContain("RugCheck marks it as rugged");
  });

  it("a sale that loses a part of its money is one warning sign, not a verdict", () => {
    const j = verdict({ ...solid, sell: { state: "ok", usdOut: 3.9 } });
    expect(line(j, "sell")).toMatchObject({ state: "warn", flag: "a $5 sale would lose 22%" });
    expect(j.verdict).toBe("unclear");
  });

  it("concentration: one big wallet is a warning sign, linked insider wallets too, both together a point", () => {
    expect(verdict({ ...solid, rug: rug({ top1: 0.4 }) }).verdict).toBe("unclear");
    expect(verdict({ ...solid, rug: rug({ top1: 0.4 }) }).flags).toEqual(["one wallet holds 40%"]);
    const both = verdict({ ...solid, rug: rug({ top1: 0.4, insPct: 0.25 }) });
    expect(both.verdict).toBe("agree");
    expect(both.lines[1]).toContain("You have a point");
    expect(both.flags).toEqual(["one wallet holds 40%", "insider networks hold 25%"]);
    // insiders at 13% were common among the Radar's coins: not a warning by itself
    expect(verdict({ ...solid, rug: rug({ insPct: 0.13 }) }).verdict).toBe("disagree");
  });

  it("falls back to Jupiter's audit when RugCheck has no report: authorities and the 10 largest holders", () => {
    const jup = { id: MINT, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: false, topHoldersPercentage: 78, devBalancePercentage: 24, devMints: 2219 } };
    const j = verdict({ jup, sell: sellOk, skipped: { rug: "RugCheck has no report for it (yet)" } });
    expect(j.flags).toEqual(["the creator can freeze wallets", "top 10 hold 78%", "the creator still holds 24%"]);
    expect(j.verdict).toBe("agree");
    // the number of tokens the creator's wallet minted is shown, but counts as neither a warning nor a passed check
    expect(line(j, "creator-mints")).toMatchObject({ state: "note" });
    expect(line(j, "creator-mints").text).toContain("2219 tokens");
    expect(j.flags.join(" ")).not.toContain("serial");
  });

  it("this system's own record: far below the highest price it saw is a warning, nearly all gone is serious; liquidity against its peak too", () => {
    const m = (maxP: number, maxLiq = 25_000) => ({ ...solid, memory: { firstAt: NOW - 3 * 86400, firstP: 0.0001, maxP, maxLiq } });
    expect(line(verdict(m(0.004)), "memory")).toMatchObject({ state: "warn" }); // price 0.0004 is 90% below 0.004
    expect(verdict(m(0.004)).flags[0]).toBe("down 90% from the highest price recorded");
    expect(line(verdict(m(0.02)), "memory")).toMatchObject({ state: "bad" }); // 98% below
    expect(verdict(m(0.02)).verdict).toBe("agree");
    expect(verdict(m(0.0005, 200_000)).flags).toContain("liquidity far below its peak");
  });

  it("says what could not be checked instead of passing silently", () => {
    const j = verdict({ sell: { state: "error" }, skipped: { sell: "Jupiter could not price a sale just now", rug: "RugCheck has no report for it (yet)", memory: "this system never scanned it" } });
    expect(j.verdict).toBe("disagree");
    expect(j.checks!.filter((c) => c.state === "skip").map((c) => c.label)).toEqual(["the test sale", "the mint and freeze authority", "the holders", "this system's own record"]);
    expect(j.lines[1]).toContain("not checked: the test sale, the mint and freeze authority, the holders, this system's own record");
    expect(line(j, "sell").text).toContain("Jupiter could not price a sale just now");
  });

  it("a dead coin is judged on the market numbers alone: no extra lines", () => {
    const j = verdict(solid, { ...alive, liq: 300 });
    expect(j).toMatchObject({ verdict: "agree", dead: true });
    expect(j.checks!.map((c) => c.key)).toEqual(["pool", "trades"]);
  });

  it("the Hot rule still comes last, and the old five checks keep their wording in the record", () => {
    const j = verdict(solid, { ...alive, ageH: 24 * 90, ch24: 5, liq: 40_000, vol24: 90_000 }, "hot");
    expect(j.checks!.at(-1)).toMatchObject({ key: "hot-rule", state: "warn" });
    expect(j.flags.at(-1)).toContain("no longer fits the Hot tab");
    expect(verdict({}, { ...alive, liq: 4_000, ch24: -82 }).flags).toEqual(["pool under $5K", "down 82% in 24 hours"]);
  });
});

describe("a launch tool's wallet is not a warning sign", () => {
  it("a creator wallet that minted thousands of tokens is noted but does not count, alone or with one other mild sign", () => {
    const jup = { id: MINT, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 11_579 } };
    const alone = verdict({ ...solid, jup });
    expect(alone.verdict).toBe("disagree");
    expect(line(alone, "creator-mints").state).toBe("note");
    expect(alone.lines[1]).toContain("passes the");
    const withOne = verdict({ ...solid, jup, rug: rug({ top1: 0.4 }) });
    expect(withOne.verdict).toBe("unclear"); // one real warning sign, the note adds nothing
    expect(withOne.flags).toEqual(["one wallet holds 40%"]);
  });
});
