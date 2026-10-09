import { describe, it, expect } from "vitest";
import { safetyLayers, SAFETY_REQUIRED_DATASETS, ADVANCED_DATASETS, DATASET_REGISTRY } from "./index.js";

/** REGRESSION: Advanced On-chain unknowns must NEVER block CORE SAFETY PASS. */
describe("ENTRY_READY reachability — advanced must not gate core", () => {
  const coreAllOk = Object.fromEntries(SAFETY_REQUIRED_DATASETS.map((d) => [d, "OK"]));
  const advAllUnknown = Object.fromEntries(ADVANCED_DATASETS.map((d) => [d, "INCOMPLETE"]));
  const coreRulesPass = [
    { ruleId: "SAFE-02-BLACKLIST-FUNDING", result: "PASS" },
    { ruleId: "SAFE-03-INSIDER-CONCENTRATION", result: "PASS" },
    { ruleId: "SAFE-05-LIQUIDITY-DRAIN", result: "PASS" },
    { ruleId: "SAFE-06-AUTHORITY-SELLABILITY", result: "PASS" },
    // Advisory rules stay INCOMPLETE on the free tier — must not block.
    { ruleId: "SAFE-01-CRITICAL-DATA", result: "INCOMPLETE" },
    { ruleId: "SAFE-04-BUNDLE-CONTAMINATION", result: "INCOMPLETE" },
  ];

  it("no advanced dataset is registered as core-required", () => {
    for (const d of ADVANCED_DATASETS) expect(DATASET_REGISTRY[d]!.requiredForSafety).toBe(false);
  });

  it("CORE all OK + ADVANCED all INCOMPLETE → CORE SAFETY PASS", () => {
    const l = safetyLayers(coreRulesPass, { ...coreAllOk, ...advAllUnknown });
    expect(l.core).toBe("PASS");
    expect(l.advanced).toBe("INCOMPLETE");
    expect(l.advancedMissing.length).toBeGreaterThan(0); // unknowns stay visible
  });

  it("advanced unknowns remain visible even when core passes", () => {
    const l = safetyLayers(coreRulesPass, { ...coreAllOk, ...advAllUnknown });
    expect(l.advancedMissing).toEqual(expect.arrayContaining(["bundle_contamination"]));
  });

  it("a missing CORE dataset still blocks (thresholds unchanged)", () => {
    const l = safetyLayers(coreRulesPass, { ...coreAllOk, liquidity_drain: "INCOMPLETE", ...advAllUnknown });
    expect(l.core).toBe("INCOMPLETE");
    expect(l.requiredMissing).toContain("liquidity_drain");
  });
});

// NOT_APPLICABLE was introduced so checks only a paid indexer can answer stop posing
// as "pending". That is correct for ADVANCED datasets. It must never become a way for
// a CORE rule to pass an unanswered question.
describe("NOT_APPLICABLE cannot leak into Core Safety", () => {
  const ds = {
    supply: "OK", holders: "OK", holder_concentration: "OK", authorities: "OK",
    insider_concentration: "OK", sellability: "OK", liquidity_drain: "OK", deployer_funding: "OK",
  };
  const rules = (over: Record<string, string> = {}) =>
    Object.entries({
      "SAFE-02-BLACKLIST-FUNDING": "PASS",
      "SAFE-03-INSIDER-CONCENTRATION": "PASS",
      "SAFE-05-LIQUIDITY-DRAIN": "PASS",
      "SAFE-06-AUTHORITY-SELLABILITY": "PASS",
      ...over,
    }).map(([ruleId, result]) => ({ ruleId, result }));

  it("all core rules PASS → Core Safety PASS", () => {
    expect(safetyLayers(rules(), ds).core).toBe("PASS");
  });

  it("a core rule returning NOT_APPLICABLE does NOT pass — it is unresolved", () => {
    const r = safetyLayers(rules({ "SAFE-06-AUTHORITY-SELLABILITY": "NOT_APPLICABLE" }), ds);
    expect(r.core).not.toBe("PASS");
    expect(r.coreBlocker).toMatch(/SAFE-06/);
  });

  it("an ADVANCED rule returning NOT_APPLICABLE still lets Core Safety PASS", () => {
    const r = safetyLayers([...rules(), { ruleId: "SAFE-04-BUNDLE-CONTAMINATION", result: "NOT_APPLICABLE" }], ds);
    expect(r.core).toBe("PASS");
  });
});
