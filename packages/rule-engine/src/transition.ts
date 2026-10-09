import type { CandidateState, DecisionOutput, RuleEvaluation } from "@aureus/contracts";
import { aggregate, type AggregateStatuses } from "./engine.js";

export interface ReduceOptions {
  hasOpenPosition: boolean;
  discoveryAtMs: number;
  nowMs: number;
  discoveryTtlMs?: number; // default 72h — unqualified candidates EXPIRE after this
}

const DEFAULT_DISCOVERY_TTL_MS = 72 * 60 * 60_000;

/**
 * Deterministic state reducer. First matching clause wins (see TRANSITION_MATRIX.md).
 * Hard-fail dominates; positive signals never override a failed safety gate; and
 * ENTRY_READY requires the full conjunction (Safety PASSED + Quality CONFIRMED +
 * Entry READY + fresh data + no open critical data-quality conflict).
 */
export function reduceState(evals: RuleEvaluation[], opts: ReduceOptions): DecisionOutput {
  const agg = aggregate(evals);
  const ttl = opts.discoveryTtlMs ?? DEFAULT_DISCOVERY_TTL_MS;
  const aged = opts.nowMs - opts.discoveryAtMs > ttl;

  const out = (state: CandidateState, reason: string): DecisionOutput => ({
    state,
    reason,
    safetyStatus: agg.safety,
    qualityStatus: agg.quality,
    entryStatus: agg.quality === "CONFIRMED" ? agg.entry : "NONE",
  });

  // 1. Hard safety failure — terminal-ish, cannot be compensated.
  if (agg.safety === "FAILED") return out("REJECTED", "A critical safety gate failed.");

  // 2. Critical safety data missing — unknown, not bad.
  if (agg.safety === "INCOMPLETE") return out("UNRESOLVED", "Critical safety data is incomplete.");

  // 3. Safety PASSED from here.
  // 3a. Open position under threat.
  if (opts.hasOpenPosition && agg.positionRiskFail) return out("POSITION_RISK", "Open position is threatened (LP drain / smart-wallet exit).");

  // 3b. Quality confirmed → entry logic.
  if (agg.quality === "CONFIRMED") {
    return reduceEntry(agg, out);
  }

  // 3c. Quality developing → structure watch.
  if (agg.quality === "DEVELOPING") return out("STRUCTURE_WATCH", "Safety passed; quality developing.");

  // 3d. Quality weak → researching, or expire if the window elapsed.
  if (aged) return out("EXPIRED", "Discovery window elapsed without qualification.");
  return out("RESEARCHING", "Safety passed; gathering evidence.");
}

function reduceEntry(
  agg: AggregateStatuses,
  out: (state: CandidateState, reason: string) => DecisionOutput,
): DecisionOutput {
  switch (agg.entry) {
    case "OVEREXTENDED":
      return out("OVEREXTENDED", "Quality confirmed but price is overextended.");
    case "READY":
      if (agg.freshnessOk && !agg.openCriticalDataQuality) return out("ENTRY_READY", "All gates green and data fresh.");
      return out("ENTRY_WATCH", agg.freshnessOk ? "Entry ready but a critical data conflict is open." : "Entry ready but required data is stale.");
    case "WAIT_FOR_LEVEL":
      return out("ENTRY_WATCH", "Quality confirmed; waiting for the entry level.");
    case "INVALIDATED":
      return out("ENTRY_WATCH", "Entry invalidated; re-watching for a new level.");
    case "EXPIRED":
      return out("EXPIRED", "Entry window expired.");
    case "TOO_EARLY":
    default:
      return out("QUALITY_CONFIRMED", "Quality confirmed; entry not yet in play.");
  }
}
