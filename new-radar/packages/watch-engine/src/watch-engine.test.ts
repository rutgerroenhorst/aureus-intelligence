import { describe, it, expect } from "vitest";
import { fundamentalWatch, deriveStatus, entryReadinessRank, bestEntry, provisionalPlan, type WatchInput } from "./index.js";
import type { EntryResult, EntryProximity } from "@aureus/entry-engine";

const NOW = 1_800_000_000_000;
function wi(over: Partial<WatchInput> = {}): WatchInput {
  return {
    nowMs: NOW, coreSafety: "PASS", anySafetyFail: false, sellClass: "SELLABLE",
    holderTop10: 0.2, insiderPct: 0.15, deployerExposure: 0.1,
    mintAuthorityActive: false, freezeAuthorityActive: false,
    liquidityUsd: 40_000, liqTrend30m: 0.05, marketCapUsd: 200_000, volumeUsd: 120_000,
    buys: 600, sells: 400, pairAgeMs: 3 * 3600_000, freshnessMs: 30_000, advancedMissing: ["bundle_contamination"],
    ...over,
  };
}
const entry = { entryStructurePresent: true, reclaimConfirmed: false, localInvalidationPrice: 0.9, estSlippagePct: 2, rewardToRisk: 3, rationale: "", trigger: "", levels: { rangeLow: 0.9, rangeHigh: 1.1, rangePosition: 0.5, entry: 1, invalidation: 0.9, target: 1.3, pointsInWindow: 20 } } as EntryResult;
const prox = (stage: EntryProximity["stage"]): EntryProximity => ({ stage, confirmed: [], missing: ["x"], distancePct: 0.1, confirmations: 12, expiresInMs: 60_000 });

describe("fundamental watch — decision 1 (good coin?)", () => {
  it("healthy coin with no structure → WATCHABLE", () => {
    const f = fundamentalWatch(wi());
    expect(f.verdict).toBe("WATCHABLE");
    expect(f.qualityRank).toBeGreaterThan(50);
    expect(f.unknownRisks).toContain("bundle contamination");
  });
  it("confirmed sellability fail → REJECT", () => {
    expect(fundamentalWatch(wi({ sellClass: "CONFIRMED_SELLABILITY_FAIL" })).verdict).toBe("REJECT");
  });
  it("extreme concentration → REJECT", () => {
    expect(fundamentalWatch(wi({ holderTop10: 0.9 })).verdict).toBe("REJECT");
  });
  it("stale data → not watchable (OBSERVATION)", () => {
    expect(fundamentalWatch(wi({ freshnessMs: 20 * 60_000 })).verdict).toBe("OBSERVATION");
  });
  it("core safety INCOMPLETE but market healthy → still WATCHABLE (watch before entry)", () => {
    expect(fundamentalWatch(wi({ coreSafety: "INCOMPLETE" })).verdict).toBe("WATCHABLE");
  });
  it("any safety FAIL → REJECT", () => {
    expect(fundamentalWatch(wi({ anySafetyFail: true })).verdict).toBe("REJECT");
  });
  it("advanced unknowns are surfaced, not hidden", () => {
    expect(fundamentalWatch(wi({ advancedMissing: ["bundle_contamination", "wallet_clusters"] })).unknownRisks.length).toBe(2);
  });
});

describe("status derivation — two decisions combined", () => {
  const base = { fund: "WATCHABLE" as const, coreSafety: "PASS" as const, entryConfirmedRule: false, fresh: true, acceptableSlippage: true };
  it("watchable + no structure → FUNDAMENTAL_WATCH", () => {
    expect(deriveStatus({ ...base, prox: "NO_STRUCTURE" })).toBe("FUNDAMENTAL_WATCH");
  });
  it("watchable + base forming → SETUP_FORMING", () => {
    expect(deriveStatus({ ...base, prox: "BASE_FORMING" })).toBe("SETUP_FORMING");
  });
  it("watchable + reclaim pending → ENTRY_APPROACHING", () => {
    expect(deriveStatus({ ...base, prox: "RECLAIM_PENDING" })).toBe("ENTRY_APPROACHING");
  });
  it("entry confirmed + rules pass + core PASS → ENTRY_READY", () => {
    expect(deriveStatus({ ...base, prox: "ENTRY_CONFIRMED", entryConfirmedRule: true })).toBe("ENTRY_READY");
  });
  it("cannot be ENTRY_READY without core safety PASS", () => {
    expect(deriveStatus({ ...base, coreSafety: "INCOMPLETE", prox: "ENTRY_CONFIRMED", entryConfirmedRule: true })).not.toBe("ENTRY_READY");
  });
  it("cannot be ENTRY_READY without the entry rules confirmed", () => {
    expect(deriveStatus({ ...base, prox: "ENTRY_CONFIRMED", entryConfirmedRule: false })).not.toBe("ENTRY_READY");
  });
  it("overextended → TOO_EXTENDED", () => {
    expect(deriveStatus({ ...base, prox: "TOO_EXTENDED" })).toBe("TOO_EXTENDED");
  });
  it("reject verdict → REJECTED", () => {
    expect(deriveStatus({ ...base, fund: "REJECT", prox: "BASE_FORMING" })).toBe("REJECTED");
  });
});

describe("entry readiness rank + best entry + provisional plan", () => {
  it("readiness rises with proximity stage", () => {
    const near = entryReadinessRank(entry, prox("RECLAIM_PENDING"), 40_000);
    const far = entryReadinessRank(entry, prox("BASE_FORMING"), 40_000);
    expect(near).toBeGreaterThan(far);
  });
  it("breakout is not auto-preferred; reclaim/higher-low preferred", () => {
    expect(bestEntry("RECLAIM_PENDING", entry).type).toMatch(/reclaim|retest/);
    expect(bestEntry("HIGHER_LOW_FORMING", entry).type).toMatch(/higher-low/);
    expect(bestEntry("BREAKOUT_PENDING", entry).reason).toMatch(/chase distance stays low/);
  });
  it("plan is PROVISIONAL before ready, and levels come from real range", () => {
    const p = provisionalPlan(entry, prox("HIGHER_LOW_FORMING"), false);
    expect(p.provisional).toBe(true);
    expect(p.label).toMatch(/PROVISIONAL/);
    expect(p.invalidation).toBe(0.9);
    // A higher low is bought AT the higher low. This previously asserted 1.1 — the
    // range high — which is the level to sell into, not to buy, and is why every
    // suggestion arrived looking already extended.
    expect(p.entryAreaLow!).toBeGreaterThan(0.9);  // above the stop, never on it
  });
  it("labelled ENTRY PLAN once ready", () => {
    expect(provisionalPlan(entry, prox("ENTRY_CONFIRMED"), true).label).toBe("ENTRY PLAN");
  });
});

describe("structure confirmed but gate incomplete", () => {
  const base = { fund: "WATCHABLE" as const, coreSafety: "INCOMPLETE" as const, entryConfirmedRule: false, fresh: true, acceptableSlippage: true };
  it("ENTRY_CONFIRMED proximity without full gate → ENTRY_APPROACHING (not FUNDAMENTAL_WATCH)", () => {
    expect(deriveStatus({ ...base, prox: "ENTRY_CONFIRMED" })).toBe("ENTRY_APPROACHING");
  });
});

describe("every proximity stage with a shown plan has a named trigger", () => {
  const stages = ["BASE_FORMING","PULLBACK_FORMING","HIGHER_LOW_FORMING","BREAKOUT_PENDING","RETEST_PENDING","RECLAIM_PENDING","CONFIRMATION_PENDING","ENTRY_CONFIRMED"] as const;
  it("never reports 'none yet' for a stage that has structure", () => {
    for (const st of stages) {
      const be = bestEntry(st, entry);
      expect(be.type, `stage ${st}`).not.toBe("none yet");
    }
  });
  it("NO_STRUCTURE correctly reports no trigger", () => {
    expect(bestEntry("NO_STRUCTURE", entry).type).toBe("none yet");
  });
});

import { distributionRisk } from "./index.js";
describe("late-entry / distribution guard (the CATE-1 lesson)", () => {
  const di = (over = {}) => ({
    price: 1.05, rangeLow: 1.0, rangeHigh: 1.1, windowHigh: 1.1,
    buys: 600, sells: 400, prevBuys: 600, prevSells: 400,
    pairAgeMs: 2 * 3600_000, return30m: 0.02, ...over,
  });

  it("buying the top of the range is flagged as a late entry", () => {
    const r = distributionRisk(di({ price: 1.095 })); // ~95% of range
    expect(r.lateEntry).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/of range/);
  });
  it("mid-range entry is not a late entry", () => {
    expect(distributionRisk(di({ price: 1.03 })).lateEntry).toBe(false);
  });
  it("net selling is flagged as distribution", () => {
    const r = distributionRisk(di({ buys: 300, sells: 700 }));
    expect(r.distributing).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/sells/);
  });
  it("accelerating sell pressure is flagged even below the absolute threshold", () => {
    const r = distributionRisk(di({ buys: 480, sells: 520, prevBuys: 700, prevSells: 300 }));
    expect(r.distributing).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/rising/);
  });
  it("a faded impulse (bought the retrace of a dead move) is a late entry", () => {
    const r = distributionRisk(di({ price: 0.7, windowHigh: 1.1, rangeLow: 0.65, rangeHigh: 1.1 }));
    expect(r.lateEntry).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/impulse already faded/);
  });

  it("ENTRY_READY is BLOCKED when the entry is a late chase", () => {
    const base = { fund: "WATCHABLE" as const, coreSafety: "PASS" as const, prox: "ENTRY_CONFIRMED" as const,
      entryConfirmedRule: true, fresh: true, acceptableSlippage: true };
    expect(deriveStatus({ ...base })).toBe("ENTRY_READY");                        // clean
    expect(deriveStatus({ ...base, lateEntry: true })).not.toBe("ENTRY_READY");   // chase
    expect(deriveStatus({ ...base, distributing: true })).not.toBe("ENTRY_READY");// dumped into
  });
  it("blocked late-chase falls back to ENTRY_APPROACHING, never to a buy", () => {
    const r = deriveStatus({ fund: "WATCHABLE", coreSafety: "PASS", prox: "ENTRY_CONFIRMED",
      entryConfirmedRule: true, fresh: true, acceptableSlippage: true, lateEntry: true });
    expect(r).toBe("ENTRY_APPROACHING");
  });
});

// The entry area used to be the range HIGH in every case, so a coin that had pulled
// back was still quoted an entry at the top of its own range. That is why every
// suggestion looked extended: the level being offered was the one to sell into.
describe("the entry area follows the trade being set up", () => {
  const levels = (o: Partial<Record<string, number | null>> = {}) => ({
    rangeLow: 100, rangeHigh: 140, rangePosition: 0.25, entry: 110,
    invalidation: 104, target: 180, pointsInWindow: 40, ...o,
  });
  const res = (o = {}) => ({
    entryStructurePresent: true, reclaimConfirmed: false,
    localInvalidationPrice: 104, estSlippagePct: 0.1, rewardToRisk: 3,
    levels: levels(), ...o,
  } as never);
  const prox = (stage: string) => ({
    stage, confirmed: [], missing: ["confirmation"], distancePct: 0.2,
    confirmations: 40, expiresInMs: 60_000,
  } as never);

  it("a pull-back is bought at the higher low, not at the range high", () => {
    const p = provisionalPlan(res(), prox("HIGHER_LOW_FORMING"), false);
    expect(p.entryAreaLow!).toBeCloseTo(108, 1);   // just above the swing low, not on it
    expect(p.entryAreaHigh!).toBeLessThan(140);    // never the top of the range
    expect(p.entryAreaHigh!).toBeCloseTo(120, 1);
  });

  it("chasing a pull-back back into the range is capped", () => {
    const p = provisionalPlan(res(), prox("PULLBACK_FORMING"), false);
    expect(p.maxChase).toBe(120);                  // mid-range, not 8% above the high
  });

  it("a breakout retest is still bought at the level it broke", () => {
    const p = provisionalPlan(res(), prox("RETEST_PENDING"), false);
    expect(p.entryAreaLow).toBe(140);
    expect(p.maxChase!).toBeCloseTo(151.2, 1);
  });

  // A stop AT the entry price is a plan to be stopped out on entry. This must be a
  // strict inequality, not "less than or equal".
  it("the stop always sits strictly below the entry area", () => {
    for (const stage of ["HIGHER_LOW_FORMING", "PULLBACK_FORMING", "BASE_FORMING", "RETEST_PENDING"]) {
      const p = provisionalPlan(res(), prox(stage), false);
      expect(p.invalidation!, stage).toBeLessThan(p.entryAreaLow!);
    }
  });

  it("with no support level a pull-back falls back rather than inventing one", () => {
    const p = provisionalPlan(res({ levels: levels({ invalidation: null }) }), prox("PULLBACK_FORMING"), false);
    expect(p.entryAreaLow).toBe(140);   // no fabricated support
  });
});

// A launch-stage rug signal is a hard stop, not a score adjustment. An active mint
// authority or one wallet holding a fifth of the float ends the coin outright, and no
// amount of healthy liquidity or volume offsets it.
describe("a DANGER rug verdict rejects outright", () => {
  const healthy = {
    nowMs: 1_800_000_000_000, coreSafety: "PASS" as const, anySafetyFail: false,
    sellClass: "SELLABLE", holderTop10: 0.2, insiderPct: 0.1, deployerExposure: 0.02,
    mintAuthorityActive: false, freezeAuthorityActive: false,
    liquidityUsd: 40_000, liqTrend30m: 0.05, marketCapUsd: 120_000, volumeUsd: 90_000,
    buys: 300, sells: 250, pairAgeMs: 4 * 3.6e6, freshnessMs: 30_000, advancedMissing: [],
  };

  it("an otherwise perfect coin is WATCHABLE", () => {
    expect(fundamentalWatch(healthy).verdict).toBe("WATCHABLE");
  });

  it("DANGER overrides every healthy signal", () => {
    const r = fundamentalWatch({ ...healthy, rugVerdict: "DANGER", rugBlocking: ["one wallet holds 34%"] });
    expect(r.verdict).toBe("REJECT");
    expect(r.blocker).toBe("one wallet holds 34%");
  });

  it("the specific disqualifier is carried into the risks, not summarised away", () => {
    const r = fundamentalWatch({ ...healthy, rugVerdict: "DANGER", rugBlocking: ["mint authority still active — supply can be inflated"] });
    expect(r.knownRisks.join(" ")).toMatch(/supply can be inflated/);
  });

  it("WATCH and UNKNOWN do not reject — only DANGER does", () => {
    expect(fundamentalWatch({ ...healthy, rugVerdict: "WATCH" }).verdict).toBe("WATCHABLE");
    expect(fundamentalWatch({ ...healthy, rugVerdict: "UNKNOWN" }).verdict).toBe("WATCHABLE");
  });

  it("no rug data at all leaves the verdict unchanged", () => {
    expect(fundamentalWatch({ ...healthy, rugVerdict: null }).verdict).toBe("WATCHABLE");
  });
});
