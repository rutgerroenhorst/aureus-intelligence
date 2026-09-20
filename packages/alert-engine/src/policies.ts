import type { CandidateState } from "@aureus/contracts";
import { ALERT_ENGINE_VERSION, stableHash, type AlertContext, type AlertProposal } from "./types.js";

const V = ALERT_ENGINE_VERSION;

export interface PolicyDef {
  policyId: string;
  version: string;
  level: AlertProposal["level"];
  severity: AlertProposal["severity"];
  description: string;
  evaluate: (ctx: AlertContext) => { match: boolean; evidence: Record<string, unknown>; reasons: string[] };
}

const WATCH_STATES: CandidateState[] = ["STRUCTURE_WATCH", "QUALITY_CONFIRMED"];
const ALERTABLE_PRIOR: CandidateState[] = ["STRUCTURE_WATCH", "QUALITY_CONFIRMED", "ENTRY_WATCH", "ENTRY_READY"];

export const POLICIES: PolicyDef[] = [
  {
    policyId: "NEW_WATCH", version: V, level: "WATCH", severity: "LOW",
    description: "Candidate first reaches STRUCTURE_WATCH or QUALITY_CONFIRMED, with no safety failure.",
    evaluate: (ctx) => {
      const match =
        WATCH_STATES.includes(ctx.stateTo) &&
        ctx.stateFrom !== ctx.stateTo &&
        ctx.safety !== "FAILED" &&
        !ctx.hasCriticalFail;
      return {
        match,
        evidence: { stateTo: ctx.stateTo, safety: ctx.safety, liquidityUsd: ctx.liquidityUsd, fdvUsd: ctx.fdvUsd },
        reasons: match ? [`entered ${ctx.stateTo}`] : [],
      };
    },
  },
  {
    policyId: "HIGH_PRIORITY", version: V, level: "HIGH_PRIORITY", severity: "MEDIUM",
    description: "Candidate reaches ENTRY_WATCH with quality developing+, fresh data, liquidity above minimum, not overextended.",
    evaluate: (ctx) => {
      const match =
        ctx.stateTo === "ENTRY_WATCH" &&
        ctx.safety !== "FAILED" &&
        !ctx.hasCriticalFail &&
        ctx.quality !== "WEAK" &&
        ctx.freshnessOk &&
        !ctx.overextended &&
        (ctx.liquidityUsd ?? 0) >= ctx.config.minLiquidityUsd;
      return {
        match,
        evidence: { stateTo: ctx.stateTo, quality: ctx.quality, liquidityUsd: ctx.liquidityUsd, overextended: ctx.overextended },
        reasons: match ? ["reached ENTRY_WATCH within thresholds"] : [],
      };
    },
  },
  {
    policyId: "ENTRY_READY", version: V, level: "ENTRY_READY", severity: "HIGH",
    description: "Transition ENTRY_WATCH → ENTRY_READY under the full conjunction (never when Helius is DEGRADED).",
    evaluate: (ctx) => {
      // Helius required: if on-chain unavailable, never ENTRY_READY.
      if (ctx.heliusMode === "DEGRADED") return { match: false, evidence: { heliusMode: ctx.heliusMode }, reasons: [] };
      const match =
        ctx.stateFrom === "ENTRY_WATCH" &&
        ctx.stateTo === "ENTRY_READY" &&
        ctx.safety === "PASSED" &&
        ctx.freshnessOk &&
        !ctx.openCriticalDataQuality &&
        !ctx.hasCriticalFail &&
        !ctx.overextended &&
        ctx.invalidationAvailable &&
        (ctx.liquidityUsd ?? 0) >= ctx.config.minLiquidityUsd;
      return {
        match,
        evidence: {
          stateFrom: ctx.stateFrom, stateTo: ctx.stateTo, safety: ctx.safety,
          freshnessOk: ctx.freshnessOk, invalidationAvailable: ctx.invalidationAvailable, liquidityUsd: ctx.liquidityUsd,
        },
        reasons: match ? ["Safety PASS + Quality CONFIRMED + Entry READY + fresh + invalidation available"] : [],
      };
    },
  },
  {
    policyId: "RISK", version: V, level: "RISK", severity: "HIGH",
    description: "A previously-surfaced candidate degrades: safety FAIL, liquidity drain, deployer risk, overextension, loses ENTRY_READY, or becomes REJECTED/EXPIRED.",
    evaluate: (ctx) => {
      const lostEntryReady = ctx.stateFrom === "ENTRY_READY" && ctx.stateTo !== "ENTRY_READY";
      const became = ctx.stateTo === "REJECTED" || ctx.stateTo === "EXPIRED" || ctx.stateTo === "POSITION_RISK";
      const degraded = ctx.safety === "FAILED" || ctx.riskReasons.length > 0;
      const relevant = ctx.previouslyAlerted || ALERTABLE_PRIOR.includes(ctx.stateFrom ?? "RESEARCHING");
      const match = relevant && (lostEntryReady || became || degraded);
      return {
        match,
        evidence: { stateFrom: ctx.stateFrom, stateTo: ctx.stateTo, safety: ctx.safety, riskReasons: ctx.riskReasons },
        reasons: match ? [...ctx.riskReasons, lostEntryReady ? "lost ENTRY_READY" : "", became ? `became ${ctx.stateTo}` : ""].filter(Boolean) : [],
      };
    },
  },
];

/**
 * Evaluate all enabled policies deterministically. Returns proposals (may be
 * several); the dispatcher applies dedup, cooldown, and RISK-over-HIGH override.
 */
export function evaluatePolicies(ctx: AlertContext, enabled?: Set<string>): AlertProposal[] {
  const out: AlertProposal[] = [];
  for (const p of POLICIES) {
    if (enabled && !enabled.has(p.policyId)) continue;
    const r = p.evaluate(ctx);
    if (!r.match) continue;
    const evidence = { ...r.evidence, policy: p.policyId, level: p.level, stateTo: ctx.stateTo };
    out.push({
      policyId: p.policyId,
      policyVersion: p.version,
      level: p.level,
      severity: p.severity,
      stateFrom: ctx.stateFrom,
      stateTo: ctx.stateTo,
      evidence,
      evidenceHash: stableHash(evidence),
      reasons: r.reasons,
      positives: ctx.positives,
      missing: ctx.missing,
      riskReasons: ctx.riskReasons,
    });
  }
  return out;
}

export const ALERT_POLICY_CATALOG = POLICIES.map((p) => ({
  policyId: p.policyId, version: p.version, level: p.level, severity: p.severity, description: p.description,
}));
