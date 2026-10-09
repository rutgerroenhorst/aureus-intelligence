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

// ── polling back-off (lib/usePolling.ts) ──────────────────────────────────────────────────────────────────────
import { pollDelay } from "./usePolling";

describe("pollDelay", () => {
  const S = 1000, M = 60 * S;
  it("keeps the normal interval while somebody is using the screen", () => {
    expect(pollDelay(0, 20 * S)).toBe(20 * S);
    expect(pollDelay(2 * M, 20 * S)).toBe(20 * S);
  });
  it("backs off to a minute after 3 minutes without a touch", () => {
    expect(pollDelay(3 * M + 1, 20 * S)).toBe(60 * S);
  });
  it("backs off to five minutes after 15 minutes without a touch (a forgotten iPad)", () => {
    expect(pollDelay(15 * M + 1, 20 * S)).toBe(5 * M);
    expect(pollDelay(10 * 60 * M, 15 * S)).toBe(5 * M);
  });
  it("never polls faster than the caller asked for", () => {
    expect(pollDelay(0, 10 * M)).toBe(10 * M);
    expect(pollDelay(4 * M, 2 * M)).toBe(2 * M);
    expect(pollDelay(20 * M, 8 * M)).toBe(8 * M);
  });
  it("honours custom tiers", () => {
    expect(pollDelay(5 * S, 1 * S, { idleAfterMs: 2 * S, idleIntervalMs: 7 * S, deepIdleAfterMs: 60 * S })).toBe(7 * S);
    expect(pollDelay(61 * S, 1 * S, { idleAfterMs: 2 * S, idleIntervalMs: 7 * S, deepIdleAfterMs: 60 * S, deepIdleIntervalMs: 30 * S })).toBe(30 * S);
  });
});

// ── trade journal (lib/my-trades.ts) ──────────────────────────────────────────────────────────────────────────
import { isValidMint, summarize, toApi, type TradeRow } from "./my-trades";

const row = (over: Partial<TradeRow> = {}): TradeRow => ({
  id: "6c3387be-1b07-4c38-9cb5-022281845fb6", mint: "HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump", symbol: "SI276", tab_name: "elite",
  source: "radar", entered_at: "2026-10-07T07:05:00Z", entry_mcap_usd: "353100", entry_liquidity_usd: "55000", size_usd: "1.90", note: null,
  status: "active", last_mcap_usd: "1334000", peak_mcap_usd: "2294000", peak_at: "2026-10-09T00:30:00Z", low_mcap_usd: "200000",
  last_checked_at: "2026-10-09T22:00:00Z", exit_mcap_usd: null, exited_at: null, ...over,
});

describe("trade journal", () => {
  it("accepts Solana mints and rejects anything else", () => {
    expect(isValidMint("HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump")).toBe(true);
    expect(isValidMint("short")).toBe(false);
    expect(isValidMint("0OIl" + "a".repeat(40))).toBe(false); // base58 has no 0, O, I or l
    expect(isValidMint(undefined)).toBe(false);
  });
  it("turns a row into multiples of the entry", () => {
    const t = toApi(row());
    expect(t.multiplier).toBeCloseTo(1334000 / 353100, 4);
    expect(t.peakMultiple).toBeCloseTo(2294000 / 353100, 4);
    expect(t.lowMultiple).toBeCloseTo(200000 / 353100, 4);
    expect(t.tab).toBe("elite");
  });
  it("never reports a peak below the entry or the current value", () => {
    const t = toApi(row({ peak_mcap_usd: null, last_mcap_usd: "500000", low_mcap_usd: null }));
    expect(t.peakMultiple).toBeCloseTo(500000 / 353100, 4);
    expect(t.lowMultiple).toBe(1);
  });
  it("uses the exit value once a trade is closed", () => {
    const t = toApi(row({ status: "exited", exit_mcap_usd: "706200", last_mcap_usd: "100" }));
    expect(t.multiplier).toBeCloseTo(2, 5);
  });
  it("counts gains that were given back", () => {
    const gone = toApi(row({ symbol: "RUNEPUNK", entry_mcap_usd: "9070", last_mcap_usd: "3920", peak_mcap_usd: "49995" }));
    const kept = toApi(row());
    const s = summarize([gone, kept]);
    expect(s.touched2x).toBe(2);
    expect(s.gaveBack).toBe(1);
    expect(s.active).toBe(2);
  });
});
