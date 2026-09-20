import { describe, it, expect } from "vitest";
import { roundTripCost, targetViability, maxPositionForCost, MAX_SANE_POOL_SHARE } from "./index.js";

describe("round-trip cost on the pools this scanner actually finds", () => {
  // Real card: GINGY, $12.3K pool, the default $500 nominal position.
  it("GINGY-sized pool: a $500 position costs ~19% to round-trip", () => {
    const c = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 12_300 });
    expect(c.buyImpact).toBeCloseTo(0.0813, 3);   // 500 / 6150
    expect(c.sellImpact).toBeCloseTo(0.0813, 3);
    expect(c.fees).toBeCloseTo(0.025, 4);         // 2 × 1.25%
    expect(c.total!).toBeGreaterThan(0.18);
    expect(c.total!).toBeLessThan(0.19);
  });

  it("break-even is higher than the raw cost — you recover out of a shrunken base", () => {
    const c = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 12_300 });
    expect(c.breakevenMove!).toBeGreaterThan(c.total!);
    expect(c.breakevenMove!).toBeCloseTo(0.232, 2);
  });

  it("a deep pool makes the same position cheap", () => {
    const c = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 2_000_000 });
    expect(c.total!).toBeLessThan(0.03); // fees dominate, impact is noise
  });

  it("flags a position that is too large a share of the pool", () => {
    const c = roundTripCost({ tradeSizeUsd: 5_000, liquidityUsd: 40_000 });
    expect(c.poolShare!).toBeGreaterThan(MAX_SANE_POOL_SHARE);
    expect(c.reasons.join(" ")).toMatch(/you are the market/);
  });

  it("unknown depth returns no estimate rather than a fees-only understatement", () => {
    const c = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: null });
    expect(c.total).toBeNull();
    expect(c.breakevenMove).toBeNull();
    expect(c.reasons.join(" ")).toMatch(/not computable/);
  });

  it("zero/garbage size does not produce a number", () => {
    expect(roundTripCost({ tradeSizeUsd: 0, liquidityUsd: 50_000 }).total).toBeNull();
    expect(roundTripCost({ tradeSizeUsd: NaN, liquidityUsd: 50_000 }).total).toBeNull();
  });

  it("a plain AMM with no platform fee is materially cheaper", () => {
    const pump = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 100_000 });
    const plain = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 100_000, platformFeePct: 0 });
    expect(plain.total!).toBeLessThan(pump.total!);
    expect(pump.total! - plain.total!).toBeCloseTo(0.02, 3); // 2 × 1%
  });
});

describe("target viability — the check that was missing from every plan", () => {
  const thin = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 12_300 });

  it("a +20% target on a $12.3K pool is NOT viable", () => {
    const v = targetViability(1.0, 1.2, thin);
    expect(v.viable).toBe(false);
    expect(v.reason).toMatch(/does not clear/);
  });

  it("the same target on a deep pool is viable", () => {
    const deep = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: 2_000_000 });
    expect(targetViability(1.0, 1.2, deep).viable).toBe(true);
  });

  it("net move is the target minus what the round trip eats", () => {
    const v = targetViability(1.0, 1.2, thin);
    expect(v.targetMove).toBeCloseTo(0.2, 6);
    expect(v.netMove!).toBeLessThan(0.02); // +20% target, ~+1% actually left
  });

  it("reports the smallest target worth taking at this size and depth", () => {
    const v = targetViability(1.0, 1.2, thin);
    expect(v.minimumViableTarget!).toBeGreaterThan(0.4); // 2× a 23% break-even
  });

  it("a margin multiple of 1.0 only demands break-even", () => {
    const v = targetViability(1.0, 1.3, thin, 1.0);
    expect(v.viable).toBe(true);
  });

  it("missing prices are not silently treated as viable", () => {
    expect(targetViability(null, 1.2, thin).viable).toBe(false);
    expect(targetViability(1.0, null, thin).viable).toBe(false);
  });

  it("unknown cost never yields a viable verdict", () => {
    const unknown = roundTripCost({ tradeSizeUsd: 500, liquidityUsd: null });
    expect(targetViability(1.0, 2.0, unknown).viable).toBe(false);
  });
});

describe("position sizing — inverting the cost model", () => {
  // The contract is "at or under the budget". A size that breaches the budget the
  // caller specified is worse than no answer, so this is checked exactly.
  it("the returned size actually honours the cost budget", () => {
    for (const liq of [12_300, 40_000, 250_000, 2_000_000]) {
      const max = maxPositionForCost(liq, 0.10)!;
      const c = roundTripCost({ tradeSizeUsd: max, liquidityUsd: liq });
      expect(c.total!, `budget breached at liq=${liq}`).toBeLessThanOrEqual(0.10 + 1e-9);
    }
  });

  it("it is the LARGEST such size — a hair more breaches the budget", () => {
    const max = maxPositionForCost(12_300, 0.10)!;
    const c = roundTripCost({ tradeSizeUsd: max * 1.01, liquidityUsd: 12_300 });
    expect(c.total!).toBeGreaterThan(0.10);
  });

  it("on a $12.3K pool a 10% budget allows roughly a $230 position", () => {
    expect(maxPositionForCost(12_300, 0.10)!).toBeCloseTo(230, 0);
  });

  it("returns 0 when fees alone blow the budget", () => {
    expect(maxPositionForCost(500_000, 0.01)).toBe(0);
  });

  it("no depth reading means no size recommendation", () => {
    expect(maxPositionForCost(null)).toBeNull();
    expect(maxPositionForCost(NaN)).toBeNull();
  });

  it("scales with pool depth", () => {
    expect(maxPositionForCost(1_000_000, 0.10)!).toBeGreaterThan(maxPositionForCost(100_000, 0.10)! * 9.9);
  });
});
