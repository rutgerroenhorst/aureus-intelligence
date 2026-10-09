import "server-only";
import type { FeatureValue, RuleEvaluation } from "@aureus/contracts";
import { computeReadiness, type Readiness } from "@aureus/readiness";
import type { CandidateRow, RuleRow, FeatureRow } from "./queries";

/**
 * Readiness for the detail page — computed LIVE from the currently-displayed
 * rules/features so it always matches the sections on the page and the current
 * label code. Falls back to the persisted summary only when nothing is fetched.
 * (Lists use the persisted summary directly for speed.)
 */
export function readinessFor(c: CandidateRow, rules: RuleRow[], features: FeatureRow[]): Readiness | null {
  if (rules.length === 0 && features.length === 0) return c.readiness ?? null;
  const r = rules.map((x) => ({
    ruleId: x.rule_id, ruleVersion: "", family: x.family, requiredFeatures: [],
    result: x.result, severity: x.severity, evidence: x.evidence, evaluatedAt: x.evaluated_at,
    expiresAt: null, explanation: x.explanation, invalidation: x.invalidation,
  })) as unknown as RuleEvaluation[];
  const f = features.map((x) => ({
    featureId: x.feature_id, version: "", status: x.status, value: x.value != null ? Number(x.value) : null,
    unit: x.unit, calculatedAt: x.calculated_at, observationWindow: "", sourceInputs: [],
    dataQuality: null, missingReason: x.missing_reason, explanation: x.explanation,
  })) as unknown as FeatureValue[];
  return computeReadiness({ state: c.current_state as never, stateReason: "", rules: r, features: f });
}
