/**
 * Intelligence V2 — REVISED Phase 1 Verification Gates
 *
 * Conservative model: output statuses = STRUCTURALLY_QUALIFIED / INSUFFICIENT_DATA / FATAL_REJECT
 *
 * Gates do NOT output VERIFIED. Verification is a separate step that requires
 * ALL critical dimensions to pass + confidence ≥ 70%.
 *
 * Gates output STRUCTURALLY_QUALIFIED only if:
 * 1. No FATAL_REJECT gates fire
 * 2. Critical data is present (or missing non-critical data)
 * 3. Confidence ≥ 35%
 */

import type { FeatureValue } from "@aureus/contracts";
import { INTELLIGENCE_MODEL_V2_REVISED } from "./revised-config.js";

/**
 * Single gate result
 */
export interface GateResult {
  gateId: string;
  passed: boolean;  // Did NOT hit fatal threshold
  status: "PASS" | "CAUTION" | "FAIL";
  reason: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  evidence: Record<string, unknown>;
}

/**
 * Final verdict from gates
 */
export interface VerificationGatesVerdict {
  // Status: STRUCTURALLY_QUALIFIED = passed gates, ready for deeper analysis (Phase 2)
  // INSUFFICIENT_DATA = missing critical fields (unclear, not positive danger)
  // FATAL_REJECT = positive evidence of unacceptable risk
  status: "STRUCTURALLY_QUALIFIED" | "INSUFFICIENT_DATA" | "FATAL_REJECT";

  confidence: number;  // Data quality 0-100

  // Detail
  failedGates: GateResult[];     // If any FAIL
  cautionGates: GateResult[];    // If any CAUTION
  passedGates: GateResult[];
  missingCriticalFields: string[];
  suppressionReasons: string[];  // Why NOT VERIFIED (if applicable)

  // Evidence
  evidence: Record<string, unknown>;

  // Notes for Phase 2
  nextPhaseRequirements: string[];
}

/**
 * Input to gates
 */
export interface VerificationGatesInput {
  // Features
  features: Map<string, FeatureValue>;

  // On-chain metadata
  mint: {
    freezeAuthority?: { address: string; isMutable: boolean } | null;
    mintAuthority?: { address: string; isMutable: boolean } | null;
  };

  // Holders
  topHolders?: Array<{ wallet: string; pct: number }>;

  // Creator
  deployer?: { address: string };
  createdAt?: number;

  // Risk DB
  knownRugs?: Array<{ deployerAddress: string; reason: string }>;

  // Elite gates (market data)
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;

  // Elite gates (creator track record)
  creatorSocialPresence?: boolean;
  creatorPriorLaunches?: number;
  creatorPriorSuccessRate?: number;

  // Elite gates (community sentiment & virality)
  discordMemberCount?: number;
  discordEngagementScore?: number;
  twitterFollowers?: number;
  twitterEngagementRate?: number;
  twitterBotScore?: number;
  organicMentions?: number;

  // Elite gates (project fundamentals)
  hasWebsite?: boolean;
  websiteQualityScore?: number;
  useCaseClarity?: "clear" | "vague" | "meme";
  hasGitHub?: boolean;
  recentCommits?: number;
  isContractVerified?: boolean;
}

function getFeatureValue(
  features: Map<string, FeatureValue>,
  featureId: string,
): number | null {
  const f = features.get(featureId);
  if (!f || f.status !== "OK" || f.value == null) return null;
  return Number(f.value);
}

// ────────────────────────────────────────────────────────────────────────
// GATE 1: FREEZE AUTHORITY (CRITICAL_REQUIRED)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate1_FreezeAuthority(input: VerificationGatesInput): GateResult {
  const freezeAuth = input.mint.freezeAuthority;

  if (!freezeAuth) {
    return {
      gateId: "GATE-01-FREEZE-AUTHORITY",
      passed: false,
      status: "FAIL",
      reason: "Freeze authority data unavailable (CRITICAL_REQUIRED field missing)",
      severity: "CRITICAL",
      evidence: { freezeAuthority: null, missing: true },
    };
  }

  if (freezeAuth.isMutable) {
    return {
      gateId: "GATE-01-FREEZE-AUTHORITY",
      passed: false,
      status: "FAIL",
      reason: `Mutable freeze authority ${freezeAuth.address} = rug risk (can freeze at any time)`,
      severity: "CRITICAL",
      evidence: { freezeAuthority: freezeAuth, fatal: true },
    };
  }

  return {
    gateId: "GATE-01-FREEZE-AUTHORITY",
    passed: true,
    status: "PASS",
    reason: "Freeze authority immutable (safe)",
    severity: "CRITICAL",
    evidence: { freezeAuthority: freezeAuth },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 2: CREATOR RUG HISTORY (CRITICAL_REQUIRED)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate2_CreatorRugHistory(input: VerificationGatesInput): GateResult {
  if (!input.deployer) {
    return {
      gateId: "GATE-02-CREATOR-RUG-HISTORY",
      passed: false,
      status: "FAIL",
      reason: "Deployer address unknown (CRITICAL_REQUIRED)",
      severity: "CRITICAL",
      evidence: { deployer: null, missing: true },
    };
  }

  const rugMatch = input.knownRugs?.find((r) => r.deployerAddress === input.deployer?.address);

  if (rugMatch) {
    return {
      gateId: "GATE-02-CREATOR-RUG-HISTORY",
      passed: false,
      status: "FAIL",
      reason: `Creator ${input.deployer.address} has rug history: ${rugMatch.reason}`,
      severity: "CRITICAL",
      evidence: { deployerAddress: input.deployer.address, rugRecord: rugMatch, fatal: true },
    };
  }

  return {
    gateId: "GATE-02-CREATOR-RUG-HISTORY",
    passed: true,
    status: "PASS",
    reason: "No known rug history for creator",
    severity: "CRITICAL",
    evidence: { deployerAddress: input.deployer.address },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 3: DEPLOYER CONCENTRATION (CRITICAL_REQUIRED)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate3_DeployerConcentration(input: VerificationGatesInput): GateResult {
  const dim = INTELLIGENCE_MODEL_V2_REVISED.dimensions.deployerConcentration;
  const deployerConcentration = getFeatureValue(input.features, "deployerDirectHoldingPct");

  if (deployerConcentration === null) {
    return {
      gateId: "GATE-03-DEPLOYER-CONCENTRATION",
      passed: false,
      status: "FAIL",
      reason: "Deployer concentration unknown (CRITICAL_REQUIRED)",
      severity: "CRITICAL",
      evidence: { deployerConcentration: null, missing: true },
    };
  }

  if (deployerConcentration > (dim.thresholds.hardFail as number)) {
    return {
      gateId: "GATE-03-DEPLOYER-CONCENTRATION",
      passed: false,
      status: "FAIL",
      reason: `Deployer ${(deployerConcentration * 100).toFixed(1)}% > ${(dim.thresholds.hardFail as number) * 100}% hard fail`,
      severity: "CRITICAL",
      evidence: { concentration: deployerConcentration, hardFail: dim.thresholds.hardFail, fatal: true },
    };
  }

  if (deployerConcentration > (dim.thresholds.verifiedMax as number)) {
    return {
      gateId: "GATE-03-DEPLOYER-CONCENTRATION",
      passed: true,
      status: "CAUTION",
      reason: `Deployer ${(deployerConcentration * 100).toFixed(1)}% between VERIFIED (${(dim.thresholds.verifiedMax as number) * 100}%) and hard fail — STRUCTURALLY_QUALIFIED but flagged`,
      severity: "HIGH",
      evidence: { concentration: deployerConcentration, verifiedMax: dim.thresholds.verifiedMax },
    };
  }

  return {
    gateId: "GATE-03-DEPLOYER-CONCENTRATION",
    passed: true,
    status: "PASS",
    reason: `Deployer ${(deployerConcentration * 100).toFixed(1)}% ≤ VERIFIED threshold`,
    severity: "HIGH",
    evidence: { concentration: deployerConcentration },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 4: HOLDER CONCENTRATION (CRITICAL_REQUIRED)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate4_HolderConcentration(input: VerificationGatesInput): GateResult {
  const dim = INTELLIGENCE_MODEL_V2_REVISED.dimensions.holderConcentration;

  if (!input.topHolders) {
    return {
      gateId: "GATE-04-HOLDER-CONCENTRATION",
      passed: false,
      status: "FAIL",
      reason: "Top holder data unavailable (CRITICAL_REQUIRED)",
      severity: "CRITICAL",
      evidence: { topHolders: input.topHolders, missing: true },
    };
  }

  if (input.topHolders.length === 0) {
    return {
      gateId: "GATE-04-HOLDER-CONCENTRATION",
      passed: false,
      status: "FAIL",
      reason: "No holder data available",
      severity: "CRITICAL",
      evidence: { topHolders: [], missing: true },
    };
  }

  // Use available data: in Phase 1, we have aggregate top-10% but not individual holders
  // Check what we do have
  const topSum = input.topHolders.reduce((sum, h) => sum + h.pct, 0);

  if (topSum > (dim.thresholds.hardFail as number)) {
    return {
      gateId: "GATE-04-HOLDER-CONCENTRATION",
      passed: false,
      status: "FAIL",
      reason: `Top holders ${(topSum * 100).toFixed(1)}% > ${(dim.thresholds.hardFail as number) * 100}% = illiquid (hard fail)`,
      severity: "CRITICAL",
      evidence: { topConcentration: topSum, hardFail: dim.thresholds.hardFail, fatal: true },
    };
  }

  if (topSum > (dim.thresholds.verifiedMax as number)) {
    return {
      gateId: "GATE-04-HOLDER-CONCENTRATION",
      passed: true,
      status: "CAUTION",
      reason: `Top holders ${(topSum * 100).toFixed(1)}% between VERIFIED (${(dim.thresholds.verifiedMax as number) * 100}%) and hard fail — STRUCTURALLY_QUALIFIED but flagged`,
      severity: "HIGH",
      evidence: { topConcentration: topSum, verifiedMax: dim.thresholds.verifiedMax },
    };
  }

  return {
    gateId: "GATE-04-HOLDER-CONCENTRATION",
    passed: true,
    status: "PASS",
    reason: `Top holders ${(topSum * 100).toFixed(1)}% ≤ VERIFIED threshold`,
    severity: "HIGH",
    evidence: { topConcentration: topSum },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 5: BASIC LIQUIDITY (CRITICAL_REQUIRED)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate5_BasicLiquidity(input: VerificationGatesInput): GateResult {
  return {
    gateId: "GATE-05-BASIC-LIQUIDITY",
    passed: true,
    status: "PASS",
    reason: "Liquidity check deferred to data enrichment",
    severity: "MEDIUM",
    evidence: { note: "Phase 1 assumes liquidity present; will verify in snapshot" },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 6: TOKEN ECONOMICS (ELITE GATE - HIGH SEVERITY)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate6_TokenEconomics(input: VerificationGatesInput): GateResult {
  const deployerConc = getFeatureValue(input.features, "deployerDirectHoldingPct");

  // Check deployer allocation
  if (deployerConc !== null && deployerConc > 0.50) {
    return {
      gateId: "GATE-06-TOKEN-ECONOMICS",
      passed: false,
      status: "FAIL",
      reason: `Deployer concentration ${(deployerConc * 100).toFixed(1)}% exceeds predatory threshold (>50% = suspected rugpull structure)`,
      severity: "HIGH",
      evidence: { deployerConcentration: deployerConc, fatal: true },
    };
  }

  if (deployerConc !== null && deployerConc > 0.35) {
    return {
      gateId: "GATE-06-TOKEN-ECONOMICS",
      passed: true,
      status: "CAUTION",
      reason: `Deployer ${(deployerConc * 100).toFixed(1)}% is high — healthy projects typically <30%`,
      severity: "HIGH",
      evidence: { deployerConcentration: deployerConc, economicsRisk: "moderate" },
    };
  }

  return {
    gateId: "GATE-06-TOKEN-ECONOMICS",
    passed: true,
    status: "PASS",
    reason: `Deployer concentration acceptable at ${deployerConc ? (deployerConc * 100).toFixed(1) : "unknown"}%`,
    severity: "HIGH",
    evidence: { deployerConcentration: deployerConc, economicsQuality: "good" },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 7: LIQUIDITY QUALITY (ELITE GATE - HIGH SEVERITY)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate7_LiquidityQuality(input: VerificationGatesInput & { liquidityUsd?: number | null; marketCapUsd?: number | null }): GateResult {
  const liq = input.liquidityUsd;
  const mcap = input.marketCapUsd;

  // No data available
  if (!liq || !mcap) {
    return {
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: true,  // Still passes; elite-tier data is just missing
      status: "CAUTION",  // Elite tier check is optional; missing data is caution, not failure
      reason: "Liquidity or market cap data unavailable (elite tier analysis deferred)",
      severity: "HIGH",
      evidence: { liquidity: liq, marketCap: mcap, missing: true },
    };
  }

  const minLiquidity = 50_000; // $50k minimum absolute
  if (liq < minLiquidity) {
    return {
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: false,
      status: "FAIL",
      reason: `Liquidity $${liq.toLocaleString()} < $50k minimum (too illiquid to trade safely)`,
      severity: "HIGH",
      evidence: { liquidity: liq, minRequired: minLiquidity, fatal: true },
    };
  }

  const liqRatio = liq / mcap;
  const minRatio = 0.05; // 5% ratio
  if (liqRatio < minRatio) {
    return {
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: false,
      status: "FAIL",
      reason: `Liquidity ratio ${(liqRatio * 100).toFixed(1)}% < 5% threshold (honey pot trap: exit will fail)`,
      severity: "HIGH",
      evidence: { liquidityRatio: liqRatio, minRequired: minRatio, liquidity: liq, marketCap: mcap, fatal: true },
    };
  }

  const goodRatio = 0.15; // 15% is healthy
  if (liqRatio < goodRatio) {
    return {
      gateId: "GATE-07-LIQUIDITY-QUALITY",
      passed: true,
      status: "CAUTION",
      reason: `Liquidity ratio ${(liqRatio * 100).toFixed(1)}% is thin — slippage risk exists`,
      severity: "HIGH",
      evidence: { liquidityRatio: liqRatio, idealRatio: goodRatio, liquidityQuality: "thin" },
    };
  }

  return {
    gateId: "GATE-07-LIQUIDITY-QUALITY",
    passed: true,
    status: "PASS",
    reason: `Liquidity quality strong: ${(liqRatio * 100).toFixed(1)}% of mcap ($${liq.toLocaleString()} / $${mcap.toLocaleString()})`,
    severity: "HIGH",
    evidence: { liquidityRatio: liqRatio, liquidity: liq, marketCap: mcap, liquidityQuality: "strong" },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 8: CREATOR TRACK RECORD (ELITE GATE - HIGH SEVERITY)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate8_CreatorTrackRecord(input: VerificationGatesInput & { creatorSocialPresence?: boolean; creatorPriorLaunches?: number; creatorPriorSuccessRate?: number }): GateResult {
  const hasSocial = input.creatorSocialPresence ?? false;
  const priorLaunches = input.creatorPriorLaunches ?? 0;
  const successRate = input.creatorPriorSuccessRate ?? 0;

  if (!hasSocial && priorLaunches === 0) {
    return {
      gateId: "GATE-08-CREATOR-TRACK-RECORD",
      passed: true,
      status: "CAUTION",
      reason: "Anonymous creator with no traceable history",
      severity: "HIGH",
      evidence: { anonymous: true, priorLaunches: 0 },
    };
  }

  if (priorLaunches > 0 && successRate < 0.20) {
    return {
      gateId: "GATE-08-CREATOR-TRACK-RECORD",
      passed: false,
      status: "FAIL",
      reason: `Creator has ${priorLaunches} prior launches with ${(successRate * 100).toFixed(0)}% success rate (serial rugger)`,
      severity: "HIGH",
      evidence: { priorLaunches, successRate, fatal: true },
    };
  }

  if (priorLaunches > 0 && successRate >= 0.50) {
    return {
      gateId: "GATE-08-CREATOR-TRACK-RECORD",
      passed: true,
      status: "PASS",
      reason: `Creator: ${priorLaunches} prior launches, ${(successRate * 100).toFixed(0)}% success (experienced)`,
      severity: "HIGH",
      evidence: { priorLaunches, successRate, builderQuality: "experienced" },
    };
  }

  if (hasSocial) {
    return {
      gateId: "GATE-08-CREATOR-TRACK-RECORD",
      passed: true,
      status: "CAUTION",
      reason: "Creator has social presence but limited track record",
      severity: "HIGH",
      evidence: { socialPresence: true, builderQuality: "emerging" },
    };
  }

  return {
    gateId: "GATE-08-CREATOR-TRACK-RECORD",
    passed: true,
    status: "PASS",
    reason: "Creator identity verifiable",
    severity: "HIGH",
    evidence: { builderQuality: "neutral" },
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 9: COMMUNITY VIRALITY (REAL SENTIMENT, NOT FAKE HYPE)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate9_CommunityVirality(input: VerificationGatesInput & {
  discordMemberCount?: number;
  discordEngagementScore?: number;
  twitterFollowers?: number;
  twitterEngagementRate?: number;
  twitterBotScore?: number;
  organicMentions?: number;
}): GateResult {
  const discord = input.discordMemberCount ?? 0;
  const discordScore = input.discordEngagementScore ?? 0; // 0-100, higher = more real
  const twitter = input.twitterFollowers ?? 0;
  const engagement = input.twitterEngagementRate ?? 0;
  const botScore = input.twitterBotScore ?? 0; // 0-100, higher = more bots
  const organic = input.organicMentions ?? 0;

  // Bot farm: high members, low engagement
  if (discord > 500 && discordScore < 30) {
    return {
      gateId: "GATE-09-COMMUNITY-VIRALITY",
      passed: false,
      status: "FAIL",
      reason: `Discord bot farm detected: ${discord} members but fake engagement (${discordScore}/100 authenticity)`,
      severity: "CRITICAL",
      evidence: { discord, discordScore, botFarm: true, fatal: true },
    };
  }

  // Bought followers: tons of followers, low engagement, bot heavy
  if (twitter > 5000 && engagement < 0.015 && botScore > 70) {
    return {
      gateId: "GATE-09-COMMUNITY-VIRALITY",
      passed: false,
      status: "FAIL",
      reason: `Fake followers: ${twitter} count but ${(engagement * 100).toFixed(1)}% real engagement (${botScore}% bots)`,
      severity: "CRITICAL",
      evidence: { twitter, engagement, botScore, artificialFollowers: true, fatal: true },
    };
  }

  // REAL ORGANIC VIRALITY: actual people talking about it
  if (organic > 15 || (engagement > 0.04 && botScore < 40)) {
    return {
      gateId: "GATE-09-COMMUNITY-VIRALITY",
      passed: true,
      status: "PASS",
      reason: `AUTHENTIC VIRAL BUZZ: ${organic} organic mentions + ${(engagement * 100).toFixed(1)}% genuine engagement (real people, not bots)`,
      severity: "CRITICAL",
      evidence: { organic, engagement, botScore, sentimentQuality: "authentic_viral" },
    };
  }

  // Small real community
  if ((discord > 100 && discordScore > 60) || (twitter > 1000 && engagement > 0.025 && botScore < 50)) {
    return {
      gateId: "GATE-09-COMMUNITY-VIRALITY",
      passed: true,
      status: "PASS",
      reason: `Real community building: genuine members/followers engaging organically`,
      severity: "CRITICAL",
      evidence: { discord, twitter, engagement, botScore, sentimentQuality: "genuine" },
    };
  }

  // Too early to tell
  if (discord > 0 || twitter > 0) {
    return {
      gateId: "GATE-09-COMMUNITY-VIRALITY",
      passed: true,
      status: "CAUTION",
      reason: "Community exists but sentiment data insufficient to verify authenticity",
      severity: "CRITICAL",
      evidence: { sentimentQuality: "emerging" },
    };
  }

  return {
    gateId: "GATE-09-COMMUNITY-VIRALITY",
    passed: true,  // Still passes; data is just missing
    status: "CAUTION",  // Missing data is caution, not failure
    reason: "No social community presence detected (social data not available to verify)",
    severity: "CRITICAL",
    evidence: { noSocial: true, missing: true },  // Missing data, not dangerous data
  };
}

// ────────────────────────────────────────────────────────────────────────
// GATE 10: PROJECT FUNDAMENTALS (REAL PROJECT VS CASH GRAB)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate10_ProjectFundamentals(input: VerificationGatesInput & {
  hasWebsite?: boolean;
  websiteQualityScore?: number;
  useCaseClarity?: "clear" | "vague" | "meme";
  hasGitHub?: boolean;
  recentCommits?: number;
  isContractVerified?: boolean;
}): GateResult {
  const hasWeb = input.hasWebsite ?? false;
  const webScore = input.websiteQualityScore ?? 0;
  const useCase = input.useCaseClarity ?? "vague";
  const hasGit = input.hasGitHub ?? false;
  const commits = input.recentCommits ?? 0;
  const verified = input.isContractVerified ?? false;

  // Clear zero-effort cash grab
  if (!hasWeb && useCase === "meme" && commits === 0 && !hasGit) {
    return {
      gateId: "GATE-10-PROJECT-FUNDAMENTALS",
      passed: false,
      status: "FAIL",
      reason: "100% cash grab pattern: no site, no code, meme use case (certain rug)",
      severity: "HIGH",
      evidence: { website: false, useCaseClarity: "meme", commits: 0, fatal: true },
    };
  }

  // Real project with development
  if (hasWeb && webScore >= 5 && commits > 2 && verified) {
    return {
      gateId: "GATE-10-PROJECT-FUNDAMENTALS",
      passed: true,
      status: "PASS",
      reason: `Legitimate project: site (${webScore}/10), active development (${commits} commits), verified contract`,
      severity: "HIGH",
      evidence: { website: true, webScore, commits, verified, projectQuality: "legitimate" },
    };
  }

  // Professional high-effort project
  if (hasWeb && webScore >= 7 && useCase === "clear" && commits > 5 && verified) {
    return {
      gateId: "GATE-10-PROJECT-FUNDAMENTALS",
      passed: true,
      status: "PASS",
      reason: `Professional project: quality site, clear use case, active development, audited`,
      severity: "HIGH",
      evidence: { website: true, webScore, useCaseClarity: "clear", commits, verified, projectQuality: "professional" },
    };
  }

  // Vague project = higher risk
  if (hasWeb && useCase === "vague" && commits < 3) {
    return {
      gateId: "GATE-10-PROJECT-FUNDAMENTALS",
      passed: true,
      status: "CAUTION",
      reason: "Vague use case + minimal development = moderate rug risk",
      severity: "HIGH",
      evidence: { useCaseClarity: "vague", commits, projectQuality: "unclear" },
    };
  }

  if (hasWeb && webScore >= 4) {
    return {
      gateId: "GATE-10-PROJECT-FUNDAMENTALS",
      passed: true,
      status: "CAUTION",
      reason: "Project exists but development activity or clarity is limited",
      severity: "HIGH",
      evidence: { website: true, webScore, projectQuality: "minimal" },
    };
  }

  return {
    gateId: "GATE-10-PROJECT-FUNDAMENTALS",
    passed: true,  // Still passes; data is just missing
    status: "CAUTION",  // Missing data is caution, not failure
    reason: "No project evidence found (project data not available to verify)",
    severity: "HIGH",
    evidence: { noProject: true, missing: true },  // Missing data, not dangerous data
  };
}

// ────────────────────────────────────────────────────────────────────────
// MAIN EVALUATION
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// GATE 11: REAL-TIME MOMENTUM (TILCAYO EARLY DETECTION)
// ────────────────────────────────────────────────────────────────────────

function evaluateGate11_Momentum(input: VerificationGatesInput & {
  volumeUsd24h?: number;
  volumeUsd7d?: number;
  buyVolume?: number;
  sellVolume?: number;
  holderGrowthRate?: number;
  support1Tests?: number;
  hoursActive?: number;
}): GateResult {
  const vol24h = input.volumeUsd24h ?? 0;
  const vol7d = input.volumeUsd7d ?? 1;
  const volumeRatio = vol24h / Math.max(vol7d / 7, 1);
  const buyRatio = (input.buyVolume ?? 0) / Math.max(input.sellVolume ?? 1, 1);
  const holderGrowth = input.holderGrowthRate ?? 0;
  const supportTests = input.support1Tests ?? 0;
  const hoursActive = input.hoursActive ?? 0;

  // Real Tilcayo pattern: multi-confirmation
  if (volumeRatio >= 2.5 && buyRatio >= 1.5 && holderGrowth >= 15 && supportTests >= 2 && hoursActive >= 6) {
    return {
      gateId: "GATE-11-MOMENTUM",
      passed: true,
      status: "PASS",
      reason: `TILCAYO CANDIDATE DETECTED: ${volumeRatio.toFixed(1)}x volume, ${buyRatio.toFixed(1)}:1 buy pressure, ${holderGrowth.toFixed(0)}%/day holder acceleration, support tested ${supportTests}x`,
      severity: "CRITICAL",
      evidence: { volumeRatio, buyRatio, holderGrowth, supportTests, hoursActive, tilcayoPattern: true },
    };
  }

  // Building momentum (Phase 2→3 transition)
  if (volumeRatio >= 1.8 && buyRatio >= 1.3 && holderGrowth >= 10 && hoursActive >= 4) {
    return {
      gateId: "GATE-11-MOMENTUM",
      passed: true,
      status: "CAUTION",
      reason: `Strong momentum building: ${volumeRatio.toFixed(1)}x volume, ${buyRatio.toFixed(1)}:1 buy/sell, ${holderGrowth.toFixed(0)}%/day holders (watch for Phase 3 breakout)`,
      severity: "CRITICAL",
      evidence: { volumeRatio, buyRatio, holderGrowth, phase: "building" },
    };
  }

  // Early-stage / building momentum (OPPORTUNITY timing issue, not STRUCTURAL safety)
  // FIXED: Lack of momentum is not a safety issue; it's a timing/opportunity issue.
  // Token can be STRUCTURALLY_QUALIFIED but lack momentum, so this gate should not
  // fatally reject. Instead, it flags for monitoring with CAUTION status.
  return {
    gateId: "GATE-11-MOMENTUM",
    passed: true,  // Changed from false: timing ≠ safety
    status: "CAUTION",  // Changed from FAIL: flags opportunity, not structural danger
    reason: `Early-stage momentum: volume ratio ${volumeRatio.toFixed(1)}x, buy/sell ${buyRatio.toFixed(1)}:1, holder growth ${holderGrowth.toFixed(0)}%/day — structurally qualified but monitor for entry opportunity`,
    severity: "CRITICAL",
    evidence: { volumeRatio, buyRatio, holderGrowth, phase: "formation" },
  };
}

export function evaluateVerificationGates(input: VerificationGatesInput): VerificationGatesVerdict {
  const gates: GateResult[] = [
    evaluateGate1_FreezeAuthority(input),
    evaluateGate2_CreatorRugHistory(input),
    evaluateGate3_DeployerConcentration(input),
    evaluateGate4_HolderConcentration(input),
    evaluateGate5_BasicLiquidity(input),
    evaluateGate6_TokenEconomics(input),
    evaluateGate7_LiquidityQuality(input),
    evaluateGate8_CreatorTrackRecord(input),
    evaluateGate9_CommunityVirality(input),
    evaluateGate10_ProjectFundamentals(input),
    evaluateGate11_Momentum(input),
  ];

  const failedGates = gates.filter((g) => g.status === "FAIL");
  const cautionGates = gates.filter((g) => g.status === "CAUTION");
  const passedGates = gates.filter((g) => g.status === "PASS");

  const missingCriticalFields: string[] = [];
  const suppressionReasons: string[] = [];

  // ── Distinguish INSUFFICIENT_DATA from FATAL_REJECT ──────────────────
  // Missing critical data = INSUFFICIENT_DATA (we can't verify but no positive danger)
  // Positive dangerous evidence = FATAL_REJECT (we found actual risk)
  const missingDataGates = failedGates.filter((g) => g.evidence.missing === true);
  const dangerousGates = failedGates.filter((g) => g.evidence.missing !== true && g.evidence.fatal === true);

  if (dangerousGates.length > 0) {
    const firstDanger = dangerousGates[0]!;
    suppressionReasons.push(`Fatal gate failure: ${firstDanger.gateId} — ${firstDanger.reason}`);

    return {
      status: "FATAL_REJECT",
      confidence: 100,
      failedGates: [firstDanger],
      cautionGates: [],
      passedGates,
      missingCriticalFields,
      suppressionReasons,
      evidence: {
        firstFailure: firstDanger,
        totalFailures: dangerousGates.length,
      },
      nextPhaseRequirements: [],
    };
  }

  if (missingDataGates.length > 0) {
    suppressionReasons.push(`Missing critical data: ${missingDataGates.map((g) => g.gateId).join(", ")}`);
    missingCriticalFields.push(...missingDataGates.map((g) => g.reason));

    return {
      status: "INSUFFICIENT_DATA",
      confidence: 30,
      failedGates: [],
      cautionGates: [],
      passedGates,
      missingCriticalFields,
      suppressionReasons,
      evidence: {
        missingFields: missingDataGates.map((g) => g.gateId),
      },
      nextPhaseRequirements: missingDataGates.map((g) => `Obtain: ${g.reason}`),
    };
  }

  // ── STRUCTURALLY_QUALIFIED ────────────────────────────────────────────────────
  let confidence = 85;  // Base confidence if gates pass

  if (cautionGates.length > 0) {
    confidence -= cautionGates.length * 10;
    suppressionReasons.push(`Caution flags: ${cautionGates.map((g) => g.gateId).join(", ")}`);
  }

  if (confidence < INTELLIGENCE_MODEL_V2_REVISED.confidenceThresholds.forSTRUCTURALLY_QUALIFIED) {
    suppressionReasons.push(`Confidence ${confidence}% < ${INTELLIGENCE_MODEL_V2_REVISED.confidenceThresholds.forSTRUCTURALLY_QUALIFIED}% (STRUCTURALLY_QUALIFIED minimum)`);
    return {
      status: "INSUFFICIENT_DATA",
      confidence,
      failedGates: [],
      cautionGates,
      passedGates,
      missingCriticalFields,
      suppressionReasons,
      evidence: { lowConfidence: true },
      nextPhaseRequirements: cautionGates.map((g) => `Resolve: ${g.reason}`),
    };
  }

  // ── Success: STRUCTURALLY_QUALIFIED ───────────────────────────────────────────
  const nextPhaseRequirements = [
    "Phase 2: Entity clustering (wallet forensics)",
    "Phase 2: Organic flow analysis (real buyers vs wash trading)",
    "Phase 2: Trend/narrative analysis (pre-mint vs post-token)",
    "Phase 2: Smart money wallet tracking",
    "Optional: Helius API (bundle contamination)",
  ];

  return {
    status: "STRUCTURALLY_QUALIFIED",
    confidence,
    failedGates: [],
    cautionGates,
    passedGates,
    missingCriticalFields,
    suppressionReasons: [
      "Not yet VERIFIED. Phase 2 required for entity/flow/trend analysis.",
      `Current confidence ${confidence}% below VERIFIED threshold (${INTELLIGENCE_MODEL_V2_REVISED.confidenceThresholds.forVERIFIED}%).`,
      "Qualified for deep analysis; not recommended for trading until VERIFIED.",
    ],
    evidence: {
      gatesStatus: gates.map((g) => ({ id: g.gateId, status: g.status })),
    },
    nextPhaseRequirements,
  };
}
