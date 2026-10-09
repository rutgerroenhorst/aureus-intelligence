import { describe, it, expect } from "vitest";
import { evaluateGate } from "./shadow.js";
import type { RuleEvaluation } from "@aureus/contracts";
import type { EntryResult } from "@aureus/entry-engine";

const entry = { entryStructurePresent: true, reclaimConfirmed: true, localInvalidationPrice: 0.9, estSlippagePct: 2, rewardToRisk: 3, rationale: "", trigger: "", levels: { rangeLow: 0.9, rangeHigh: 1.1, rangePosition: 0.5, entry: 1, invalidation: 0.9, target: 1.3, pointsInWindow: 20 } } as EntryResult;
function rule(ruleId: string, result: string, family = "ENTRY"): RuleEvaluation {
  return { ruleId, ruleVersion: "v", family, result, severity: "INFO", evidence: {}, explanation: "", invalidation: "", expiresAt: null } as unknown as RuleEvaluation;
}
const allPass: RuleEvaluation[] = [
  rule("SAFE-02-BLACKLIST-FUNDING", "PASS", "SAFETY"), rule("SAFE-03-INSIDER-CONCENTRATION", "PASS", "SAFETY"),
  rule("SAFE-05-LIQUIDITY-DRAIN", "PASS", "SAFETY"), rule("SAFE-06-AUTHORITY-SELLABILITY", "PASS", "SAFETY"),
  rule("ENTRY-01-STRUCTURE-RECLAIM", "PASS"), rule("ENTRY-02-NOT-OVEREXTENDED", "PASS"),
  rule("ENTRY-03-INVALIDATION", "PASS"), rule("ENTRY-04-EXECUTION", "PASS"),
];

describe("shadow signal gate", () => {
  it("opens only when CORE SAFETY PASS + ENTRY PASS + fresh", () => {
    const g = evaluateGate(allPass, entry, 60_000);
    expect(g.pass).toBe(true); expect(g.coreSafety).toBe("PASS"); expect(g.entryPass).toBe(true);
  });
  it("stale price blocks the gate", () => {
    expect(evaluateGate(allPass, entry, 20 * 60_000).pass).toBe(false);
  });
  it("any safety FAIL blocks (and is not PASS)", () => {
    const g = evaluateGate(allPass.map((r) => r.ruleId === "SAFE-06-AUTHORITY-SELLABILITY" ? rule(r.ruleId, "FAIL", "SAFETY") : r), entry, 60_000);
    expect(g.pass).toBe(false); expect(g.coreSafety).toBe("FAIL");
  });
  it("entry not confirmed blocks", () => {
    const g = evaluateGate(allPass.map((r) => r.ruleId === "ENTRY-01-STRUCTURE-RECLAIM" ? rule(r.ruleId, "INCOMPLETE") : r), entry, 60_000);
    expect(g.pass).toBe(false); expect(g.entryPass).toBe(false);
  });
});
