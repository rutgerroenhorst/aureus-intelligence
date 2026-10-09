import type { RuleEvaluation } from "@aureus/contracts";
import { RULES } from "./rules.js";
import { RULE_ENGINE_VERSION, type RuleContext } from "./types.js";

/** Evaluate every rule deterministically. Timestamps derive from ctx.nowMs. */
export function evaluateRules(ctx: RuleContext): RuleEvaluation[] {
  const evaluatedAt = new Date(ctx.nowMs).toISOString();
  const expiresAt = new Date(ctx.nowMs + ctx.config.evalTtlMs).toISOString();
  return RULES.map((def) => {
    const r = def.evaluate(ctx);
    return {
      ruleId: def.ruleId,
      ruleVersion: def.ruleVersion,
      family: def.family,
      requiredFeatures: def.requiredFeatures,
      result: r.result,
      severity: def.severity,
      evidence: r.evidence,
      evaluatedAt,
      expiresAt,
      explanation: r.explanation,
      invalidation: r.invalidation,
    } satisfies RuleEvaluation;
  });
}

const byFamily = (evals: RuleEvaluation[], family: RuleEvaluation["family"]) =>
  evals.filter((e) => e.family === family);
const find = (evals: RuleEvaluation[], id: string) => evals.find((e) => e.ruleId === id);

export type SafetyStatus = "PASSED" | "INCOMPLETE" | "FAILED";
export type QualityStatus = "WEAK" | "DEVELOPING" | "CONFIRMED";
export type EntryStatus =
  | "TOO_EARLY" | "WAIT_FOR_LEVEL" | "READY" | "OVEREXTENDED" | "INVALIDATED" | "EXPIRED" | "NONE";

/** Hard-fail wins: any SAFETY FAIL → FAILED, and no positive rule can offset it. */
export function safetyStatus(evals: RuleEvaluation[]): SafetyStatus {
  const s = byFamily(evals, "SAFETY");
  if (s.some((e) => e.result === "FAIL")) return "FAILED";
  if (s.some((e) => e.result === "INCOMPLETE")) return "INCOMPLETE";
  return "PASSED";
}

export function qualityStatus(evals: RuleEvaluation[]): QualityStatus {
  const core = ["QUAL-01-INDEPENDENT-DEMAND", "QUAL-02-CAPITAL-RETENTION", "QUAL-03-SMART-PARTICIPATION"]
    .map((id) => find(evals, id)?.result);
  const boost = find(evals, "QUAL-04-BOOST-DEPENDENCY")?.result;
  const passes = core.filter((r) => r === "PASS").length;
  if (passes === core.length && boost !== "FAIL") return "CONFIRMED";
  if (passes === 0) return "WEAK";
  return "DEVELOPING";
}

export function entryStatus(evals: RuleEvaluation[]): EntryStatus {
  const e1 = find(evals, "ENTRY-01-STRUCTURE-RECLAIM")?.result;
  const e2 = find(evals, "ENTRY-02-NOT-OVEREXTENDED")?.result;
  const e3 = find(evals, "ENTRY-03-INVALIDATION")?.result;
  const e4 = find(evals, "ENTRY-04-EXECUTION")?.result;
  if (e2 === "FAIL") return "OVEREXTENDED";
  if (e1 === "PASS" && e2 === "PASS" && e3 === "PASS" && e4 === "PASS") return "READY";
  if (e1 === "PASS") return "WAIT_FOR_LEVEL";
  if (e1 === "INCOMPLETE") return "TOO_EARLY";
  return "TOO_EARLY";
}

export interface AggregateStatuses {
  safety: SafetyStatus;
  quality: QualityStatus;
  entry: EntryStatus;
  freshnessOk: boolean;
  openCriticalDataQuality: boolean;
  positionRiskFail: boolean;
}

export function aggregate(evals: RuleEvaluation[]): AggregateStatuses {
  const freshness = find(evals, "DQ-01-FRESHNESS")?.result;
  const conflict = find(evals, "DQ-02-SOURCE-CONFLICT");
  return {
    safety: safetyStatus(evals),
    quality: qualityStatus(evals),
    entry: entryStatus(evals),
    freshnessOk: freshness === "PASS",
    openCriticalDataQuality:
      conflict?.result === "FAIL" && (conflict.severity === "HIGH" || conflict.severity === "CRITICAL"),
    positionRiskFail: byFamily(evals, "POSITION_RISK").some((e) => e.result === "FAIL"),
  };
}

export { RULE_ENGINE_VERSION };
