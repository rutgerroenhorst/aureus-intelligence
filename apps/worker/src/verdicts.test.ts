import { describe, it, expect } from "vitest";
import { reasonFamily, inLearningTail, concentrationBand, HORIZON_MS, VERDICT_HORIZONS, LEARNING_TAIL_MS } from "./verdicts.js";

describe("reason families — rejections must be groupable to be gradeable", () => {
  it("maps the canonical blocker vocabulary onto stable families", () => {
    expect(reasonFamily("critical safety FAIL: SAFE-06")).toBe("safety_fail");
    expect(reasonFamily("pool liquidity removed — chart is stale, pool is dead")).toBe("pool_gone");
    expect(reasonFamily("no new trades across 4 polls")).toBe("frozen_market");
    expect(reasonFamily("stale market data")).toBe("stale_data");
    expect(reasonFamily("confirmed sellability failure")).toBe("sellability");
    expect(reasonFamily("critical liquidity drain (critical)")).toBe("liquidity_drain");
    expect(reasonFamily("no valid entry structure yet")).toBe("no_structure");
    expect(reasonFamily("overextended — pullback required")).toBe("overextended");
    expect(reasonFamily("slippage 7.5% above limit")).toBe("slippage");
  });

  it("distinguishes insider concentration from generic core-safety gaps", () => {
    expect(reasonFamily("insider concentration 62%")).toBe("insider_concentration");
  });

  // Regression: a blocker that NAMES a dataset must be graded by its verdict, not
  // by the dataset's name. Matching the bare word "drain" filed a core-safety gap
  // as an observed liquidity drain — the same regex-on-reason-strings mistake the
  // dataset registry exists to prevent.
  it("a core-safety gap that names liquidity_drain is NOT a drain verdict", () => {
    expect(reasonFamily("core safety incomplete — missing: liquidity_drain")).toBe("core_safety_incomplete");
    expect(reasonFamily("core safety pending — needs 1h of continuous liquidity history to confirm no drain"))
      .toBe("core_safety_incomplete");
  });
  it("an actual observed drain still grades as one", () => {
    expect(reasonFamily("critical liquidity drain (critical)")).toBe("liquidity_drain");
  });

  it("liquidity floors land in their own family, not lumped into safety", () => {
    expect(reasonFamily("pool $12253 below $15000 — exit not feasible")).toBe("too_illiquid");
  });

  // Exhaustiveness guard. An unmapped blocker silently collapses a whole cohort
  // into "other", and the grading for that rejection reason becomes meaningless —
  // which is exactly the failure this whole subsystem exists to prevent.
  it("every blocker fundamentalWatch() can emit maps to a real family", () => {
    const emitted = [
      "hard safety/market failure",
      "stale market data",
      "liquidity below minimum",
      "sellability unconfirmed",
      "sellability CONFIRMED_SELLABILITY_FAIL",
      "holder concentration too high",
      "insider concentration too high",
      "authorities not renounced",
      "core safety not yet complete",
      "awaiting entry structure",
    ];
    for (const blocker of emitted) {
      expect(reasonFamily(blocker), `unmapped blocker: "${blocker}"`).not.toBe("other");
    }
  });

  it("every canonicalBlocker() primary maps to a real family", () => {
    const emitted = [
      "critical safety FAIL: SAFE-06",
      "pool liquidity removed — chart is stale, pool is dead",
      "market frozen — no new trades landing",
      "stale market data",
      "confirmed sellability failure",
      "insufficient liquidity to sell",
      "sell route unconfirmed",
      "critical liquidity drain (critical)",
      "core safety incomplete — missing: sellability",
      "no valid entry structure yet",
      "overextended — pullback required",
      "entry levels not usable: no invalidation level",
      "awaiting confirmation scans (1/2)",
      "slippage 7.5% above limit",
    ];
    for (const blocker of emitted) {
      expect(reasonFamily(blocker), `unmapped blocker: "${blocker}"`).not.toBe("other");
    }
  });

  it("never throws on empty/unknown input — an ungroupable reason is still a cohort", () => {
    expect(reasonFamily(null)).toBe("unknown");
    expect(reasonFamily("")).toBe("unknown");
    expect(reasonFamily("something we have never emitted")).toBe("other");
  });
});

describe("learning tail — the system must keep watching what it rejected", () => {
  const NOW = 1_800_000_000_000;

  it("is active while the window is open", () => {
    expect(inLearningTail(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true);
  });
  it("is over once the window closes", () => {
    expect(inLearningTail(new Date(NOW - 1).toISOString(), NOW)).toBe(false);
  });
  it("a candidate that never got a verdict has no tail", () => {
    expect(inLearningTail(null, NOW)).toBe(false);
  });
  it("garbage timestamps do not silently extend observation", () => {
    expect(inLearningTail("not-a-date", NOW)).toBe(false);
  });
  it("the tail outlives the longest graded horizon, or the last horizon is unmeasurable", () => {
    const longest = Math.max(...VERDICT_HORIZONS.map((h) => HORIZON_MS[h]));
    expect(LEARNING_TAIL_MS).toBeGreaterThanOrEqual(longest);
  });
});

describe("concentration banding — makes an n=10 question answerable later", () => {
  it("bands map to the thresholds that actually matter", () => {
    expect(concentrationBand(0.05)).toBe("under_10");
    expect(concentrationBand(0.13)).toBe("10_20");
    expect(concentrationBand(0.21)).toBe("20_30");   // graduated median
    expect(concentrationBand(0.49)).toBe("30_55");   // passes our gate, industry flags it
    expect(concentrationBand(0.79)).toBe("over_75");
  });
  it("boundaries land in the stricter band", () => {
    expect(concentrationBand(0.30)).toBe("30_55");
    expect(concentrationBand(0.55)).toBe("55_75");
  });
  it("missing data is banded as unknown, never as safe", () => {
    expect(concentrationBand(null)).toBe("unknown");
    expect(concentrationBand(undefined)).toBe("unknown");
    expect(concentrationBand(NaN)).toBe("unknown");
  });
  it("the real graduated cohort spreads across bands as measured", () => {
    // CATE 13%, BULLBALLS 5%, RIKA 5%, TRULL 16%, KEKODYSSEUS 17%, catalyst 26%,
    // MOMENTUM 27%, WSOLP 30%, ANSEM6900 49%, KIRK 79%
    const observed = [0.13, 0.05, 0.05, 0.16, 0.17, 0.26, 0.27, 0.30, 0.49, 0.79];
    const bands = observed.map(concentrationBand);
    expect(bands.filter((b) => b === "30_55").length).toBe(2);  // WSOLP, ANSEM6900
    expect(bands.filter((b) => b === "over_75").length).toBe(1); // KIRK
    expect(bands.filter((b) => b === "unknown").length).toBe(0);
  });
});
