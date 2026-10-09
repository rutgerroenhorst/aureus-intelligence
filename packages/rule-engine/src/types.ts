import type { FeatureValue, RuleFamily, RuleResult, Severity } from "@aureus/contracts";

export const RULE_ENGINE_VERSION = "re-0.1.0";

/**
 * Deterministic inputs beyond the 24 features. These are boolean/numeric facts
 * produced elsewhere (authority reads, sell simulation, entry-structure analysis).
 * `undefined` means "unknown" → rules resolve to INCOMPLETE, never a guessed PASS.
 */
export interface RuleFlags {
  onChainAvailable: boolean;
  blacklistMatch?: boolean;
  sellable?: boolean;
  mintAuthorityActive?: boolean;
  freezeAuthorityActive?: boolean;
  entryStructurePresent?: boolean;
  reclaimConfirmed?: boolean;
  localInvalidationPrice?: number | null;
  estSlippagePct?: number;
  rewardToRisk?: number;
}

export interface RuleConfig {
  insiderConcentrationMax: number; // FAIL above
  bundleContaminationMax: number;
  holderConcentrationMax: number;
  liquidityDrainRetentionMin: number; // FAIL below (retention_1h)
  lpDrainRatePerHour: number; // FAIL below (negative)
  fundingRiskFail: number; // FAIL at/above
  buyerGrowthMin: number; // PASS at/above
  buyerSellerMin: number;
  walletDiversityMin: number;
  retention1hMin: number;
  retention6hMin: number;
  smartHoldRatioMin: number;
  boostDependencyMax: number; // FAIL above
  overextendedRangePos: number; // FAIL above (price_distance_from_range)
  slippageMaxPct: number;
  rewardToRiskMin: number;
  freshnessMin: number; // DATA_QUALITY freshness PASS at/above (data_freshness)
  sourceAgreementMin: number; // DATA_QUALITY conflict FAIL below
  positionLpRetention15mMin: number;
  evalTtlMs: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  insiderConcentrationMax: 0.35,
  bundleContaminationMax: 0.3,
  holderConcentrationMax: 0.5,
  liquidityDrainRetentionMin: 0.5,
  lpDrainRatePerHour: -0.5,
  fundingRiskFail: 0.8,
  buyerGrowthMin: 1.1,
  buyerSellerMin: 1.0,
  walletDiversityMin: 0.1,
  retention1hMin: 0.8,
  retention6hMin: 0.6,
  smartHoldRatioMin: 0.6,
  boostDependencyMax: 0.6,
  overextendedRangePos: 0.9,
  slippageMaxPct: 3.0,
  rewardToRiskMin: 2.0,
  freshnessMin: 0.5,
  sourceAgreementMin: 0.8,
  positionLpRetention15mMin: 0.7,
  evalTtlMs: 5 * 60_000,
};

export interface RuleContext {
  nowMs: number;
  features: Record<string, FeatureValue>;
  flags: RuleFlags;
  config: RuleConfig;
  hasOpenPosition: boolean;
}

export interface RuleDef {
  ruleId: string;
  ruleVersion: string;
  family: RuleFamily;
  severity: Severity;
  requiredFeatures: string[];
  description: string;
  evaluate: (ctx: RuleContext) => {
    result: RuleResult;
    evidence: Record<string, unknown>;
    explanation: string;
    invalidation: string;
  };
}

/** Deterministic FNV-1a hash of the frozen config → param_hash. */
export function paramHash(config: RuleConfig): string {
  const s = JSON.stringify(config, Object.keys(config).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
