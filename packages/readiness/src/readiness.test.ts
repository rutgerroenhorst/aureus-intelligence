import { describe, it, expect } from "vitest";
import type { FeatureValue, RuleEvaluation, Severity } from "@aureus/contracts";
import { computeReadiness } from "./index.js";

function rule(ruleId: string, family: RuleEvaluation["family"], result: RuleEvaluation["result"], severity: Severity): RuleEvaluation {
  return { ruleId, ruleVersion: "re-0.1.0", family, requiredFeatures: [], result, severity, evidence: {}, evaluatedAt: "2026-01-01T00:00:00Z", expiresAt: null, explanation: "", invalidation: "" };
}
function feat(featureId: string, status: FeatureValue["status"], value: number | null = null): FeatureValue {
  return { featureId, version: "0.1.0", status, value, unit: "x", calculatedAt: "2026-01-01T00:00:00Z", observationWindow: "instant", sourceInputs: [], dataQuality: null, missingReason: null, explanation: "" };
}

/** Helius-degraded shape: all safety on-chain rules INCOMPLETE, freshness PASS, not-overextended PASS. */
function degradedRules(): RuleEvaluation[] {
  return [
    rule("SAFE-01-CRITICAL-DATA", "SAFETY", "INCOMPLETE", "CRITICAL"),
    rule("SAFE-02-BLACKLIST-FUNDING", "SAFETY", "INCOMPLETE", "CRITICAL"),
    rule("SAFE-03-INSIDER-CONCENTRATION", "SAFETY", "INCOMPLETE", "HIGH"),
    rule("SAFE-05-LIQUIDITY-DRAIN", "SAFETY", "INCOMPLETE", "CRITICAL"),
    rule("QUAL-01-INDEPENDENT-DEMAND", "QUALITY", "INCOMPLETE", "MEDIUM"),
    rule("ENTRY-02-NOT-OVEREXTENDED", "ENTRY", "PASS", "INFO"),
    rule("DQ-01-FRESHNESS", "DATA_QUALITY", "PASS", "HIGH"),
  ];
}
function degradedFeatures(): FeatureValue[] {
  return [
    feat("insider_concentration", "UNAVAILABLE"),
    feat("holder_concentration", "UNAVAILABLE"),
    feat("bundle_contamination", "UNAVAILABLE"),
    feat("deployer_funding_risk", "UNAVAILABLE"),
    feat("data_completeness", "OK", 0.5),
    feat("data_freshness", "OK", 1.0),
  ];
}

describe("readiness — Helius degraded / UNRESOLVED", () => {
  const r = computeReadiness({
    state: "UNRESOLVED", stateReason: "Critical safety data is incomplete.",
    rules: degradedRules(), features: degradedFeatures(),
    dataPresence: { price: true, liquidity: true, volume: true, pairAge: true },
  });

  it("reports the correct critical blocker (not just 'missing')", () => {
    expect(r.primaryBlocker).toBe("Critical on-chain safety data unavailable");
  });
  it("counts safety PASS/FAIL/INCOMPLETE correctly", () => {
    expect(r.safety.incomplete).toBe(4);
    expect(r.safety.fail).toBe(0);
    expect(r.safety.pass).toBe(0);
  });
  it("lists missing data as human-readable labels (no field names)", () => {
    expect(r.missingData).toContain("Insider concentration");
    expect(r.missingData).toContain("Deployer funding analysis");
    expect(r.missingData.join(" ")).not.toMatch(/insider_concentration/);
  });
  it("provides next conditions from the transition matrix", () => {
    expect(r.nextConditions.join(" ")).toMatch(/on-chain safety data/i);
    expect(r.nextEligibleState).toBe("RESEARCHING");
  });
  it("strongest positive uses a real check, not freshness, when one exists", () => {
    expect(r.strongestPositive?.ruleId).toBe("ENTRY-02-NOT-OVEREXTENDED");
  });
  it("falls back to freshness only when no better PASS exists", () => {
    const r2 = computeReadiness({ state: "UNRESOLVED", stateReason: "x", rules: [rule("DQ-01-FRESHNESS", "DATA_QUALITY", "PASS", "HIGH")], features: [] });
    expect(r2.strongestPositive?.ruleId).toBe("DQ-01-FRESHNESS");
  });
  it("cards get at most 2 blockers plus a remaining count", () => {
    expect(r.topBlockers.length).toBeLessThanOrEqual(2);
    expect(r.blockerRemaining).toBe(r.criticalBlockers.length - r.topBlockers.length);
  });
  it("emits no probability language anywhere", () => {
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toMatch(/probability|confidence|% (safe|chance)|win rate/);
  });
  it("data completeness comes straight from the feature", () => {
    expect(r.dataCompleteness).toBe(0.5);
  });
});

describe("readiness — a real FAIL is a blocker, not 'missing'", () => {
  const rules = [
    rule("SAFE-03-INSIDER-CONCENTRATION", "SAFETY", "FAIL", "HIGH"),
    rule("SAFE-01-CRITICAL-DATA", "SAFETY", "PASS", "CRITICAL"),
  ];
  const r = computeReadiness({ state: "REJECTED", stateReason: "A critical safety gate failed.", rules, features: [feat("insider_concentration", "OK", 0.9)] });
  it("shows the FAIL as a blocker labelled FAILED", () => {
    expect(r.primaryBlocker).toMatch(/Insider concentration limit — FAILED/);
    expect(r.safety.fail).toBe(1);
  });
  it("blocks progression (no next eligible state) when a FAIL is present", () => {
    expect(r.nextEligibleState).toBeNull();
  });
});
