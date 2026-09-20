/**
 * Intelligence V2 — REVISED Phase 1 Configuration
 *
 * Conservative ALLOWLIST model: suppress ~99%, verify high-confidence only.
 *
 * UNKNOWN risk ≠ SAFE. Missing critical data → NOT VERIFIED.
 * All thresholds are INITIAL HYPOTHESES requiring empirical calibration.
 *
 * Structure per dimension:
 * - verifiedMax: threshold to earn VERIFIED status
 * - cautionMax: below this, still STRUCTURALLY_QUALIFIED but flagged
 * - hardFail: exceeds this → FATAL_REJECT
 * - minimumConfidence: must have this % confidence in data
 * - unknownPolicy: how to handle missing data (INSUFFICIENT_DATA, CONFIDENCE_PENALTY, ALLOW)
 */

import { createHash } from "crypto";

export const INTELLIGENCE_V2_VERSION = "v2.3-momentum-gates";  // .2: added GATE-08 (CreatorTrackRecord) + GATE-09 (CommunityVirality-REAL_SENTIMENT) + GATE-10 (ProjectFundamentals)

export const INTELLIGENCE_MODEL_V2_REVISED = {
  version: INTELLIGENCE_V2_VERSION,
  phaseCapabilities: {
    maxAllowedStatus: "STRUCTURALLY_STRUCTURALLY_QUALIFIED",  // Phase 1 cannot exceed this
    canVerify: false,  // VERIFIED requires Phase 2 data
  },

  dimensions: {
    freezeAuthority: {
      description: "Can deployer freeze transfers at any time?",
      criticalRequired: true,
      thresholds: {
        verifiedMax: "IMMUTABLE",
        cautionMax: "IMMUTABLE",
        hardFail: "MUTABLE",
      },
      minimumConfidence: 95,
      unknownPolicy: "INSUFFICIENT_DATA",
    },

    deployerConcentration: {
      description: "Direct creator token holding % of total supply (Phase 1: direct only, not entity-linked wallets)",
      criticalRequired: true,
      thresholds: {
        verifiedMax: 0.30,
        cautionMax: 0.50,
        hardFail: 0.80,
      },
      minimumConfidence: 80,
      unknownPolicy: "INSUFFICIENT_DATA",
    },

    holderConcentration: {
      description: "Top 3 wallets hold how much %?",
      criticalRequired: true,
      thresholds: {
        verifiedMax: 0.70,
        cautionMax: 0.85,
        hardFail: 0.95,
      },
      minimumConfidence: 90,
      unknownPolicy: "INSUFFICIENT_DATA",
    },

    tokenEconomics: {
      description: "Deployer allocation within healthy range (elite gate)",
      criticalRequired: true,
      thresholds: {
        verifiedMax: 0.30,
        cautionMax: 0.35,
        hardFail: 0.50,
      },
      minimumConfidence: 80,
      unknownPolicy: "INSUFFICIENT_DATA",
    },

    liquidityQuality: {
      description: "Liquidity depth and ratio to market cap (elite gate)",
      criticalRequired: true,
      thresholds: {
        minLiquidity: 50_000,
        minRatio: 0.05,
        goodRatio: 0.15,
      },
      minimumConfidence: 85,
      unknownPolicy: "INSUFFICIENT_DATA",
    },

    bundleContamination: {
      description: "Same-block wallet cluster = insider launch",
      criticalRequired: false,
      thresholds: {
        verifiedMax: 0.30,
        cautionMax: 0.50,
        hardFail: 0.70,
      },
      minimumConfidence: 85,
      unknownPolicy: "CONFIDENCE_PENALTY",
      unknownPenalty: -10,
    },

    entityConcentration: {
      description: "Are those top 3 wallets coordinated? (UNKNOWN until Phase 2)",
      criticalRequired: false,
      thresholds: {
        verifiedMax: 0.30,
        cautionMax: 0.60,
        hardFail: 0.80,
      },
      minimumConfidence: 0,  // WE HAVE 0% today
      unknownPolicy: "CONFIDENCE_PENALTY",
      unknownPenalty: -15,
    },

    organicFlow: {
      description: "Real buyers or wash trading? (UNKNOWN until Phase 2)",
      criticalRequired: false,
      minimumConfidence: 0,
      unknownPolicy: "CONFIDENCE_PENALTY",
      unknownPenalty: -10,
    },

    trendAnalysis: {
      description: "Real narrative or post-token shilling? (UNKNOWN until Phase 2)",
      criticalRequired: false,
      minimumConfidence: 0,
      unknownPolicy: "CONFIDENCE_PENALTY",
      unknownPenalty: -20,
    },

    smartMoney: {
      description: "Are qualified traders in this? (UNKNOWN until Phase 2)",
      criticalRequired: false,
      minimumConfidence: 0,
      unknownPolicy: "CONFIDENCE_PENALTY",
      unknownPenalty: -5,
    },
  },

  confidenceThresholds: {
    forSTRUCTURALLY_QUALIFIED: 35,
    forVERIFIED: 70,  // Cannot reach in Phase 1
    forHIGH_CONVICTION: 80,
  },

  phase1Limitations: {
    canVerify: [
      "Freeze authority immutable",
      "Creator address",
      "Deployer concentration (to ~80%)",
      "Top holder concentration",
      "Token economics quality (allocation ≤35%)",
      "Liquidity depth (≥5% of mcap, >$50k)",
      "Creator track record (prior launches + success rate)",
      "Community authenticity (real engagement vs bots)",
      "Project fundamentals (website, GitHub, code verification)",
    ],
    cannotVerifyYet: [
      "Advanced sentiment analysis (Phase 2)",
      "Entity coordination (Phase 2)",
      "Organic flow metrics (Phase 2)",
      "Trend/narrative (Phase 2)",
      "Smart money detection (Phase 2)",
      "Bundle contamination (Helius API)",
    ],
  },

  mode: "shadow" as const,
  disclaimers: [
    "All thresholds are INITIAL HYPOTHESES",
    "After 2-4 weeks, validate against real outcomes",
    "Adjust based on which dimensions correlate with actual rugs",
    "Safety performance takes priority over opportunity",
  ],
};

export function getIntelligenceV2ConfigHash(): string {
  const configStr = JSON.stringify(INTELLIGENCE_MODEL_V2_REVISED, null, 2);
  return createHash("sha256").update(configStr).digest("hex").slice(0, 16);
}

export function getIntelligenceV2VersionId(): string {
  const hash = getIntelligenceV2ConfigHash();
  return `${INTELLIGENCE_V2_VERSION}-${hash}`;
}
