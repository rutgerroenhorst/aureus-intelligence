import { describe, it, expect } from "vitest";
import { AGE_BUCKETS, bestThreshold, bucketCaseSql, normalCdf } from "./learning-stats";
import { decideOutcome, type OutcomeInput } from "./learning-engine";

// learning-engine imports the app's route registry through the "@/" alias; the pure functions under test
// do not touch it, so a stub keeps this a unit test.
import { vi } from "vitest";
vi.mock("./internalFetch", () => ({ internalFetch: async () => new Response("{}") }));
vi.mock("@aureus/db", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));

const base: OutcomeInput = { status: "pending", multiple: 1, peakMultiple: 1, ageHours: 1, hasPair: true, liquidityUsd: 20_000, volume24h: 5_000 };

describe("decideOutcome", () => {
  it("does not call a coin a loser just because it has not moved yet", () => {
    expect(decideOutcome({ ...base, ageHours: 0.2 })).toBe("pending");
    expect(decideOutcome({ ...base, multiple: 1.4, peakMultiple: 1.6, ageHours: 5.9 })).toBe("pending");
  });
  it("labels a coin that still has not reached 2x after the horizon a loser", () => {
    expect(decideOutcome({ ...base, multiple: 1.1, ageHours: 6.5 })).toBe("loser");
  });
  it("keeps a winner a winner even after it falls back", () => {
    expect(decideOutcome({ ...base, status: "winner", multiple: 0.2, peakMultiple: 2.4, ageHours: 30 })).toBe("winner");
    expect(decideOutcome({ ...base, multiple: 0.6, peakMultiple: 2.1 })).toBe("winner");
  });
  it("calls a collapse or pulled liquidity a rugpull", () => {
    expect(decideOutcome({ ...base, multiple: 0.3 })).toBe("rugpull");
    expect(decideOutcome({ ...base, multiple: 0.9, liquidityUsd: 12 })).toBe("rugpull");
  });
  it("calls a coin with no pool dead, but only after the first hour (a gap in the data is not death)", () => {
    expect(decideOutcome({ ...base, hasPair: false, multiple: null, liquidityUsd: null, ageHours: 0.4 })).toBe("pending");
    expect(decideOutcome({ ...base, hasPair: false, multiple: null, liquidityUsd: null, ageHours: 2 })).toBe("dead");
  });
  it("calls a coin that nobody trades after the horizon dead", () => {
    expect(decideOutcome({ ...base, ageHours: 7, volume24h: 0 })).toBe("dead");
  });
});

describe("age buckets", () => {
  it("covers every age without gaps", () => {
    for (let i = 1; i < AGE_BUCKETS.length; i++) expect(AGE_BUCKETS[i]!.minH).toBe(AGE_BUCKETS[i - 1]!.maxH);
  });
  it("builds a CASE over minutes", () => {
    expect(bucketCaseSql("a.m")).toContain("WHEN a.m < 120 THEN '<2h'");
    expect(bucketCaseSql("a.m")).toMatch(/ELSE '48h\+' END$/);
  });
});

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("bestThreshold", () => {
  const make = (n: number, f: (i: number) => { value: number; win: boolean }) => Array.from({ length: n }, (_, i) => f(i));

  it("finds the cut-off when winners really do have a higher buy ratio", () => {
    // 60 coins; value rises with i, and the top half wins 70%, the bottom half 15%.
    const samples = make(60, (i) => ({ value: i / 60, win: i >= 30 ? i % 10 < 7 : i % 7 === 0 }));
    const s = bestThreshold(samples, "higher");
    expect(s).not.toBeNull();
    expect(s!.threshold).toBeGreaterThan(0.3);
    expect(s!.passRate).toBeGreaterThan(s!.baseRate + 10);
    expect(s!.confidence).toBeGreaterThanOrEqual(50);
  });

  it("works for a metric where lower is better", () => {
    const samples = make(60, (i) => ({ value: i, win: i < 30 ? i % 10 < 7 : i % 7 === 0 }));
    const s = bestThreshold(samples, "lower");
    expect(s).not.toBeNull();
    expect(s!.threshold).toBeLessThan(35);
  });

  it("suggests nothing when the metric does not separate winners from losers", () => {
    const samples = make(60, (i) => ({ value: (i * 37) % 60, win: i % 3 === 0 }));
    expect(bestThreshold(samples, "higher")).toBeNull();
  });

  it("refuses small samples and one-sided samples", () => {
    expect(bestThreshold(make(8, (i) => ({ value: i, win: i > 4 })), "higher")).toBeNull();
    expect(bestThreshold(make(40, (i) => ({ value: i, win: i > 36 })), "higher")).toBeNull(); // only 3 winners
  });

  it("ignores missing values", () => {
    const samples = [...make(40, (i) => ({ value: i / 40, win: i > 20 })), { value: NaN, win: true }];
    expect(() => bestThreshold(samples, "higher")).not.toThrow();
  });
});
