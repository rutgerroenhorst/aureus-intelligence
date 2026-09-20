import { describe, it, expect } from "vitest";
import type { FeatureValue, RuleEvaluation } from "@aureus/contracts";
import { shouldWriteFeature, shouldWriteRule, featureEvidenceHash, ruleEvidenceHash, type StoredFeature, type StoredRule, FEATURE_CHECKPOINT_MS } from "./changeDetect.js";

const NOW = 1_753_000_000_000;

function fv(over: Partial<FeatureValue> = {}): FeatureValue {
  return {
    featureId: "liquidity_retention_1h", version: "0.1.0", status: "OK", value: 1.0, unit: "ratio",
    calculatedAt: new Date(NOW).toISOString(), observationWindow: "1h", sourceInputs: ["dexscreener"],
    dataQuality: 0.9, missingReason: null, explanation: "x", ...over,
  };
}
function stored(f: FeatureValue, atMs = NOW): StoredFeature {
  return { status: f.status, value: f.value, version: f.version, evidenceHash: featureEvidenceHash(f), calculatedAtMs: atMs };
}

describe("feature change detection", () => {
  it("writes the first value", () => {
    expect(shouldWriteFeature(undefined, fv(), NOW).write).toBe(true);
  });
  it("does NOT write an identical value within the checkpoint", () => {
    const prev = stored(fv({ value: 1.0 }));
    const d = shouldWriteFeature(prev, fv({ value: 1.0 }), NOW + 1000);
    expect(d.write).toBe(false);
  });
  it("does NOT write a sub-epsilon numeric change", () => {
    const prev = stored(fv({ value: 1.0 })); // liquidity_retention_1h rel 0.5%
    const d = shouldWriteFeature(prev, fv({ value: 1.004 }), NOW + 1000); // 0.4% < 0.5%
    expect(d.write).toBe(false);
  });
  it("writes a meaningful numeric change above epsilon", () => {
    const prev = stored(fv({ value: 1.0 }));
    const d = shouldWriteFeature(prev, fv({ value: 1.02 }), NOW + 1000); // 2% > 0.5%
    expect(d.write).toBe(true);
    expect(d.reason).toBe("numeric");
    expect(d.meaningful).toBe(true);
  });
  it("always writes a status change", () => {
    const prev = stored(fv({ status: "MISSING", value: null }));
    const d = shouldWriteFeature(prev, fv({ status: "OK", value: 1.0 }), NOW + 1000);
    expect(d.write).toBe(true);
    expect(d.reason).toBe("status");
  });
  it("always writes UNAVAILABLE → OK", () => {
    const prev = stored(fv({ status: "UNAVAILABLE", value: null }));
    expect(shouldWriteFeature(prev, fv({ status: "OK", value: 0.5 }), NOW + 1000).reason).toBe("status");
  });
  it("always writes an engine-version change", () => {
    const prev = stored(fv({ version: "0.1.0" }));
    expect(shouldWriteFeature(prev, fv({ version: "0.2.0" }), NOW + 1000).reason).toBe("version");
  });
  it("writes at the audit checkpoint but marks it NOT meaningful", () => {
    const prev = stored(fv({ value: 1.0 }));
    const d = shouldWriteFeature(prev, fv({ value: 1.0 }), NOW + FEATURE_CHECKPOINT_MS + 1);
    expect(d.write).toBe(true);
    expect(d.reason).toBe("checkpoint");
    expect(d.meaningful).toBe(false);
  });
  it("never stores NaN / Infinity", () => {
    const prev = stored(fv({ value: 1.0 }));
    expect(shouldWriteFeature(prev, fv({ value: Infinity }), NOW + 1000).write).toBe(false);
    expect(shouldWriteFeature(undefined, fv({ value: NaN }), NOW).write).toBe(false);
  });
  it("writes on metadata/evidence change (e.g. sources)", () => {
    const prev = stored(fv({ value: 1.0, sourceInputs: ["dexscreener"] }));
    const d = shouldWriteFeature(prev, fv({ value: 1.0, sourceInputs: ["dexscreener", "geckoterminal"] }), NOW + 1000);
    expect(d.write).toBe(true);
    expect(d.reason).toBe("evidence");
  });
});

function rv(over: Partial<RuleEvaluation> = {}): RuleEvaluation {
  return {
    ruleId: "SAFE-03-INSIDER-CONCENTRATION", ruleVersion: "re-0.1.0", family: "SAFETY", requiredFeatures: ["insider_concentration"],
    result: "INCOMPLETE", severity: "HIGH", evidence: {}, evaluatedAt: new Date(NOW).toISOString(), expiresAt: null,
    explanation: "unknown", invalidation: "x", ...over,
  };
}
function storedRule(r: RuleEvaluation, atMs = NOW): StoredRule {
  return { result: r.result, severity: r.severity, ruleVersion: r.ruleVersion, evidenceHash: ruleEvidenceHash(r), evaluatedAtMs: atMs };
}

describe("rule change detection", () => {
  it("writes the first evaluation", () => {
    expect(shouldWriteRule(undefined, rv(), NOW).write).toBe(true);
  });
  it("does NOT write an identical evaluation within the checkpoint", () => {
    expect(shouldWriteRule(storedRule(rv()), rv(), NOW + 1000).write).toBe(false);
  });
  it("writes on a result change (INCOMPLETE → FAIL)", () => {
    const d = shouldWriteRule(storedRule(rv({ result: "INCOMPLETE" })), rv({ result: "FAIL" }), NOW + 1000);
    expect(d.write).toBe(true);
    expect(d.reason).toBe("result");
  });
  it("writes on a missing-fields / evidence change", () => {
    const prev = storedRule(rv({ evidence: { missing: ["a"] } }));
    const d = shouldWriteRule(prev, rv({ evidence: { missing: ["a", "b"] } }), NOW + 1000);
    expect(d.write).toBe(true);
    expect(d.reason).toBe("evidence");
  });
  it("writes on a rule-version change", () => {
    expect(shouldWriteRule(storedRule(rv()), rv({ ruleVersion: "re-0.2.0" }), NOW + 1000).reason).toBe("version");
  });
  it("writes at checkpoint, not meaningful", () => {
    const d = shouldWriteRule(storedRule(rv()), rv(), NOW + 61 * 60_000);
    expect(d).toMatchObject({ write: true, reason: "checkpoint", meaningful: false });
  });
});
