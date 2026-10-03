/**
 * Deterministic candidate-readiness model. Derived ONLY from existing rule
 * evaluations, feature values, and the transition matrix. It is NOT a probability
 * and does NOT change any state — it explains the state the reducer already chose.
 */
import type { CandidateState, FeatureValue, RuleEvaluation } from "@aureus/contracts";
import { RULES } from "@aureus/rule-engine";
import { featureLabel, ruleLabel } from "./labels.js";

const RULE_META = new Map(RULES.map((r) => [r.ruleId, { family: r.family, severity: r.severity, requiredFeatures: r.requiredFeatures }]));
const SEV_RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const FAMILY_PRIORITY: Record<string, number> = { SAFETY: 0, QUALITY: 1, ENTRY: 2 };

export interface FamilyCoverage {
  family: string;
  pass: number;
  fail: number;
  incomplete: number;
  notApplicable: number;
  requiredInputsTotal: number;
  requiredInputsAvailable: number;
  missingChecks: string[];
}

export interface Readiness {
  state: CandidateState;
  stateReason: string;
  safety: FamilyCoverage;
  quality: FamilyCoverage;
  entry: FamilyCoverage;
  dataCompleteness: number | null;
  primaryBlocker: string | null;
  criticalBlockers: string[];
  confirmedChecks: string[];
  missingData: string[];
  nextConditions: string[];
  nextEligibleState: CandidateState | null;
  strongestPositive: { ruleId: string; label: string } | null;
  topBlockers: string[];
  blockerRemaining: number;
  blockerRemainingLabel: string;
  incompleteCritical: number;
}

export interface ReadinessInput {
  state: CandidateState;
  stateReason: string;
  rules: RuleEvaluation[];
  features: FeatureValue[];
  dataPresence?: { liquidity?: boolean; volume?: boolean; price?: boolean; pairAge?: boolean };
}

const NEXT_STATE: Partial<Record<CandidateState, CandidateState>> = {
  UNRESOLVED: "RESEARCHING",
  RESEARCHING: "STRUCTURE_WATCH",
  STRUCTURE_WATCH: "QUALITY_CONFIRMED",
  QUALITY_CONFIRMED: "ENTRY_WATCH",
  ENTRY_WATCH: "ENTRY_READY",
  OVEREXTENDED: "ENTRY_WATCH",
};

function coverage(rules: RuleEvaluation[], features: FeatureValue[], family: string): FamilyCoverage {
  const fam = rules.filter((r) => r.family === family);
  const featOk = new Set(features.filter((f) => f.status === "OK").map((f) => f.featureId));
  const required = new Set<string>();
  for (const r of fam) for (const f of RULE_META.get(r.ruleId)?.requiredFeatures ?? []) required.add(f);
  const available = [...required].filter((f) => featOk.has(f));
  return {
    family,
    pass: fam.filter((r) => r.result === "PASS").length,
    fail: fam.filter((r) => r.result === "FAIL").length,
    incomplete: fam.filter((r) => r.result === "INCOMPLETE").length,
    notApplicable: fam.filter((r) => r.result === "NOT_APPLICABLE").length,
    requiredInputsTotal: required.size,
    requiredInputsAvailable: available.length,
    missingChecks: fam.filter((r) => r.result === "INCOMPLETE").map((r) => ruleLabel(r.ruleId)),
  };
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const { rules, features, state, stateReason } = input;
  const safety = coverage(rules, features, "SAFETY");
  const quality = coverage(rules, features, "QUALITY");
  const entry = coverage(rules, features, "ENTRY");

  const dcFeat = features.find((f) => f.featureId === "data_completeness");
  const dataCompleteness = dcFeat?.status === "OK" && dcFeat.value != null ? dcFeat.value : null;

  // Missing required inputs (features) for the safety + quality families, human-labelled.
  const notOk = new Set(features.filter((f) => f.status !== "OK").map((f) => f.featureId));
  const requiredSafetyQuality = new Set<string>();
  for (const r of rules) {
    if (r.family === "SAFETY" || r.family === "QUALITY") for (const f of RULE_META.get(r.ruleId)?.requiredFeatures ?? []) requiredSafetyQuality.add(f);
  }
  const missingData = [...requiredSafetyQuality].filter((f) => notOk.has(f)).map(featureLabel).sort();

  // Hard blockers: SAFETY FAILs first; otherwise the incomplete-safety umbrella.
  const safetyFails = rules.filter((r) => r.family === "SAFETY" && r.result === "FAIL");
  const hasSafetyFail = safetyFails.length > 0;
  const criticalBlockers: string[] = [];
  let primaryBlocker: string | null = null;
  let blockerRemainingLabel = "missing safety checks";

  if (hasSafetyFail) {
    for (const r of safetyFails) criticalBlockers.push(`${ruleLabel(r.ruleId)} — FAILED`);
    primaryBlocker = criticalBlockers[0]!;
    blockerRemainingLabel = "safety failures";
  } else if (safety.incomplete > 0) {
    primaryBlocker = "Critical on-chain safety data unavailable";
    // The concrete blockers are the missing safety inputs.
    for (const f of [...requiredSafetyQuality].filter((x) => notOk.has(x))) criticalBlockers.push(featureLabel(f));
  }

  // Confirmed: passing rules + available data classes.
  const confirmedChecks: string[] = rules.filter((r) => r.result === "PASS").map((r) => `${ruleLabel(r.ruleId)} PASS`);
  const dp = input.dataPresence ?? {};
  if (dp.price) confirmedChecks.push("Price available");
  if (dp.liquidity) confirmedChecks.push("Liquidity available");
  if (dp.volume) confirmedChecks.push("Volume available");
  if (dp.pairAge) confirmedChecks.push("Pair age available");

  // Strongest positive: PASS rule in SAFETY/QUALITY/ENTRY by severity then family;
  // data-quality (freshness) only as a last-resort fallback.
  const passRules = rules.filter((r) => r.result === "PASS");
  const primaryPass = passRules
    .filter((r) => r.family in FAMILY_PRIORITY)
    .sort((a, b) => (SEV_RANK[b.severity]! - SEV_RANK[a.severity]!) || (FAMILY_PRIORITY[a.family]! - FAMILY_PRIORITY[b.family]!))[0];
  const fallbackPass = passRules.find((r) => r.family === "DATA_QUALITY");
  const chosen = primaryPass ?? fallbackPass ?? null;
  const strongestPositive = chosen ? { ruleId: chosen.ruleId, label: ruleLabel(chosen.ruleId) } : null;

  // Next conditions from the transition matrix + current blocker.
  const nextConditions: string[] = [];
  if (!hasSafetyFail && safety.incomplete > 0) {
    nextConditions.push(`Provide critical on-chain safety data: ${missingData.slice(0, 4).join(", ")}`);
  } else if (state === "RESEARCHING" || state === "STRUCTURE_WATCH") {
    if (quality.incomplete > 0 || quality.fail > 0) nextConditions.push(`Confirm quality checks: ${quality.missingChecks.slice(0, 3).join(", ") || "independent demand, capital retention"}`);
  } else if (state === "QUALITY_CONFIRMED" || state === "ENTRY_WATCH") {
    if (entry.incomplete > 0 || entry.fail > 0) nextConditions.push(`Confirm entry structure: ${entry.missingChecks.slice(0, 3).join(", ") || "range, reclaim, invalidation"}`);
  }

  // A FAIL makes progression impossible without a fresh re-evaluation → no next state.
  const nextEligibleState: CandidateState | null = hasSafetyFail ? null : (NEXT_STATE[state] ?? null);

  // Card blockers: up to 2 + remaining count.
  const topBlockers = criticalBlockers.slice(0, 2);
  const blockerRemaining = Math.max(0, criticalBlockers.length - topBlockers.length);

  // For sorting: how many critical/high safety+entry rules are still INCOMPLETE.
  const incompleteCritical = rules.filter(
    (r) => r.result === "INCOMPLETE" && (r.family === "SAFETY" || r.family === "ENTRY") && (r.severity === "CRITICAL" || r.severity === "HIGH"),
  ).length;

  return {
    state, stateReason, safety, quality, entry, dataCompleteness,
    primaryBlocker, criticalBlockers, confirmedChecks, missingData, nextConditions,
    nextEligibleState, strongestPositive, topBlockers, blockerRemaining, blockerRemainingLabel, incompleteCritical,
  };
}
