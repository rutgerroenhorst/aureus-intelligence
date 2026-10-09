import { describe, it, expect } from "vitest";
import { computeMonitoring, TIER_INTERVAL_MS, type TierInput } from "./tiers.js";

function inp(over: Partial<TierInput> = {}): TierInput {
  return {
    state: "UNRESOLVED", liquidityUsd: 20_000, volumeUsd: 10_000, liquidityTrend: null, volumeTrend: null,
    dataCompleteness: 0.5, enrichmentStatus: "PARTIAL", hasCriticalMarketFail: false, isRug: false,
    freshnessScore: 1, requiredInputsAvailable: 2, requiredInputsTotal: 6, ...over,
  };
}

describe("monitoring tiers", () => {
  it("WATCH is scanned more often than UNRESOLVED", () => {
    const watch = computeMonitoring(inp({ state: "STRUCTURE_WATCH" }));
    const unresolved = computeMonitoring(inp({ state: "UNRESOLVED", liquidityUsd: 100, volumeUsd: 0 }));
    expect(watch.intervalMs).toBeLessThan(unresolved.intervalMs);
  });
  it("ENTRY_WATCH is scanned more often than STRUCTURE_WATCH", () => {
    expect(computeMonitoring(inp({ state: "ENTRY_WATCH" })).intervalMs)
      .toBeLessThan(computeMonitoring(inp({ state: "STRUCTURE_WATCH" })).intervalMs);
  });
  it("REJECTED / EXPIRED / rug / inactive → dormant", () => {
    expect(computeMonitoring(inp({ state: "REJECTED" })).tier).toBe("TIER0_DORMANT");
    expect(computeMonitoring(inp({ state: "EXPIRED" })).tier).toBe("TIER0_DORMANT");
    expect(computeMonitoring(inp({ isRug: true })).tier).toBe("TIER0_DORMANT");
    expect(computeMonitoring(inp({ liquidityUsd: 100 })).tier).toBe("TIER0_DORMANT");
    expect(computeMonitoring(inp({ state: "REJECTED" })).intervalMs).toBe(TIER_INTERVAL_MS.TIER0_DORMANT);
  });
  it("strong market + awaiting Helius → TIER2 (enrichment priority)", () => {
    const d = computeMonitoring(inp({ liquidityUsd: 30_000, volumeUsd: 20_000, enrichmentStatus: "NOT_REQUESTED" }));
    expect(d.tier).toBe("TIER2_ENRICHMENT");
    expect(d.reason).toMatch(/enrichment/i);
  });
  it("weak market → TIER1 low", () => {
    expect(computeMonitoring(inp({ liquidityUsd: 2_000, volumeUsd: 100 })).tier).toBe("TIER1_LOW");
  });
  it("a downgrade (WATCH→UNRESOLVED) lowers the tier and raises the interval", () => {
    const before = computeMonitoring(inp({ state: "QUALITY_CONFIRMED" }));
    const after = computeMonitoring(inp({ state: "UNRESOLVED", liquidityUsd: 2_000, volumeUsd: 100 }));
    expect(after.intervalMs).toBeGreaterThan(before.intervalMs);
  });
  it("priority score orders trade-proximity above low-priority", () => {
    expect(computeMonitoring(inp({ state: "ENTRY_WATCH" })).priorityScore)
      .toBeGreaterThan(computeMonitoring(inp({ liquidityUsd: 2_000, volumeUsd: 100 })).priorityScore);
  });
});
