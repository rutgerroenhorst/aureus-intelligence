import { describe, it, expect } from "vitest";
import type { FeatureValue } from "@aureus/contracts";
import { evaluateRules, aggregate, reduceState, DEFAULT_RULE_CONFIG, type RuleContext, type RuleFlags } from "./index.js";
import { RULES, TIER_UNAVAILABLE_FEATURES } from "./rules.js";

const NOW = 1_753_000_000_000;

function f(featureId: string, value: number | null, status: FeatureValue["status"] = "OK"): FeatureValue {
  return {
    featureId, version: "0.1.0", status, value,
    unit: "x", calculatedAt: new Date(NOW).toISOString(), observationWindow: "instant",
    sourceInputs: [], dataQuality: 1, missingReason: null, explanation: "",
  };
}

/** Feature set that passes all safety + quality + entry checks. */
function greenFeatures(): Record<string, FeatureValue> {
  return {
    insider_concentration: f("insider_concentration", 0.1),
    holder_concentration: f("holder_concentration", 0.3),
    bundle_contamination: f("bundle_contamination", 0.05),
    deployer_funding_risk: f("deployer_funding_risk", 0.1),
    liquidity_retention_1h: f("liquidity_retention_1h", 1.0),
    liquidity_retention_6h: f("liquidity_retention_6h", 0.9),
    liquidity_retention_15m: f("liquidity_retention_15m", 1.0),
    lp_change_rate: f("lp_change_rate", 0.0),
    unique_buyer_growth: f("unique_buyer_growth", 1.5),
    buyer_seller_ratio: f("buyer_seller_ratio", 2.0),
    wallet_group_diversity: f("wallet_group_diversity", 0.4),
    smart_wallet_count: f("smart_wallet_count", 3),
    smart_wallet_hold_ratio: f("smart_wallet_hold_ratio", 0.9),
    smart_wallet_net_flow: f("smart_wallet_net_flow", 1000),
    boost_dependency: f("boost_dependency", 0.1),
    price_distance_from_range: f("price_distance_from_range", 0.4),
    data_freshness: f("data_freshness", 0.9),
    source_agreement: f("source_agreement", 0.95),
  };
}

function greenFlags(): RuleFlags {
  return {
    onChainAvailable: true, blacklistMatch: false, sellable: true,
    mintAuthorityActive: false, freezeAuthorityActive: false,
    entryStructurePresent: true, reclaimConfirmed: true,
    localInvalidationPrice: 0.9, estSlippagePct: 1.0, rewardToRisk: 3.0,
  };
}

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return { nowMs: NOW, features: greenFeatures(), flags: greenFlags(), config: DEFAULT_RULE_CONFIG, hasOpenPosition: false, ...over };
}

const opts = { hasOpenPosition: false, discoveryAtMs: NOW - 60_000, nowMs: NOW };

describe("safety gating", () => {
  it("missing Helius data prevents Safety PASSED (→ UNRESOLVED)", () => {
    const features = greenFeatures();
    for (const id of ["insider_concentration", "holder_concentration", "bundle_contamination", "deployer_funding_risk"]) {
      features[id] = f(id, null, "UNAVAILABLE");
    }
    const evals = evaluateRules(ctx({ features, flags: { ...greenFlags(), blacklistMatch: undefined, sellable: undefined, mintAuthorityActive: undefined, freezeAuthorityActive: undefined } }));
    expect(aggregate(evals).safety).toBe("INCOMPLETE");
    expect(reduceState(evals, opts).state).toBe("UNRESOLVED");
  });

  it("a hard FAIL cannot be compensated by positive rules (→ REJECTED)", () => {
    const features = greenFeatures();
    features.insider_concentration = f("insider_concentration", 0.9); // FAIL
    const evals = evaluateRules(ctx({ features }));
    expect(aggregate(evals).safety).toBe("FAILED");
    expect(reduceState(evals, opts).state).toBe("REJECTED");
  });
});

describe("ENTRY_READY conjunction", () => {
  it("all gates green → ENTRY_READY", () => {
    const d = reduceState(evaluateRules(ctx()), opts);
    expect(d.safetyStatus).toBe("PASSED");
    expect(d.qualityStatus).toBe("CONFIRMED");
    expect(d.entryStatus).toBe("READY");
    expect(d.state).toBe("ENTRY_READY");
  });

  it("stale data blocks ENTRY_READY (→ ENTRY_WATCH)", () => {
    const features = greenFeatures();
    features.data_freshness = f("data_freshness", 0.2); // below min → DQ freshness FAIL
    const d = reduceState(evaluateRules(ctx({ features })), opts);
    expect(d.state).toBe("ENTRY_WATCH");
    expect(d.reason).toMatch(/stale/i);
  });

  it("source conflict blocks ENTRY_READY (→ ENTRY_WATCH)", () => {
    const features = greenFeatures();
    features.source_agreement = f("source_agreement", 0.1); // conflict FAIL
    const d = reduceState(evaluateRules(ctx({ features })), opts);
    expect(d.state).toBe("ENTRY_WATCH");
  });

  it("overextension → OVEREXTENDED", () => {
    const features = greenFeatures();
    features.price_distance_from_range = f("price_distance_from_range", 0.98);
    const d = reduceState(evaluateRules(ctx({ features })), opts);
    expect(d.state).toBe("OVEREXTENDED");
  });
});

describe("intermediate states", () => {
  it("safety passed, weak quality → RESEARCHING", () => {
    const features = greenFeatures();
    features.unique_buyer_growth = f("unique_buyer_growth", 0.5);
    features.liquidity_retention_1h = f("liquidity_retention_1h", 0.4); // but this also risks drain FAIL
    features.liquidity_retention_6h = f("liquidity_retention_6h", 0.4);
    // keep drain safe: retention_1h 0.4 < 0.5 would FAIL safety. Use 0.6 to stay safe but fail quality.
    features.liquidity_retention_1h = f("liquidity_retention_1h", 0.6);
    features.wallet_group_diversity = f("wallet_group_diversity", 0.01);
    const d = reduceState(evaluateRules(ctx({ features })), opts);
    expect(d.safetyStatus).toBe("PASSED");
    expect(["RESEARCHING", "STRUCTURE_WATCH"]).toContain(d.state);
  });

  it("position risk under open position → POSITION_RISK", () => {
    const features = greenFeatures();
    features.liquidity_retention_15m = f("liquidity_retention_15m", 0.3); // drain under position
    const d = reduceState(evaluateRules(ctx({ features, hasOpenPosition: true })), { ...opts, hasOpenPosition: true });
    expect(d.state).toBe("POSITION_RISK");
  });
});

describe("determinism", () => {
  it("same input + same engine version → identical evaluations", () => {
    const c = ctx();
    expect(evaluateRules(c)).toEqual(evaluateRules(structuredClone(c)));
  });
});

// ── tier-gated data ─────────────────────────────────────────────────────────
// 13 features measured 0% OK across ~1,500 evaluations each — they need a paid
// indexer. Reporting them as INCOMPLETE told the user Core Safety was "pending",
// implying that waiting resolves it. It never does. But the fix must NOT become a
// way to wave through a coin whose obtainable data is genuinely missing.
describe("tier-gated data is distinguished from pending data", () => {
  const f = (status: string, value: number | null = 0.1) => ({ status, value } as never);
  const ctxWith = (features: Record<string, unknown>) => ({
    features, flags: {}, config: DEFAULT_RULE_CONFIG, nowMs: 1_800_000_000_000,
  } as never);
  const safe01 = RULES.find((r) => r.ruleId === "SAFE-01-CRITICAL-DATA")!;

  const obtainable = {
    insider_concentration: f("OK"), holder_concentration: f("OK"), deployer_funding_risk: f("OK"),
  };

  it("only paid-tier data missing → PASS, and it names what is unknown", () => {
    const r = safe01.evaluate(ctxWith({ ...obtainable, bundle_contamination: f("MISSING", null) }));
    expect(r.result).toBe("PASS");
    expect(r.explanation).toMatch(/bundle_contamination/);
    expect(r.explanation).toMatch(/paid indexer/);
  });

  it("obtainable data missing STILL blocks — the escape hatch is not a bypass", () => {
    const r = safe01.evaluate(ctxWith({
      ...obtainable, insider_concentration: f("MISSING", null), bundle_contamination: f("MISSING", null),
    }));
    expect(r.result).toBe("INCOMPLETE");
    expect(r.explanation).toMatch(/insider_concentration/);
  });

  it("everything present → plain PASS", () => {
    const r = safe01.evaluate(ctxWith({ ...obtainable, bundle_contamination: f("OK") }));
    expect(r.result).toBe("PASS");
    expect(r.explanation).not.toMatch(/paid indexer/);
  });

  it("the tier-unavailable set matches what was measured as never-resolving", () => {
    for (const id of ["bundle_contamination", "smart_wallet_count", "unique_buyer_growth", "attention_velocity"]) {
      expect(TIER_UNAVAILABLE_FEATURES.has(id), `${id} should be tier-gated`).toBe(true);
    }
    // Things we CAN measure must never be excused as tier-gated.
    for (const id of ["insider_concentration", "holder_concentration", "liquidity_retention_1h", "lp_change_rate"]) {
      expect(TIER_UNAVAILABLE_FEATURES.has(id), `${id} must NOT be tier-gated`).toBe(false);
    }
  });

  it("rules that can only be answered by buying data return NOT_APPLICABLE, not INCOMPLETE", () => {
    for (const id of ["SAFE-04-BUNDLE-CONTAMINATION", "QUAL-01-INDEPENDENT-DEMAND", "QUAL-03-SMART-PARTICIPATION"]) {
      const rule = RULES.find((r) => r.ruleId === id)!;
      const r = rule.evaluate(ctxWith({}));
      expect(r.result, `${id} should be NOT_APPLICABLE with no data`).toBe("NOT_APPLICABLE");
      expect(r.explanation).toMatch(/paid indexer|UNKNOWN RISK/);
    }
  });
});
