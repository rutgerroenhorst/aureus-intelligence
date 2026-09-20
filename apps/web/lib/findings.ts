import type { RuleRow } from "./queries";

const SEV_RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** The strongest positive finding = a PASS, preferring higher severity / SAFETY+QUALITY. */
export function strongestPositive(rules: RuleRow[]): RuleRow | null {
  const passes = rules.filter((r) => r.result === "PASS");
  if (passes.length === 0) return null;
  return passes.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))[0]!;
}

/** The biggest remaining risk = worst FAIL, else worst INCOMPLETE, by severity. */
export function biggestRisk(rules: RuleRow[]): RuleRow | null {
  const fails = rules.filter((r) => r.result === "FAIL");
  const pool = fails.length ? fails : rules.filter((r) => r.result === "INCOMPLETE");
  if (pool.length === 0) return null;
  return pool.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))[0]!;
}

export function byFamily(rules: RuleRow[], family: string): RuleRow[] {
  const order: Record<string, number> = { FAIL: 0, INCOMPLETE: 1, NOT_APPLICABLE: 2, PASS: 3 };
  return rules
    .filter((r) => r.family === family)
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id) || (order[a.result] ?? 9) - (order[b.result] ?? 9));
}
