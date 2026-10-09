import { describe, it, expect } from "vitest";
import { computeAction, bucketOf, type ActionInput } from "./actionBoard";

const NOW = 1_800_000_000_000;
function base(over: Partial<ActionInput> = {}): ActionInput {
  return {
    nowMs: NOW,
    currentState: "UNRESOLVED", monitoringTier: "TIER2_ENRICHMENT",
    stopMonitoringReason: null, downgradeReason: null,
    priceUsd: 0.001, liquidityUsd: 40_000, volumeUsd: 120_000, avgVolume30m: 120_000,
    buys: 600, sells: 400, priceAtMs: NOW - 20_000,
    price5mAgo: 0.00098, price15mAgo: 0.00095, price30mAgo: 0.00092,
    liq5mAgo: 39_500, liq15mAgo: 39_000, liq30mAgo: 38_000, liqAtDiscovery: 30_000,
    pairAgeMs: 3 * 3600_000,
    enrichmentStatus: "PARTIAL", enrichmentAgeMs: 60_000, holderTop10: 0.2, mintAuthorityActive: false, freezeAuthorityActive: false,
    missingDatasets: ["deployer", "insider_concentration", "bundle", "sellability"],
    safety: "INCOMPLETE", quality: "INCOMPLETE", entry: "INCOMPLETE",
    entryOverextended: false, safetyLiquidityDrainFail: false,
    ...over,
  };
}

describe("action-board status model", () => {
  it("ACTIONABLE_NOW is impossible without a confirmed entry trigger", () => {
    // Even with everything else perfect, INCOMPLETE entry can never be actionable.
    const r = computeAction(base({ entry: "INCOMPLETE", safety: "PASS" }));
    expect(r.status).not.toBe("ACTIONABLE_NOW");
    expect(r.status).toBe("WAIT_FOR_ENTRY");
  });

  it("entry PASS but safety INCOMPLETE → WATCH_SAFETY_INCOMPLETE (UNKNOWN RISK), not actionable", () => {
    const r = computeAction(base({ entry: "PASS", safety: "INCOMPLETE" }));
    expect(r.status).toBe("WATCH_SAFETY_INCOMPLETE");
    expect(r.safetySummary).toMatch(/UNKNOWN RISK/);
  });

  it("entry PASS + safety PASS + healthy market → ACTIONABLE_NOW", () => {
    const r = computeAction(base({ entry: "PASS", safety: "PASS", missingDatasets: [] }));
    expect(r.status).toBe("ACTIONABLE_NOW");
    expect(bucketOf(r.status)).toBe("A");
  });

  it("overextended price is TOO_EXTENDED and never shown as buyable", () => {
    const r = computeAction(base({ price30mAgo: 0.0005 })); // +100%/30m
    expect(r.status).toBe("TOO_EXTENDED");
    expect(r.chaseStatus).toMatch(/DO NOT CHASE/);
    expect(bucketOf(r.status)).toBe("C");
  });

  it("ENTRY-02 overextended FAIL forces TOO_EXTENDED", () => {
    const r = computeAction(base({ entryOverextended: true }));
    expect(r.status).toBe("TOO_EXTENDED");
  });

  it("liquidity draining → INVALIDATED (setup void)", () => {
    const r = computeAction(base({ liq30mAgo: 60_000, liquidityUsd: 40_000 })); // −33%
    expect(r.status).toBe("INVALIDATED");
    expect(bucketOf(r.status)).toBe("D");
  });

  it("hard failures → REJECTED (safety FAIL, freeze auth, extreme concentration, dead liq, dormant)", () => {
    expect(computeAction(base({ safety: "FAIL" })).status).toBe("REJECTED");
    expect(computeAction(base({ freezeAuthorityActive: true })).status).toBe("REJECTED");
    expect(computeAction(base({ holderTop10: 0.9 })).status).toBe("REJECTED");
    expect(computeAction(base({ liquidityUsd: 1_000 })).status).toBe("REJECTED");
    expect(computeAction(base({ monitoringTier: "TIER0_DORMANT" })).status).toBe("REJECTED");
    expect(computeAction(base({ currentState: "REJECTED" })).status).toBe("REJECTED");
  });

  it("rejected never lands in an active bucket (A/B/C)", () => {
    const r = computeAction(base({ safety: "FAIL" }));
    expect(["A", "B", "C"]).not.toContain(bucketOf(r.status));
  });

  it("a waiting candidate can promote to actionable once entry+safety confirm", () => {
    const wait = computeAction(base({ entry: "INCOMPLETE", safety: "INCOMPLETE" }));
    const actionable = computeAction(base({ entry: "PASS", safety: "PASS", missingDatasets: [] }));
    expect(wait.status).toBe("WAIT_FOR_ENTRY");
    expect(actionable.status).toBe("ACTIONABLE_NOW");
  });

  it("an actionable candidate invalidates when liquidity drains", () => {
    const ok = computeAction(base({ entry: "PASS", safety: "PASS", missingDatasets: [] }));
    const drained = computeAction(base({ entry: "PASS", safety: "PASS", liq30mAgo: 60_000, liquidityUsd: 40_000 }));
    expect(ok.status).toBe("ACTIONABLE_NOW");
    expect(drained.status).toBe("INVALIDATED");
  });

  it("ranking is deterministic (same input → same score)", () => {
    expect(computeAction(base()).rankingScore).toBe(computeAction(base()).rankingScore);
  });

  it("incomplete safety is always surfaced as UNKNOWN RISK with the missing datasets", () => {
    const r = computeAction(base());
    expect(r.risks.some((x) => x.includes("UNKNOWN RISK") && x.includes("deployer"))).toBe(true);
  });

  it("higher-liquidity, growing, low-concentration candidate outranks a thin, draining one", () => {
    const strong = computeAction(base({ liquidityUsd: 80_000, liq30mAgo: 60_000, holderTop10: 0.08, buys: 700, sells: 300 }));
    const weak = computeAction(base({ liquidityUsd: 12_000, liq30mAgo: 13_000, holderTop10: 0.6, buys: 300, sells: 700 }));
    expect(strong.rankingScore).toBeGreaterThan(weak.rankingScore);
  });
});
