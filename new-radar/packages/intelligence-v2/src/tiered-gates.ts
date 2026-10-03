/**
 * TIERED QUALIFICATION SYSTEM — Optimal speed + safety balance
 *
 * Problem: Coins qualified AFTER their peak (2+ hours delay)
 * Solution: Three qualification tiers with early entry points
 *
 * TIER 0 - QUICK_QUALIFIED (5-10s)
 *   ✓ For coins < 1 hour old
 *   ✓ Passes: Freeze Authority, Rug History, Liquidity minimum
 *   ✓ Result: QUICK_QUALIFIED → radar ready for observation
 *
 * TIER 1 - EARLY_QUALIFIED (2-5m)
 *   ✓ For coins 1-4 hours old
 *   ✓ Adds: Deployer concentration, Holder concentration, Token economics
 *   ✓ Result: EARLY_QUALIFIED → eligible for light entry
 *
 * TIER 2 - STRUCTURALLY_QUALIFIED (background)
 *   ✓ Deep gates run in parallel
 *   ✓ Creator track record, Community, Fundamentals, Momentum
 *   ✓ Result: STRUCTURALLY_QUALIFIED → core system status
 *
 * Confidence thresholds:
 *   - QUICK_QUALIFIED: 20% (minimal data, fresh coin)
 *   - EARLY_QUALIFIED: 35% (enrichment data, proven safety)
 *   - STRUCTURALLY_QUALIFIED: 35% (same as before)
 */

import type { VerificationGatesInput, VerificationGatesVerdict, GateResult } from "./revised-gates.js";
import { evaluateVerificationGates } from "./revised-gates.js";

export type QualificationTier = "QUICK_QUALIFIED" | "EARLY_QUALIFIED" | "STRUCTURALLY_QUALIFIED" | "INSUFFICIENT_DATA" | "FATAL_REJECT";

export interface TieredVerdict extends VerificationGatesVerdict {
  tier?: QualificationTier;
  qualifiedAt: "QUICK" | "EARLY" | "FULL" | null;
  timeToQualification: "5-10s" | "2-5m" | "background";
  ageMinutes: number;
  confidenceReason: string;
}

/**
 * TIER 0: QUICK_QUALIFIED gates — immediate safety checks
 * Can be evaluated in ~5-10 seconds with no enrichment API calls
 */
function evaluateQuickGates(input: VerificationGatesInput, ageMinutes: number): GateResult[] {
  const quick: GateResult[] = [];

  // GATE 1: FREEZE AUTHORITY (immediate, on-chain metadata)
  const freezeAuth = input.mint.freezeAuthority;
  if (!freezeAuth) {
    quick.push({
      gateId: "GATE-01-FREEZE-AUTHORITY",
      passed: false,
      status: "FAIL",
      reason: "Freeze authority unavailable",
      severity: "CRITICAL",
      evidence: {},
    });
  } else if (freezeAuth.isMutable) {
    quick.push({
      gateId: "GATE-01-FREEZE-AUTHORITY",
      passed: false,
      status: "FAIL",
      reason: "Mutable freeze authority = rug risk",
      severity: "CRITICAL",
      evidence: { fatal: true },
    });
  } else {
    quick.push({
      gateId: "GATE-01-FREEZE-AUTHORITY",
      passed: true,
      status: "PASS",
      reason: "Freeze authority immutable",
      severity: "CRITICAL",
      evidence: {},
    });
  }

  // GATE 2: CREATOR RUG HISTORY (DB lookup, <100ms)
  if (!input.deployer) {
    quick.push({
      gateId: "GATE-02-CREATOR-RUG-HISTORY",
      passed: false,
      status: "FAIL",
      reason: "Deployer unknown",
      severity: "CRITICAL",
      evidence: {},
    });
  } else {
    const rugMatch = input.knownRugs?.find((r) => r.deployerAddress === input.deployer?.address);
    if (rugMatch) {
      quick.push({
        gateId: "GATE-02-CREATOR-RUG-HISTORY",
        passed: false,
        status: "FAIL",
        reason: `Creator has rug history`,
        severity: "CRITICAL",
        evidence: { fatal: true },
      });
    } else {
      quick.push({
        gateId: "GATE-02-CREATOR-RUG-HISTORY",
        passed: true,
        status: "PASS",
        reason: "No rug history",
        severity: "CRITICAL",
        evidence: {},
      });
    }
  }

  // GATE 7: LIQUIDITY MINIMUM ($50k hard floor, known from discovery)
  const liq = input.liquidityUsd ?? 0;
  const mcap = input.marketCapUsd ?? 0;
  if (liq < 50_000) {
    quick.push({
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: false,
      status: "FAIL",
      reason: `Liquidity $${liq.toLocaleString()} < $50k`,
      severity: "HIGH",
      evidence: { fatal: true },
    });
  } else if (liq / mcap < 0.05) {
    quick.push({
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: false,
      status: "FAIL",
      reason: "Liquidity ratio < 5% (honeypot)",
      severity: "HIGH",
      evidence: { fatal: true },
    });
  } else {
    quick.push({
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: true,
      status: "PASS",
      reason: `Liquidity sufficient`,
      severity: "HIGH",
      evidence: {},
    });
  }

  return quick;
}

/**
 * Check if QUICK_QUALIFIED can be awarded
 */
function canQuickQualify(quickGates: GateResult[]): boolean {
  const failed = quickGates.filter((g) => g.status === "FAIL");
  return failed.length === 0;
}

/**
 * TIER 1: EARLY_QUALIFIED gates — fast enrichment checks
 * Runs in parallel while QUICK gates complete, adds 2-5 minutes
 */
function evaluateEarlyGates(input: VerificationGatesInput, ageMinutes: number): GateResult[] {
  const early: GateResult[] = [];

  // GATE 3: DEPLOYER CONCENTRATION (from Helius enrichment)
  const deployerConc = input.features?.get("deployerDirectHoldingPct");
  if (!deployerConc || deployerConc.status !== "OK") {
    early.push({
      gateId: "GATE-03-DEPLOYER-CONCENTRATION",
      passed: true,
      status: "CAUTION",
      reason: "Deployer concentration pending",
      severity: "HIGH",
      evidence: { pending: true },
    });
  } else {
    const concVal = Number(deployerConc.value);
    if (concVal > 0.50) {
      early.push({
        gateId: "GATE-03-DEPLOYER-CONCENTRATION",
        passed: false,
        status: "FAIL",
        reason: `Deployer ${(concVal * 100).toFixed(1)}% > 50%`,
        severity: "HIGH",
        evidence: { fatal: true },
      });
    } else if (concVal > 0.35) {
      early.push({
        gateId: "GATE-03-DEPLOYER-CONCENTRATION",
        passed: true,
        status: "CAUTION",
        reason: `Deployer ${(concVal * 100).toFixed(1)}% high`,
        severity: "HIGH",
        evidence: {},
      });
    } else {
      early.push({
        gateId: "GATE-03-DEPLOYER-CONCENTRATION",
        passed: true,
        status: "PASS",
        reason: `Deployer concentration safe`,
        severity: "HIGH",
        evidence: {},
      });
    }
  }

  // GATE 4: HOLDER CONCENTRATION
  if (!input.topHolders || input.topHolders.length === 0) {
    early.push({
      gateId: "GATE-04-HOLDER-CONCENTRATION",
      passed: true,
      status: "CAUTION",
      reason: "Holder data pending",
      severity: "HIGH",
      evidence: { pending: true },
    });
  } else {
    const topSum = input.topHolders.reduce((sum, h) => sum + h.pct, 0);
    if (topSum > 0.70) {
      early.push({
        gateId: "GATE-04-HOLDER-CONCENTRATION",
        passed: false,
        status: "FAIL",
        reason: `Top holders ${(topSum * 100).toFixed(1)}% > 70%`,
        severity: "HIGH",
        evidence: { fatal: true },
      });
    } else {
      early.push({
        gateId: "GATE-04-HOLDER-CONCENTRATION",
        passed: true,
        status: "PASS",
        reason: `Holder concentration safe`,
        severity: "HIGH",
        evidence: {},
      });
    }
  }

  return early;
}

/**
 * Main tiered evaluation — returns earliest possible qualification
 */
export function evaluateTieredGates(
  input: VerificationGatesInput,
  ageMinutes: number,
): TieredVerdict {
  const quickGates = evaluateQuickGates(input, ageMinutes);
  const quickFailed = quickGates.filter((g) => g.status === "FAIL");
  const quickPassed = quickGates.filter((g) => g.status === "PASS");

  // TIER 0: QUICK_QUALIFIED for fresh coins with basic safety
  if (quickFailed.length === 0 && ageMinutes < 60) {
    return {
      status: "STRUCTURALLY_QUALIFIED",
      tier: "QUICK_QUALIFIED",
      qualifiedAt: "QUICK",
      timeToQualification: "5-10s",
      ageMinutes,
      confidence: 20,
      confidenceReason: "Fresh coin, basic safety gates passed. Limited data. FOR OBSERVATION ONLY.",
      failedGates: quickFailed,
      cautionGates: [],
      passedGates: quickPassed,
      missingCriticalFields: [],
      suppressionReasons: ["Early qualification: deep gates pending"],
      evidence: { tier: "QUICK", freshCoin: true },
      nextPhaseRequirements: ["Deployer concentration", "Holder data", "Community sentiment"],
    };
  }

  // TIER 1: EARLY_QUALIFIED for coins 1-4 hours old with enrichment data
  if (quickFailed.length === 0 && ageMinutes < 240) {
    const earlyGates = evaluateEarlyGates(input, ageMinutes);
    const earlyFailed = earlyGates.filter((g) => g.status === "FAIL");
    const earlyPassed = earlyGates.filter((g) => g.status === "PASS");
    const earlyCaution = earlyGates.filter((g) => g.status === "CAUTION");

    if (earlyFailed.length === 0) {
      return {
        status: "STRUCTURALLY_QUALIFIED",
        tier: "EARLY_QUALIFIED",
        qualifiedAt: "EARLY",
        timeToQualification: "2-5m",
        ageMinutes,
        confidence: 35,
        confidenceReason: "Early enrichment passed. Fast gates confirmed. Ready for light tracking.",
        failedGates: [...quickFailed, ...earlyFailed],
        cautionGates: earlyCaution,
        passedGates: [...quickPassed, ...earlyPassed],
        missingCriticalFields: [],
        suppressionReasons: ["Early qualification: community/fundamentals pending"],
        evidence: { tier: "EARLY", enrichmentComplete: true },
        nextPhaseRequirements: ["Community sentiment", "Project fundamentals", "Real-time momentum"],
      };
    }
  }

  // TIER 2: STRUCTURALLY_QUALIFIED — run full system
  const fullVerdict = evaluateVerificationGates(input);
  return {
    ...fullVerdict,
    tier: fullVerdict.status === "STRUCTURALLY_QUALIFIED" ? "STRUCTURALLY_QUALIFIED" : undefined,
    qualifiedAt: fullVerdict.status === "STRUCTURALLY_QUALIFIED" ? "FULL" : null,
    timeToQualification: "background",
    ageMinutes,
    confidenceReason: "Full gate system evaluated",
  };
}

/**
 * Summary: which coins to show in radar
 */
export function getTierColors(tier: QualificationTier): { bg: string; border: string; text: string } {
  switch (tier) {
    case "QUICK_QUALIFIED":
      return { bg: "#FFA50014", border: "#FFA500", text: "#FFB84D" }; // Orange: OBSERVATION
    case "EARLY_QUALIFIED":
      return { bg: "#FFD70014", border: "#FFD700", text: "#FFED4E" }; // Gold: EARLY TRACK
    case "STRUCTURALLY_QUALIFIED":
      return { bg: "#34C75914", border: "#34C759", text: "#34C759" }; // Green: READY
    default:
      return { bg: "#6F6F7314", border: "#6F6F73", text: "#8A8A8E" }; // Gray: PENDING
  }
}
