/**
 * Two-layer SAFETY verdict — CORE and ADVANCED — for the ACTIONABLE gate + UI.
 *
 * CORE SAFETY = the checks a conditional entry relies on: holder/insider
 * concentration, authorities, sellability, liquidity drain, current deployer
 * exposure. A candidate can reach CORE SAFETY PASS.
 *
 * ADVANCED ON-CHAIN = bundle attribution, full funding chain, historical deployer
 * sales, connected wallet graph, prior deployments/rugs. On the free tier these are
 * INCOMPLETE/UNKNOWN — and a candidate with missing Advanced data is NEVER shown as
 * fully Safety-complete.
 *
 * No thresholds lowered: any SAFETY rule FAIL → FAIL; a missing REQUIRED (core)
 * dataset → INCOMPLETE (never PASS).
 */
import { SAFETY_REQUIRED_DATASETS, ADVANCED_DATASETS } from "./registry.js";

export type SafetyVerdict = "PASS" | "FAIL" | "INCOMPLETE" | "NA";
export type AdvancedVerdict = "COMPLETE" | "INCOMPLETE" | "UNKNOWN";

/** Which dataset(s) each SAFETY rule speaks for. */
export const SAFETY_RULE_DATASETS: Record<string, string[]> = {
  "SAFE-01-CRITICAL-DATA": [],
  "SAFE-02-BLACKLIST-FUNDING": ["deployer_funding"],
  "SAFE-03-INSIDER-CONCENTRATION": ["insider_concentration"],
  "SAFE-04-BUNDLE-CONTAMINATION": ["bundle_contamination"],
  "SAFE-05-LIQUIDITY-DRAIN": ["liquidity_drain"],
  "SAFE-06-AUTHORITY-SELLABILITY": ["authorities", "sellability"],
};

/** Value-rules tied to REQUIRED (core) datasets — must be PASS for CORE PASS. */
const REQUIRED_RULES = Object.entries(SAFETY_RULE_DATASETS)
  .filter(([, ds]) => ds.some((d) => SAFETY_REQUIRED_DATASETS.includes(d)))
  .map(([r]) => r);

export interface SafetyLayers {
  core: SafetyVerdict;
  coreBlocker: string;
  advanced: AdvancedVerdict;
  advancedMissing: string[]; // advanced datasets not OK
  requiredMissing: string[]; // core-required datasets not OK
  failingRules: string[];
}

/** @deprecated shape kept for the label; use SafetyLayers.core. */
export interface EffectiveSafety extends SafetyLayers {
  status: SafetyVerdict;
  blocker: string;
  advisoryIncomplete: string[];
}

export function safetyLayers(
  safetyRules: Array<{ ruleId: string; result: string }>,
  datasetStatus: Record<string, string | undefined>,
): SafetyLayers {
  const failingRules = safetyRules.filter((r) => r.result === "FAIL").map((r) => r.ruleId);
  const requiredMissing = SAFETY_REQUIRED_DATASETS.filter((d) => datasetStatus[d] !== "OK");
  // A CORE rule must be genuinely satisfied. NOT_APPLICABLE was introduced for checks
  // that only a paid indexer can answer — that is legitimate for ADVANCED datasets, but
  // if a core rule ever returned it, Core Safety would silently PASS on an unanswered
  // question. Treat it as unresolved here so the escape hatch can never migrate inward.
  const requiredRulesIncomplete = REQUIRED_RULES.filter((rid) => {
    const r = safetyRules.find((x) => x.ruleId === rid);
    return r == null || r.result === "INCOMPLETE" || r.result === "NOT_APPLICABLE";
  });

  let core: SafetyVerdict;
  let coreBlocker: string;
  if (failingRules.length) { core = "FAIL"; coreBlocker = `Core Safety FAIL: ${failingRules.join(", ")}`; }
  else if (requiredMissing.length) { core = "INCOMPLETE"; coreBlocker = `Missing core data: ${requiredMissing.join(", ")}`; }
  else if (requiredRulesIncomplete.length) { core = "INCOMPLETE"; coreBlocker = `Core rules not resolved: ${requiredRulesIncomplete.join(", ")}`; }
  else { core = "PASS"; coreBlocker = "Core Safety PASS"; }

  // Advanced layer — never contributes to a PASS; its absence is surfaced explicitly.
  const advancedMissing = ADVANCED_DATASETS.filter((d) => datasetStatus[d] !== "OK");
  const advancedPresent = ADVANCED_DATASETS.filter((d) => datasetStatus[d] != null);
  const advanced: AdvancedVerdict = advancedMissing.length === 0 && ADVANCED_DATASETS.length > 0 ? "COMPLETE"
    : advancedPresent.length === 0 ? "UNKNOWN" : "INCOMPLETE";

  return { core, coreBlocker, advanced, advancedMissing, requiredMissing, failingRules };
}

/** Back-compat wrapper: exposes core as `status` for existing callers. */
export function effectiveSafety(
  safetyRules: Array<{ ruleId: string; result: string }>,
  datasetStatus: Record<string, string | undefined>,
): EffectiveSafety {
  const l = safetyLayers(safetyRules, datasetStatus);
  return { ...l, status: l.core, blocker: l.coreBlocker, advisoryIncomplete: l.advancedMissing };
}
