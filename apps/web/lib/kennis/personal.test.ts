import { describe, expect, it } from "vitest";
import { journalFacts, labFacts } from "./summary";
import { personalBlock } from "./personal";
import { neededGain, positionSize, priceImpact, runChance, stakeBackFraction, streakChance, streakLoss, takeProfit } from "./calc";
import type { ApiTrade } from "../my-trades";
import type { Facts } from "./types";

const trade = (o: Partial<ApiTrade>): ApiTrade => ({
  id: "1", symbol: "X", mint: "M", chain: "solana", tab: null, source: "wallet", enteredAt: "2026-10-01T00:00:00Z", entryMcap: 10_000, currentMcap: 10_000, multiplier: 1, peakMultiple: 1, lowMultiple: 1,
  peakAt: null, status: "active", sizeUsd: 10, note: null, lastCheckedAt: null, soldUsd: 0, soldFraction: 0, ...o,
});

describe("the journal in numbers", () => {
  const trades = [
    trade({ id: "a", tab: "graduates", source: "radar", sizeUsd: 20, multiplier: 0.3, peakMultiple: 2.5 }),
    trade({ id: "b", tab: null, sizeUsd: 10, multiplier: 0.05 }),
    trade({ id: "c", tab: null, sizeUsd: 30, multiplier: 2, peakMultiple: 2, soldUsd: 30, soldFraction: 0.5 }),
    trade({ id: "d", tab: "pasted", source: "radar", sizeUsd: null, multiplier: 1.2 }),
  ];
  const j = journalFacts(trades);
  it("adds up what went in, what came out and what is still held", () => {
    expect(j.coins).toBe(4);
    expect(j.putUsd).toBe(60);
    expect(j.outUsd).toBe(30);
    // held: a 20 x 0.3 = 6, b 10 x 0.05 = 0.5, c 30 x 2 x 0.5 = 30 (d has no size)
    expect(j.heldUsd).toBeCloseTo(36.5, 5);
  });
  it("counts the coins at half or less, the 2x touches and the given-back gains", () => {
    expect(j.lostHalf).toBe(2);
    expect(j.touched2x).toBe(2);
    expect(j.gaveBack).toBe(1);
  });
  it("splits coins found on a tab from the rest, and counts the sources and the usual size", () => {
    expect(j.viaRadar).toEqual({ n: 2, lostHalf: 1 });
    expect(j.outsideRadar).toEqual({ n: 2, lostHalf: 1 });
    expect(j.sources).toEqual({ wallet: 2, radar: 2, manual: 0 });
    expect(j.medianSizeUsd).toBe(20);
  });
  it("keeps no coin names or addresses in what it returns", () => {
    expect(JSON.stringify(j)).not.toMatch(/"X"|"M"/);
  });
});

describe("the lab's numbers", () => {
  const overview = { held: { basis: 1080, x2: { p: 0.15926 }, x3: { p: 0.09537 }, x5: { p: 0.055556 }, x10: { p: 0.025926 } } };
  it("takes the base rates and the lab's own sentences, from objects or plain strings", () => {
    const l = labFacts(overview, [{ kind: "info", text: "one" }, "two", { kind: "x" }, 3]);
    expect(l).toEqual({ followed: 1080, held: { x2: 0.15926, x3: 0.09537, x5: 0.055556, x10: 0.025926 }, headlines: ["one", "two"] });
  });
  it("says nothing when the report is not there or is not what it should be", () => {
    expect(labFacts(null, null)).toBeNull();
    expect(labFacts({ held: {} }, [])).toBeNull();
  });
});

describe("the sentences under an answer", () => {
  const facts: Facts = {
    journal: journalFacts([
      trade({ id: "a", tab: "graduates", source: "radar", sizeUsd: 20, multiplier: 0.3, peakMultiple: 2.5 }),
      trade({ id: "b", sizeUsd: 10, multiplier: 0.05 }),
      trade({ id: "c", sizeUsd: 30, multiplier: 2, peakMultiple: 2, soldUsd: 30, soldFraction: 0.5 }),
    ]),
    lab: { followed: 1080, held: { x2: 0.159, x3: 0.095, x5: 0.056, x10: 0.026 }, headlines: ["On PumpSwap 75% of coins lost half within a day, against 40% on Raydium.", "Losing half within a day at +0 h, trades, last hour: 39% when under 316, 82% when 4098 and up.", "Something else."] },
  };
  it("words the journal: in, out, held, the multiple of the stake, the coins at half or less", () => {
    const b = personalBlock("journaal", facts)!;
    const text = b.lines.join(" ");
    expect(text).toContain("3 coins");
    expect(text).toContain("$60 erin");
    expect(text).toContain("$30 eruit");
    expect(text).toContain("$37"); // 6 + 0.5 + 30 = 36.5 -> 37
    expect(text).toContain("1,11×"); // (30 + 36.5) / 60
    expect(text).toContain("2 van de 3 coins (67%)");
    expect(text).toContain("hield 16% de 2×");
  });
  it("words the take-profit numbers and flags that a wallet's peak may be unknown", () => {
    const b = personalBlock("winst", facts)!;
    expect(b.lines[0]).toContain("2 (67%) ooit de 2×");
    expect(b.lines[0]).toContain("1 daarvan");
    expect(b.note).toMatch(/ondergrens/);
  });
  it("turns the usual stake into the bankroll a 2% rule would need", () => {
    const b = personalBlock("positie", facts)!;
    expect(b.lines.join(" ")).toContain("$20 per coin");
    expect(b.lines.join(" ")).toContain("$1.000"); // 20 / 0.02
  });
  it("compares the coins found on a tab with the ones bought outside the Radar", () => {
    const b = personalBlock("buiten-radar", facts)!;
    expect(b.lines[0]).toContain("1,");
    expect(b.lines.length).toBe(2);
  });
  it("quotes the lab's sentences for the topics they belong to, and only those", () => {
    expect(personalBlock("pumpswap", facts)!.lines).toEqual([facts.lab!.headlines[0]]);
    expect(personalBlock("druk", facts)!.lines).toEqual([facts.lab!.headlines[1]]);
    expect(personalBlock("lab-vondsten", facts)!.lines.length).toBe(3);
  });
  it("returns nothing, rather than a made-up sentence, when its numbers are missing", () => {
    const none: Facts = { journal: null, lab: null };
    for (const k of ["journaal", "winst", "positie", "buiten-radar", "basisrates", "pumpswap", "druk", "lab-vondsten"] as const) expect(personalBlock(k, none), k).toBeNull();
    expect(personalBlock("journaal", null)).toBeNull();
  });
});

describe("the calculators' sums", () => {
  it("position size is a share of the bankroll", () => {
    expect(positionSize(1000, 2)).toBe(20);
    expect(positionSize(0, 2)).toBe(0);
    expect(positionSize(1000, 0)).toBe(0);
  });
  it("a losing streak costs 1 - (1 - r)^n of the bankroll", () => {
    expect(streakLoss(2, 10)).toBeCloseTo(0.1829, 3);
    expect(streakLoss(10, 10)).toBeCloseTo(0.6513, 3);
    expect(streakLoss(25, 10)).toBeCloseTo(0.9437, 3);
  });
  it("the chance of n losers in a row, and of a run of 10 somewhere in 100 coins", () => {
    expect(streakChance(0.8, 5)).toBeCloseTo(0.3277, 3);
    expect(streakChance(0.8, 10)).toBeCloseTo(0.1074, 3);
    expect(streakChance(0.8, 15)).toBeCloseTo(0.0352, 3);
    expect(runChance(0.8, 10, 100)).toBeGreaterThan(0.8);
    expect(runChance(0.8, 10, 100)).toBeLessThan(0.9);
    expect(runChance(0.8, 10, 5)).toBe(0);
  });
  it("the gain needed to recover a loss: 50% -> 100%, 90% -> 900%", () => {
    expect(neededGain(50)).toBeCloseTo(100, 6);
    expect(neededGain(25)).toBeCloseTo(33.3333, 3);
    expect(neededGain(90)).toBeCloseTo(900, 6);
    expect(neededGain(100)).toBe(Infinity);
    expect(neededGain(0)).toBe(0);
  });
  it("half is the stake back at 2x; a fee makes it a little more; at 3x it is a third", () => {
    expect(stakeBackFraction(2)).toBe(0.5);
    expect(stakeBackFraction(3)).toBeCloseTo(1 / 3, 6);
    expect(stakeBackFraction(2, 5)).toBeCloseTo(0.5263, 3);
    expect(stakeBackFraction(1)).toBe(1);
  });
  it("selling half at 2x brings the stake back; selling a third does not", () => {
    const a = takeProfit(100, 2, 0.5);
    expect(a.proceeds).toBe(100);
    expect(a.stakeBack).toBe(true);
    expect(a.remainingValue).toBe(100);
    expect(a.atRisk).toBe(0);
    const b = takeProfit(100, 2, 1 / 3, 5);
    expect(b.stakeBack).toBe(false);
    expect(b.atRisk).toBeGreaterThan(0);
  });
  it("price impact is about twice the order's share of the pool", () => {
    expect(priceImpact(200, 20_000)).toBeCloseTo(0.02, 6);
    expect(priceImpact(2000, 20_000)).toBeCloseTo(0.2, 6);
    expect(priceImpact(0, 20_000)).toBe(0);
    expect(priceImpact(100_000, 20_000)).toBe(1);
  });
});
