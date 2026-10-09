import { describe, it, expect } from "vitest";
import { evaluatePolicies, DEFAULT_ALERT_CONFIG, type AlertContext } from "./index.js";

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return {
    candidateId: "c1", symbol: "TEST", mint: "MINT", pool: "POOL",
    stateFrom: "ENTRY_WATCH", stateTo: "ENTRY_READY",
    safety: "PASSED", quality: "CONFIRMED", entry: "READY",
    freshnessOk: true, openCriticalDataQuality: false, hasCriticalFail: false,
    overextended: false, invalidationAvailable: true,
    liquidityUsd: 80_000, volumeUsd: 100_000, fdvUsd: 600_000, pairAgeMs: 3_600_000, dataAgeMs: 20_000,
    heliusMode: "LIVE",
    positives: ["Liquidity retained"], missing: [], riskReasons: [], previouslyAlerted: true,
    config: DEFAULT_ALERT_CONFIG, ...over,
  };
}
const ids = (ps: ReturnType<typeof evaluatePolicies>) => ps.map((p) => p.policyId);

describe("ENTRY_READY gating", () => {
  it("fires on a clean ENTRY_WATCH → ENTRY_READY under Helius LIVE", () => {
    expect(ids(evaluatePolicies(ctx()))).toContain("ENTRY_READY");
  });

  it("NEVER fires when Helius is DEGRADED", () => {
    expect(ids(evaluatePolicies(ctx({ heliusMode: "DEGRADED" })))).not.toContain("ENTRY_READY");
  });

  it("does not fire without Safety PASS", () => {
    expect(ids(evaluatePolicies(ctx({ safety: "INCOMPLETE" })))).not.toContain("ENTRY_READY");
  });

  it("does not fire on stale data", () => {
    expect(ids(evaluatePolicies(ctx({ freshnessOk: false })))).not.toContain("ENTRY_READY");
  });

  it("does not fire without an invalidation level", () => {
    expect(ids(evaluatePolicies(ctx({ invalidationAvailable: false })))).not.toContain("ENTRY_READY");
  });

  it("does not fire below minimum liquidity", () => {
    expect(ids(evaluatePolicies(ctx({ liquidityUsd: 500 })))).not.toContain("ENTRY_READY");
  });
});

describe("WATCH / HIGH_PRIORITY", () => {
  it("NEW_WATCH fires on entering STRUCTURE_WATCH without safety FAIL", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "RESEARCHING", stateTo: "STRUCTURE_WATCH", safety: "INCOMPLETE" }));
    expect(ids(ps)).toContain("NEW_WATCH");
  });
  it("NEW_WATCH does not fire on a safety failure", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "RESEARCHING", stateTo: "STRUCTURE_WATCH", safety: "FAILED", hasCriticalFail: true }));
    expect(ids(ps)).not.toContain("NEW_WATCH");
  });
  it("HIGH_PRIORITY fires on ENTRY_WATCH within thresholds", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "QUALITY_CONFIRMED", stateTo: "ENTRY_WATCH", entry: "WAIT_FOR_LEVEL" }));
    expect(ids(ps)).toContain("HIGH_PRIORITY");
  });
  it("HIGH_PRIORITY does not fire when overextended", () => {
    const ps = evaluatePolicies(ctx({ stateTo: "ENTRY_WATCH", overextended: true }));
    expect(ids(ps)).not.toContain("HIGH_PRIORITY");
  });
});

describe("RISK", () => {
  it("fires when a previously-alerted candidate is REJECTED with a safety FAIL", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "ENTRY_WATCH", stateTo: "REJECTED", safety: "FAILED", riskReasons: ["SAFE-05 liquidity drain"] }));
    expect(ids(ps)).toContain("RISK");
  });
  it("fires when losing ENTRY_READY", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "ENTRY_READY", stateTo: "ENTRY_WATCH", safety: "PASSED", riskReasons: [] }));
    expect(ids(ps)).toContain("RISK");
  });
  it("does not fire for a never-surfaced candidate", () => {
    const ps = evaluatePolicies(ctx({ stateFrom: "RESEARCHING", stateTo: "EXPIRED", previouslyAlerted: false, safety: "PASSED" }));
    expect(ids(ps)).not.toContain("RISK");
  });
});

describe("determinism", () => {
  it("same context → same evidence hash", () => {
    const a = evaluatePolicies(ctx());
    const b = evaluatePolicies(ctx());
    expect(a[0]!.evidenceHash).toBe(b[0]!.evidenceHash);
  });
  it("different state → different evidence hash", () => {
    const a = evaluatePolicies(ctx({ stateTo: "ENTRY_READY" })).find((p) => p.policyId === "ENTRY_READY")!;
    const b = evaluatePolicies(ctx({ stateFrom: "QUALITY_CONFIRMED", stateTo: "ENTRY_WATCH" })).find((p) => p.policyId === "HIGH_PRIORITY")!;
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });
});
