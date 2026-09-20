import { describe, it, expect } from "vitest";
import { computeEntry, entryProximity, DEFAULT_ENTRY_CONFIG, type EntryInput } from "./index.js";

const NOW = 1_800_000_000_000;
function series(prices: number[], stepMs = 5 * 60_000): EntryInput["prices"] {
  // oldest first; last point is "now"
  const n = prices.length;
  return prices.map((p, i) => ({ observedAtMs: NOW - (n - 1 - i) * stepMs, priceUsd: p }));
}
function input(prices: number[], liquidityUsd: number | null = 40_000): EntryInput {
  return { nowMs: NOW, prices: series(prices), liquidityUsd, tradeSizeUsd: 500 };
}

describe("entry engine — deterministic structure", () => {
  it("too little history → all structural flags undefined (INCOMPLETE, never fabricated)", () => {
    const r = computeEntry(input([1, 1.01, 1.0]));
    expect(r.entryStructurePresent).toBeUndefined();
    expect(r.reclaimConfirmed).toBeUndefined();
    expect(r.localInvalidationPrice).toBeUndefined();
    expect(r.rewardToRisk).toBeUndefined();
    // slippage only needs liquidity, so it can still be present
    expect(r.estSlippagePct).toBeGreaterThan(0);
  });

  it("a one-way pump has no clean range → structure absent", () => {
    const r = computeEntry(input([1, 1.3, 1.7, 2.2, 2.9, 3.6, 4.4, 5.3]));
    expect(r.entryStructurePresent).toBe(false);
    expect(r.reclaimConfirmed).toBeUndefined();
  });

  it("a tight range with no breakout → structure present, reclaim not yet confirmed", () => {
    const r = computeEntry(input([1.0, 1.02, 0.99, 1.01, 1.0, 0.98, 1.01, 1.0, 0.99, 1.0]));
    expect(r.entryStructurePresent).toBe(true);
    expect(r.reclaimConfirmed).toBe(false);
    expect(r.trigger).toMatch(/[Bb]reakout|reclaim/);
  });

  it("breakout that holds → reclaim confirmed with concrete levels", () => {
    // establishes ~1.00 range, then breaks to 1.06 and holds
    const r = computeEntry(input([1.0, 1.01, 0.99, 1.0, 1.01, 1.0, 1.05, 1.06, 1.055, 1.06]));
    expect(r.entryStructurePresent).toBe(true);
    expect(r.reclaimConfirmed).toBe(true);
    expect(r.levels.rangeHigh).toBeGreaterThan(r.levels.rangeLow!);
    expect(r.levels.target).toBeGreaterThan(r.levels.entry!);
  });

  it("breakout that fails back into range → failed reclaim (FAIL, not INCOMPLETE)", () => {
    const r = computeEntry(input([1.0, 1.01, 0.99, 1.0, 1.06, 1.05, 1.0, 0.99, 0.98, 0.97]));
    expect(r.entryStructurePresent).toBe(true);
    expect(r.reclaimConfirmed).toBe(false);
  });

  it("invalidation is a swing low strictly below current price, or null", () => {
    const r = computeEntry(input([1.0, 1.02, 0.99, 1.01, 1.0, 0.98, 1.01, 1.0, 0.99, 1.0]));
    expect(r.localInvalidationPrice).not.toBeNull();
    expect(r.localInvalidationPrice!).toBeLessThan(r.levels.entry!);
  });

  it("slippage falls as liquidity rises (constant-product)", () => {
    const thin = computeEntry({ ...input([1, 1, 1, 1, 1, 1, 1, 1], 5_000) }).estSlippagePct!;
    const deep = computeEntry({ ...input([1, 1, 1, 1, 1, 1, 1, 1], 500_000) }).estSlippagePct!;
    expect(thin).toBeGreaterThan(deep);
  });

  it("reward-to-risk is present only with a valid invalidation below price", () => {
    const r = computeEntry(input([1.0, 1.01, 0.99, 1.0, 1.01, 1.0, 1.05, 1.06, 1.055, 1.06]));
    expect(r.rewardToRisk).toBeTypeOf("number");
    expect(r.rewardToRisk!).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = computeEntry(input([1.0, 1.01, 0.99, 1.0, 1.01, 1.0, 1.05, 1.06, 1.055, 1.06]));
    const b = computeEntry(input([1.0, 1.01, 0.99, 1.0, 1.01, 1.0, 1.05, 1.06, 1.055, 1.06]));
    expect(a).toEqual(b);
    expect(DEFAULT_ENTRY_CONFIG.minPoints).toBe(8);
  });
});

describe("§5 TOO_EXTENDED is structural, not a raw return or band width", () => {
  it("wide volatile band with price mid-range → NO_STRUCTURE, not TOO_EXTENDED", () => {
    // 60% band, price sitting in the middle — volatile, but not extended.
    const p = computeEntry(input([1.0, 1.5, 1.1, 1.45, 1.15, 1.4, 1.2, 1.25, 1.3, 1.25]));
    expect(p.entryStructurePresent).toBe(false);
    const prox = entryProximity(input([1.0, 1.5, 1.1, 1.45, 1.15, 1.4, 1.2, 1.25, 1.3, 1.25]));
    expect(prox.stage).toBe("NO_STRUCTURE");
  });
  it("a small negative move is never TOO_EXTENDED", () => {
    const prox = entryProximity(input([1.0, 1.01, 0.99, 1.0, 1.0, 0.995, 1.0, 0.988, 1.0, 0.988]));
    expect(prox.stage).not.toBe("TOO_EXTENDED");
  });
  it("price far above the range (>1x range-width) IS TOO_EXTENDED", () => {
    // range ~1.0-1.1 established, then price rockets to 1.5 (4x width above high)
    const prox = entryProximity(input([1.0, 1.05, 1.0, 1.1, 1.02, 1.08, 1.2, 1.35, 1.45, 1.6]));
    expect(prox.stage).toBe("TOO_EXTENDED");
  });
});

// ── break-out → pull-back → retest ──────────────────────────────────────────
// The setup this system exists to trade. RETEST_PENDING and RECLAIM_PENDING were
// declared in ProximityStage and returned by nothing, so the entry window itself —
// price coming back to the level it just broke — had no state at all.
describe("the break-out / pull-back / retest sequence", () => {
  const NOW = 1_800_000_000_000;
  const series = (prices: number[]) =>
    prices.map((priceUsd, i) => ({ observedAtMs: NOW - (prices.length - 1 - i) * 60_000, priceUsd }));
  const prox = (prices: number[]) =>
    entryProximity({ nowMs: NOW, prices: series(prices), liquidityUsd: 60_000, tradeSizeUsd: 500 });

  // A base around 1.00 with an established high of 1.02.
  const base = [1.00, 1.02, 0.99, 1.01, 1.00, 1.02, 0.98, 1.01, 1.00, 1.02, 0.99, 1.01];

  it("coiled under the high, never broken → BREAKOUT_PENDING", () => {
    expect(prox([...base, 1.015, 1.018, 1.019]).stage).toBe("BREAKOUT_PENDING");
  });

  it("broke out, back at the level, hold not yet earned → RETEST_PENDING", () => {
    const r = prox([...base, 1.10, 1.14, 0.97, 1.01]);
    expect(r.stage).toBe("RETEST_PENDING");
    expect(r.confirmed.join(" ")).toMatch(/broke above range high/);
    expect(r.missing.join(" ")).toMatch(/hold confirmation|higher low/);
  });

  it("the level held across observations → ENTRY_CONFIRMED", () => {
    const r = prox([...base, 1.10, 1.14, 1.05, 1.04, 1.03]);
    expect(r.stage).toBe("ENTRY_CONFIRMED");
    expect(r.confirmed.join(" ")).toMatch(/above the broken level/);
  });

  it("lost the level after breaking out → RECLAIM_PENDING", () => {
    const r = prox([...base, 1.10, 1.14, 1.05, 0.96]);
    expect(r.stage).toBe("RECLAIM_PENDING");
    expect(r.missing.join(" ")).toMatch(/reclaim/);
  });

  // The chase guard. A confirmed reclaim is only an entry while price is still NEAR
  // the level it broke; TOO_EXTENDED used to live only in the no-structure branch, so
  // a runaway breakout kept the strongest label the system has.
  it("still extended far above the broken level → TOO_EXTENDED, not an entry", () => {
    const r = prox([...base, 1.10, 1.14, 1.15, 1.16]);
    expect(r.stage).toBe("TOO_EXTENDED");
    expect(r.missing.join(" ")).toMatch(/pull-back/);
  });

  it("a single tick back at the level is no longer enough to confirm", () => {
    // Before the hold requirement this confirmed instantly — a hair trigger, and the
    // same chase the system refuses everywhere else.
    expect(prox([...base, 1.10, 1.14, 0.97, 1.01]).stage).not.toBe("ENTRY_CONFIRMED");
  });

  it("every stage in the sequence is reachable — none is dead vocabulary", () => {
    const stages = new Set([
      prox([...base, 1.015, 1.018, 1.019]).stage,
      prox([...base, 1.10, 1.14, 0.97, 1.01]).stage,
      prox([...base, 1.10, 1.14, 1.05, 1.04, 1.03]).stage,
      prox([...base, 1.10, 1.14, 1.05, 0.96]).stage,
      prox([...base, 1.10, 1.14, 1.15, 1.16]).stage,
    ]);
    for (const s of ["BREAKOUT_PENDING", "RETEST_PENDING", "ENTRY_CONFIRMED", "RECLAIM_PENDING", "TOO_EXTENDED"]) {
      expect(stages.has(s as never), `${s} is unreachable`).toBe(true);
    }
  });
});
