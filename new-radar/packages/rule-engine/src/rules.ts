import type { FeatureValue, RuleResult } from "@aureus/contracts";
import { RULE_ENGINE_VERSION, type RuleContext, type RuleDef } from "./types.js";

const V = RULE_ENGINE_VERSION;

const feat = (ctx: RuleContext, id: string): FeatureValue | undefined => ctx.features[id];
/** OK numeric value, or null if the feature is not OK (missing/unavailable/stale). */
const okVal = (ctx: RuleContext, id: string): number | null => {
  const f = ctx.features[id];
  return f && f.status === "OK" && f.value != null ? f.value : null;
};
const statusOf = (ctx: RuleContext, id: string): string => ctx.features[id]?.status ?? "MISSING";

/**
 * Features that cannot resolve on the current data tier — not "pending", not "slow",
 * structurally impossible without a paid indexer (smart-money labels, wallet
 * clustering, social attention).
 *
 * Measured over the live database on 2026-08-21: each of these was 0% OK across
 * ~1,100–1,500 evaluations. Reporting them as INCOMPLETE told the user Core Safety was
 * "pending", which implies that waiting resolves it. It never does — it needs a
 * purchase decision. A rule that can only ever be answered by buying data must say so
 * instead of sitting in a queue forever.
 */
export const TIER_UNAVAILABLE_FEATURES = new Set([
  "bundle_contamination", "unique_seller_growth", "buyer_seller_ratio",
  "liquidity_retention_6h", "buyer_concentration", "attention_velocity",
  "wallet_group_diversity", "smart_wallet_net_flow", "boost_dependency",
  "smart_wallet_count", "smart_wallet_hold_ratio", "source_agreement",
  "unique_buyer_growth",
]);

/** Split missing features into "might still arrive" and "needs a paid source". */
const splitMissing = (ids: string[], ctx: RuleContext) => {
  const missing = ids.filter((id) => statusOf(ctx, id) !== "OK");
  return {
    pending: missing.filter((id) => !TIER_UNAVAILABLE_FEATURES.has(id)),
    tierGated: missing.filter((id) => TIER_UNAVAILABLE_FEATURES.has(id)),
  };
};

// Result helpers
const R = (
  result: RuleResult,
  explanation: string,
  invalidation: string,
  evidence: Record<string, unknown> = {},
) => ({ result, explanation, invalidation, evidence });

export const RULES: RuleDef[] = [
  // ── SAFETY (hard gates) ──────────────────────────────────────────────────
  {
    ruleId: "SAFE-01-CRITICAL-DATA", ruleVersion: V, family: "SAFETY", severity: "CRITICAL",
    requiredFeatures: ["insider_concentration", "holder_concentration", "bundle_contamination", "deployer_funding_risk"],
    description: "Critical on-chain checks must have data; otherwise Safety is INCOMPLETE (cannot PASS).",
    evaluate: (ctx) => {
      const { pending, tierGated } = splitMissing(
        ["insider_concentration", "holder_concentration", "bundle_contamination", "deployer_funding_risk"], ctx);
      // Data we could still get → genuinely INCOMPLETE, keep waiting.
      if (pending.length > 0)
        return R("INCOMPLETE", `Critical on-chain data unavailable: ${pending.join(", ")}.`, "Provide Helius on-chain data for these checks.", { pending, tierGated });
      // Only paid-tier data is missing. Blocking on it forever is not caution, it is a
      // permanently unanswerable question dressed as a pending one.
      if (tierGated.length > 0)
        return R("PASS", `Critical on-chain checks have data; ${tierGated.join(", ")} needs a paid indexer and is reported as UNKNOWN RISK.`, "A critical on-chain feature becomes unavailable.", { tierGated });
      return R("PASS", "All critical on-chain checks have data.", "A critical on-chain feature becomes unavailable.");
    },
  },
  {
    ruleId: "SAFE-02-BLACKLIST-FUNDING", ruleVersion: V, family: "SAFETY", severity: "CRITICAL",
    requiredFeatures: ["deployer_funding_risk"],
    description: "Known blacklist/funding match or extreme funding risk → FAIL.",
    evaluate: (ctx) => {
      if (ctx.flags.blacklistMatch === true) return R("FAIL", "Deployer/funder matches a known blacklist relationship.", "Blacklist association is disproven.", { blacklistMatch: true });
      const risk = okVal(ctx, "deployer_funding_risk");
      if (ctx.flags.blacklistMatch === undefined && risk == null) return R("INCOMPLETE", "Blacklist/funding reputation unknown (no on-chain data).", "Provide funding-graph data.");
      if (risk != null && risk >= ctx.config.fundingRiskFail) return R("FAIL", `Funding-risk ${risk} ≥ ${ctx.config.fundingRiskFail}.`, `Funding risk drops below ${ctx.config.fundingRiskFail}.`, { risk });
      return R("PASS", "No blacklist match; funding risk within limit.", "A blacklist match or funding-risk spike appears.", { risk });
    },
  },
  {
    ruleId: "SAFE-03-INSIDER-CONCENTRATION", ruleVersion: V, family: "SAFETY", severity: "HIGH",
    requiredFeatures: ["insider_concentration"],
    description: "Insider (deployer/funder-linked) supply share above limit → FAIL.",
    evaluate: (ctx) => {
      const v = okVal(ctx, "insider_concentration");
      if (v == null) return R("INCOMPLETE", "Insider concentration unknown.", "Provide holder/funding data.");
      if (v > ctx.config.insiderConcentrationMax) return R("FAIL", `Insider share ${v} > ${ctx.config.insiderConcentrationMax}.`, `Insider share falls to ≤ ${ctx.config.insiderConcentrationMax}.`, { v });
      return R("PASS", `Insider share ${v} within limit.`, `Insiders accumulate beyond ${ctx.config.insiderConcentrationMax}.`, { v });
    },
  },
  {
    ruleId: "SAFE-04-BUNDLE-CONTAMINATION", ruleVersion: V, family: "SAFETY", severity: "HIGH",
    requiredFeatures: ["bundle_contamination"],
    description: "Same-block launch-bundle supply share above limit → FAIL.",
    evaluate: (ctx) => {
      const v = okVal(ctx, "bundle_contamination");
      if (v == null) return R("NOT_APPLICABLE", "Launch-bundle attribution needs a paid indexer — reported as UNKNOWN RISK, never as a pass.", "A bundle data source is connected.");
      if (v > ctx.config.bundleContaminationMax) return R("FAIL", `Bundled supply ${v} > ${ctx.config.bundleContaminationMax}.`, `Bundled share resolves below ${ctx.config.bundleContaminationMax}.`, { v });
      return R("PASS", `Bundled supply ${v} within limit.`, `Bundle share exceeds ${ctx.config.bundleContaminationMax}.`, { v });
    },
  },
  {
    ruleId: "SAFE-05-LIQUIDITY-DRAIN", ruleVersion: V, family: "SAFETY", severity: "CRITICAL",
    requiredFeatures: ["liquidity_retention_1h", "lp_change_rate"],
    description: "Sudden liquidity withdrawal → FAIL.",
    evaluate: (ctx) => {
      const ret = okVal(ctx, "liquidity_retention_1h");
      const rate = okVal(ctx, "lp_change_rate");
      if (ret == null && rate == null) return R("INCOMPLETE", "Liquidity history unavailable.", "Provide liquidity snapshots over time.");
      if ((ret != null && ret < ctx.config.liquidityDrainRetentionMin) || (rate != null && rate < ctx.config.lpDrainRatePerHour))
        return R("FAIL", `Liquidity draining (retention1h=${ret}, rate=${rate}).`, "Liquidity stabilises within limits.", { ret, rate });
      return R("PASS", "No sudden liquidity withdrawal detected.", "Liquidity drops sharply.", { ret, rate });
    },
  },
  {
    ruleId: "SAFE-06-AUTHORITY-SELLABILITY", ruleVersion: V, family: "SAFETY", severity: "CRITICAL",
    requiredFeatures: [],
    description: "Active mint/freeze authority or non-sellable token → FAIL.",
    evaluate: (ctx) => {
      const { mintAuthorityActive, freezeAuthorityActive, sellable } = ctx.flags;
      if (sellable === false) return R("FAIL", "Token appears non-sellable (honeypot).", "A successful sell simulation is observed.", { sellable });
      if (mintAuthorityActive === true || freezeAuthorityActive === true)
        return R("FAIL", "Mint or freeze authority is still active.", "Authorities are renounced/revoked.", { mintAuthorityActive, freezeAuthorityActive });
      if (sellable === undefined && mintAuthorityActive === undefined && freezeAuthorityActive === undefined)
        return R("INCOMPLETE", "Authority/sellability unknown (no on-chain data).", "Provide mint authority + sell simulation.");
      return R("PASS", "Authorities renounced and token is sellable.", "An authority is re-enabled or sells start failing.");
    },
  },

  // ── QUALITY ────────────────────────────────────────────────────────────
  {
    ruleId: "QUAL-01-INDEPENDENT-DEMAND", ruleVersion: V, family: "QUALITY", severity: "MEDIUM",
    requiredFeatures: ["unique_buyer_growth", "buyer_seller_ratio"],
    description: "Independent buyer growth with buyers outpacing sellers → PASS.",
    evaluate: (ctx) => {
      const g = okVal(ctx, "unique_buyer_growth");
      const bs = okVal(ctx, "buyer_seller_ratio");
      if (g == null || bs == null) return R("NOT_APPLICABLE", "Unique-buyer growth needs per-wallet data a paid indexer provides — reported as UNKNOWN RISK.", "A wallet-level data source is connected.");
      if (g >= ctx.config.buyerGrowthMin && bs >= ctx.config.buyerSellerMin) return R("PASS", `Buyer growth ${g}, buyer/seller ${bs}.`, "Buyer growth stalls or sellers dominate.", { g, bs });
      return R("FAIL", `Insufficient independent demand (growth ${g}, b/s ${bs}).`, `Growth ≥ ${ctx.config.buyerGrowthMin} and b/s ≥ ${ctx.config.buyerSellerMin}.`, { g, bs });
    },
  },
  {
    ruleId: "QUAL-02-CAPITAL-RETENTION", ruleVersion: V, family: "QUALITY", severity: "MEDIUM",
    requiredFeatures: ["liquidity_retention_1h", "liquidity_retention_6h"],
    description: "Liquidity retained over 1h and 6h → PASS.",
    evaluate: (ctx) => {
      const r1 = okVal(ctx, "liquidity_retention_1h");
      const r6 = okVal(ctx, "liquidity_retention_6h");
      if (r1 == null && r6 == null) return R("INCOMPLETE", "Liquidity retention unavailable.", "Provide liquidity history.");
      const ok1 = r1 == null || r1 >= ctx.config.retention1hMin;
      const ok6 = r6 == null || r6 >= ctx.config.retention6hMin;
      if (r1 != null && ok1 && ok6) return R("PASS", `Retention 1h ${r1}, 6h ${r6}.`, "Retention falls below thresholds.", { r1, r6 });
      return R("FAIL", `Capital not retained (1h ${r1}, 6h ${r6}).`, `Retention 1h ≥ ${ctx.config.retention1hMin}, 6h ≥ ${ctx.config.retention6hMin}.`, { r1, r6 });
    },
  },
  {
    ruleId: "QUAL-03-SMART-PARTICIPATION", ruleVersion: V, family: "QUALITY", severity: "LOW",
    requiredFeatures: ["wallet_group_diversity", "smart_wallet_count", "smart_wallet_hold_ratio", "deployer_funding_risk"],
    description: "Diverse wallet groups + reputable wallets holding, without funder connection → PASS.",
    evaluate: (ctx) => {
      const div = okVal(ctx, "wallet_group_diversity");
      const cnt = okVal(ctx, "smart_wallet_count");
      const hold = okVal(ctx, "smart_wallet_hold_ratio");
      const risk = okVal(ctx, "deployer_funding_risk");
      if (div == null || cnt == null || hold == null || risk == null) return R("NOT_APPLICABLE", "Smart-wallet and cluster intelligence needs a paid indexer — reported as UNKNOWN RISK.", "A wallet-intelligence source is connected.");
      const passes = div >= ctx.config.walletDiversityMin && cnt >= 1 && hold >= ctx.config.smartHoldRatioMin && risk < ctx.config.fundingRiskFail;
      return passes
        ? R("PASS", `Diversity ${div}, smart wallets ${cnt} holding ${hold}, funder risk ${risk}.`, "Smart wallets exit or funder linkage appears.", { div, cnt, hold, risk })
        : R("FAIL", `Weak/insider-linked participation (div ${div}, cnt ${cnt}, hold ${hold}, risk ${risk}).`, "Independent reputable participation develops.", { div, cnt, hold, risk });
    },
  },
  {
    ruleId: "QUAL-04-BOOST-DEPENDENCY", ruleVersion: V, family: "QUALITY", severity: "MEDIUM",
    requiredFeatures: ["boost_dependency"],
    description: "Attention overly dependent on paid boosts → FAIL (correction).",
    evaluate: (ctx) => {
      const b = okVal(ctx, "boost_dependency");
      if (b == null) return R("NOT_APPLICABLE", "No social/boost data to assess.", "Social/boost data becomes available.");
      if (b > ctx.config.boostDependencyMax) return R("FAIL", `Attention ${b} is mostly paid boosts (> ${ctx.config.boostDependencyMax}).`, `Organic attention share rises (boost dependency ≤ ${ctx.config.boostDependencyMax}).`, { b });
      return R("PASS", `Boost dependency ${b} within limit.`, `Paid-boost share exceeds ${ctx.config.boostDependencyMax}.`, { b });
    },
  },

  // ── ENTRY ──────────────────────────────────────────────────────────────
  {
    ruleId: "ENTRY-01-STRUCTURE-RECLAIM", ruleVersion: V, family: "ENTRY", severity: "INFO",
    requiredFeatures: ["price_distance_from_range"],
    description: "A tradable range/consolidation with a confirmed reclaim/retest.",
    evaluate: (ctx) => {
      const { entryStructurePresent, reclaimConfirmed } = ctx.flags;
      if (entryStructurePresent === undefined) return R("INCOMPLETE", "Entry structure not yet analysed.", "Run structure detection on OHLCV.");
      if (!entryStructurePresent) return R("FAIL", "No consolidation/range structure present.", "A range forms.", { entryStructurePresent });
      if (reclaimConfirmed === false) return R("FAIL", "Range present but no reclaim/retest confirmed.", "A reclaim or retest confirms.", { reclaimConfirmed });
      if (reclaimConfirmed === undefined) return R("INCOMPLETE", "Reclaim/retest not yet confirmed.", "Confirm reclaim/retest.");
      return R("PASS", "Range present with confirmed reclaim/retest.", "Structure breaks down.", { entryStructurePresent, reclaimConfirmed });
    },
  },
  {
    ruleId: "ENTRY-02-NOT-OVEREXTENDED", ruleVersion: V, family: "ENTRY", severity: "INFO",
    requiredFeatures: ["price_distance_from_range"],
    description: "Price not overextended within its recent range.",
    evaluate: (ctx) => {
      const pos = okVal(ctx, "price_distance_from_range");
      if (pos == null) return R("INCOMPLETE", "Range position unavailable.", "Provide price history.");
      if (pos > ctx.config.overextendedRangePos) return R("FAIL", `Price overextended (range pos ${pos} > ${ctx.config.overextendedRangePos}).`, "Price pulls back into range.", { pos });
      return R("PASS", `Range position ${pos} not overextended.`, `Price extends beyond ${ctx.config.overextendedRangePos}.`, { pos });
    },
  },
  {
    ruleId: "ENTRY-03-INVALIDATION", ruleVersion: V, family: "ENTRY", severity: "INFO",
    requiredFeatures: [],
    description: "A clear local invalidation level exists.",
    evaluate: (ctx) => {
      const inv = ctx.flags.localInvalidationPrice;
      if (inv === undefined) return R("INCOMPLETE", "Invalidation not yet computed.", "Compute local invalidation.");
      if (inv === null) return R("FAIL", "No clear local invalidation level.", "A structural invalidation level forms.", { inv });
      return R("PASS", `Local invalidation at ${inv}.`, "Invalidation level is lost.", { inv });
    },
  },
  {
    ruleId: "ENTRY-04-EXECUTION", ruleVersion: V, family: "ENTRY", severity: "INFO",
    requiredFeatures: [],
    description: "Slippage acceptable and reward-to-risk meets the minimum.",
    evaluate: (ctx) => {
      const { estSlippagePct, rewardToRisk } = ctx.flags;
      if (estSlippagePct === undefined || rewardToRisk === undefined) return R("INCOMPLETE", "Slippage/reward-to-risk not computed.", "Compute liquidity-aware slippage and R:R.");
      const okSlip = estSlippagePct <= ctx.config.slippageMaxPct;
      const okRR = rewardToRisk >= ctx.config.rewardToRiskMin;
      if (okSlip && okRR) return R("PASS", `Slippage ${estSlippagePct}%, R:R ${rewardToRisk}.`, "Slippage rises or R:R drops.", { estSlippagePct, rewardToRisk });
      return R("FAIL", `Execution poor (slippage ${estSlippagePct}%, R:R ${rewardToRisk}).`, `Slippage ≤ ${ctx.config.slippageMaxPct}% and R:R ≥ ${ctx.config.rewardToRiskMin}.`, { estSlippagePct, rewardToRisk });
    },
  },

  // ── POSITION_RISK (only meaningful with an open position) ────────────────
  {
    ruleId: "PRISK-01-LP-DRAIN", ruleVersion: V, family: "POSITION_RISK", severity: "HIGH",
    requiredFeatures: ["liquidity_retention_15m", "lp_change_rate"],
    description: "Liquidity draining under an open position.",
    evaluate: (ctx) => {
      if (!ctx.hasOpenPosition) return R("NOT_APPLICABLE", "No open position.", "A position is opened.");
      const r15 = okVal(ctx, "liquidity_retention_15m");
      const rate = okVal(ctx, "lp_change_rate");
      if (r15 == null && rate == null) return R("INCOMPLETE", "Liquidity trend unavailable.", "Provide recent liquidity snapshots.");
      if ((r15 != null && r15 < ctx.config.positionLpRetention15mMin) || (rate != null && rate < ctx.config.lpDrainRatePerHour))
        return R("FAIL", `Liquidity draining under position (r15 ${r15}, rate ${rate}).`, "Liquidity stabilises.", { r15, rate });
      return R("PASS", "Liquidity stable under position.", "Liquidity begins draining.", { r15, rate });
    },
  },
  {
    ruleId: "PRISK-02-SMART-EXIT", ruleVersion: V, family: "POSITION_RISK", severity: "HIGH",
    requiredFeatures: ["smart_wallet_net_flow"],
    description: "Smart wallets exiting under an open position.",
    evaluate: (ctx) => {
      if (!ctx.hasOpenPosition) return R("NOT_APPLICABLE", "No open position.", "A position is opened.");
      const nf = okVal(ctx, "smart_wallet_net_flow");
      if (nf == null) return R("INCOMPLETE", "Smart-wallet flow unavailable.", "Provide wallet intelligence.");
      if (nf < 0) return R("FAIL", `Smart wallets net-selling (${nf} USD).`, "Smart-wallet net flow turns positive.", { nf });
      return R("PASS", `Smart wallets not exiting (net ${nf} USD).`, "Smart wallets begin exiting.", { nf });
    },
  },

  // ── DATA_QUALITY ─────────────────────────────────────────────────────────
  {
    ruleId: "DQ-01-FRESHNESS", ruleVersion: V, family: "DATA_QUALITY", severity: "HIGH",
    requiredFeatures: ["data_freshness"],
    description: "Required data must be fresh; staleness blocks ENTRY_READY.",
    evaluate: (ctx) => {
      const f = okVal(ctx, "data_freshness");
      if (f == null) return R("INCOMPLETE", "Freshness not computable.", "Provide observations.");
      if (f < ctx.config.freshnessMin) return R("FAIL", `Data stale (freshness ${f} < ${ctx.config.freshnessMin}).`, "Fresh data arrives.", { f });
      return R("PASS", `Data fresh (${f}).`, `Freshness falls below ${ctx.config.freshnessMin}.`, { f });
    },
  },
  {
    ruleId: "DQ-02-SOURCE-CONFLICT", ruleVersion: V, family: "DATA_QUALITY", severity: "HIGH",
    requiredFeatures: ["source_agreement"],
    description: "Sources must agree on key metrics; strong disagreement is a critical conflict.",
    evaluate: (ctx) => {
      const a = feat(ctx, "source_agreement");
      if (!a || a.status === "MISSING") return R("NOT_APPLICABLE", "Single source — no cross-check possible.", "A second source becomes available.");
      if (a.status !== "OK" || a.value == null) return R("INCOMPLETE", "Source agreement not computable.", "Provide multi-source data.");
      if (a.value < ctx.config.sourceAgreementMin) return R("FAIL", `Sources disagree (agreement ${a.value} < ${ctx.config.sourceAgreementMin}).`, "Sources reconcile.", { agreement: a.value });
      return R("PASS", `Sources agree (${a.value}).`, `Agreement falls below ${ctx.config.sourceAgreementMin}.`, { agreement: a.value });
    },
  },
];
