import { describe, it, expect } from "vitest";
import { holderRedFlags, HOLDER_LIMITS, liveRedFlags, LIMITS, type HolderState, type LiveState } from "./redFlags";

const ok: LiveState = { price: 0.0001, mcap: 80_000, liq: 25_000, h1: 5, h6: 20, h24: 40, buys1h: 120, sells1h: 90, pairAgeMin: 300 };
const codes = (l: LiveState | null, c = {}) => liveRedFlags(l, c).map((f) => f.code);

describe("live red flags: a coin that stands has none", () => {
  it("a healthy coin passes", () => {
    expect(liveRedFlags(ok)).toEqual([]);
  });
  it("numbers that are not known are not flags (the caller keeps a coin it could not read)", () => {
    expect(liveRedFlags({ price: 1, mcap: null, liq: null, h1: null, h6: null, h24: null, buys1h: null, sells1h: null, pairAgeMin: null })).toEqual([]);
  });
});

describe("live red flags: what the owner kept seeing", () => {
  it("a rugged coin that stands at $3-4K with a pool of a few hundred dollars: drained and tiny", () => {
    const c = codes({ ...ok, mcap: 3_400, liq: 600, h1: -3, buys1h: 8, sells1h: 6 });
    expect(c).toContain("drained");
    expect(c).toContain("tiny_cap");
  });
  it("no priced pool at all", () => {
    expect(codes(null)).toEqual(["no_pool"]);
  });
  it("the thresholds are exact: $5,000 of pool and $10,000 of market cap are still fine", () => {
    expect(codes({ ...ok, liq: LIMITS.MIN_LIQ, mcap: LIMITS.MIN_MCAP })).toEqual([]);
    expect(codes({ ...ok, liq: LIMITS.MIN_LIQ - 1 })).toEqual(["drained"]);
    expect(codes({ ...ok, mcap: LIMITS.MIN_MCAP - 1 })).toEqual(["tiny_cap"]);
  });
});

describe("live red flags: a chart that has fallen apart", () => {
  it("down half in the last hour, 70% in six hours, 80% in a day: each alone is enough", () => {
    expect(codes({ ...ok, h1: -50 })).toEqual(["collapsed"]);
    expect(codes({ ...ok, h6: -70 })).toEqual(["collapsed"]);
    expect(codes({ ...ok, h24: -80 })).toEqual(["collapsed"]);
    expect(codes({ ...ok, h1: -49, h6: -69, h24: -79 })).toEqual([]);
  });
  it("a graduation below half of its first price, or below 35% of its high, even when the hour looks calm", () => {
    expect(codes(ok, { sinceFirst: 0.45, peakMultiple: 1.1, rowMcap: 80_000 })).toEqual(["collapsed"]);
    expect(codes(ok, { sinceFirst: 0.7, peakMultiple: 25, rowMcap: 80_000 })).toEqual(["collapsed"]);
    expect(codes(ok, { sinceFirst: 0.8, peakMultiple: 1.5, rowMcap: 80_000 })).toEqual([]);
  });
  it("an old reading is moved to the live price: a row that said 0.9x but whose coin has since lost 60% is collapsed", () => {
    expect(codes({ ...ok, mcap: 32_000 }, { sinceFirst: 0.9, peakMultiple: 1.2, rowMcap: 80_000 })).toEqual(["collapsed"]);
    // and the other way round: a row that said 0.4x but whose coin has since doubled stands
    expect(codes({ ...ok, mcap: 90_000 }, { sinceFirst: 0.4, peakMultiple: 1, rowMcap: 40_000 })).toEqual([]);
  });
  it("a pump that has turned: up 300% in a day and down 40% in the last hour", () => {
    expect(codes({ ...ok, h24: 450, h1: -42 })).toEqual(["blowoff"]);
    expect(codes({ ...ok, h24: 450, h1: -20 })).toEqual([]);
  });
  it("sellers at three to one while the price falls (30 trades or more); a busy coin that is rising is not dumping", () => {
    expect(codes({ ...ok, h1: -25, buys1h: 20, sells1h: 80 })).toEqual(["dumping"]);
    expect(codes({ ...ok, h1: 10, buys1h: 20, sells1h: 80 })).toEqual([]);
    expect(codes({ ...ok, h1: -25, buys1h: 5, sells1h: 20 })).toEqual([]);
  });
});

describe("live red flags: nobody is trading", () => {
  it("fewer than five trades in the last hour on a coin that is not brand new", () => {
    expect(codes({ ...ok, buys1h: 2, sells1h: 1 })).toEqual(["dead_flow"]);
    expect(codes({ ...ok, buys1h: 3, sells1h: 2 })).toEqual([]);
  });
  it("a pool opened ten minutes ago has not had an hour to trade in", () => {
    expect(codes({ ...ok, buys1h: 1, sells1h: 0, pairAgeMin: 10 })).toEqual([]);
  });
  it("the flags come with words the owner can read", () => {
    const f = liveRedFlags({ ...ok, mcap: 3_400, liq: 600, h1: -60, buys1h: 1, sells1h: 0 });
    expect(f.map((x) => x.text).join(" | ")).toMatch(/pool drained: \$600 left.*market cap only \$3\.4K.*down 60% in the last hour.*no trading: 1 trade in the last hour/);
  });
});

const holders: HolderState = { top1: 0.06, top10: 0.25, insPct: 0.02, creatorPct: 0, rugged: false, creatorRugged: false };
const hcodes = (h: Partial<HolderState> | null) => holderRedFlags(h == null ? null : { ...holders, ...h }).map((f) => f.code);

describe("holder red flags: who holds the coin (the owner, 2026-10-16: insider networks at 99%, I do not want that coin at all)", () => {
  it("a coin with a spread-out crowd has none, and holders that could not be read are not a flag", () => {
    expect(holderRedFlags(holders)).toEqual([]);
    expect(holderRedFlags(null)).toEqual([]);
    expect(holderRedFlags(undefined)).toEqual([]);
    expect(holderRedFlags({ top1: null, top10: null, insPct: null, creatorPct: null, rugged: false, creatorRugged: false })).toEqual([]);
  });
  it("insider networks at 99% of the supply: gone, in the card's own words", () => {
    const f = holderRedFlags({ ...holders, insPct: 0.99 });
    expect(f).toEqual([{ code: "insiders", text: "insider networks hold 99%" }]);
  });
  it("the thresholds are exact: 20% of insiders, 20% in one wallet, 60% in the top ten, 20% with the creator are in; just under is out", () => {
    expect(hcodes({ insPct: HOLDER_LIMITS.INSIDERS })).toEqual(["insiders"]);
    expect(hcodes({ insPct: HOLDER_LIMITS.INSIDERS - 0.001 })).toEqual([]);
    expect(hcodes({ top1: HOLDER_LIMITS.ONE_WALLET })).toEqual(["one_wallet"]);
    expect(hcodes({ top1: HOLDER_LIMITS.ONE_WALLET - 0.001 })).toEqual([]);
    expect(hcodes({ top10: HOLDER_LIMITS.TOP10 })).toEqual(["top10"]);
    expect(hcodes({ top10: HOLDER_LIMITS.TOP10 - 0.001 })).toEqual([]);
    expect(hcodes({ creatorPct: HOLDER_LIMITS.CREATOR_HOLDS })).toEqual(["creator_holds"]);
    expect(hcodes({ creatorPct: HOLDER_LIMITS.CREATOR_HOLDS - 0.001 })).toEqual([]);
  });
  it("a coin RugCheck calls rugged, or whose creator has rugged before", () => {
    expect(hcodes({ rugged: true })).toEqual(["rugged"]);
    expect(hcodes({ creatorRugged: true })).toEqual(["creator_rugged"]);
  });
  it("every flag a coin carries is listed, with the figures", () => {
    const f = holderRedFlags({ top1: 0.67, top10: 0.87, insPct: 0.16, creatorPct: 0.31, rugged: false, creatorRugged: true });
    expect(f.map((x) => x.text)).toEqual(["one wallet holds 67%", "the 10 largest wallets hold 87%", "the creator still holds 31%", "the creator has rugged before"]);
  });
});
