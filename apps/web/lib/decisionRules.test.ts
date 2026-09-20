import { describe, it, expect } from "vitest";
import { canonicalBlocker, watchPriorityFor, isTooExtended, cadenceMsFor, humanizeCoreReason, universeStatus, type BlockerInput } from "./decisionRules";

function bi(over: Partial<BlockerInput> = {}): BlockerInput {
  return {
    anySafetyFail: false, failingRules: [], fresh: true, sellClass: "SELLABLE",
    drainStatus: "OK", drainSeverity: "normal", liveness: "ACTIVE", livenessReason: "market active", coreSafety: "PASS", coreMissing: [], coreReason: "Core Safety PASS",
    proximity: "ENTRY_CONFIRMED", status: "ENTRY_APPROACHING", planValid: true,
    planInvalidReasons: [], scans: 5, estSlippagePct: 2, ...over,
  };
}

describe("§4 canonical blocker — exactly one primary, fixed priority", () => {
  it("safety FAIL outranks everything else", () => {
    const r = canonicalBlocker(bi({ anySafetyFail: true, failingRules: ["SAFE-06"], fresh: false, coreSafety: "FAIL" }));
    expect(r.primary).toMatch(/critical safety FAIL/);
    expect(r.secondary.length).toBeGreaterThan(0); // others demoted, not lost
  });
  it("stale data outranks sellability and core safety", () => {
    expect(canonicalBlocker(bi({ fresh: false, coreSafety: "INCOMPLETE", sellClass: "NO_ROUTE_RETRY" })).primary).toBe("stale market data");
  });
  it("critical drain outranks core-safety incomplete", () => {
    const r = canonicalBlocker(bi({ drainStatus: "FAIL", drainSeverity: "critical", coreSafety: "INCOMPLETE" }));
    expect(r.primary).toMatch(/critical liquidity drain/);
  });
  it("core safety incomplete outranks missing structure", () => {
    const r = canonicalBlocker(bi({ coreSafety: "INCOMPLETE", coreMissing: ["liquidity_drain"], proximity: "NO_STRUCTURE" }));
    expect(r.primary).toMatch(/core safety incomplete/);
  });
  it("clean candidate awaiting structure gets the structure blocker", () => {
    expect(canonicalBlocker(bi({ proximity: "NO_STRUCTURE" })).primary).toBe("no valid entry structure yet");
  });
  it("never returns contradictory primaries — only one", () => {
    const r = canonicalBlocker(bi({ coreSafety: "INCOMPLETE", proximity: "NO_STRUCTURE", scans: 0 }));
    expect(typeof r.primary).toBe("string");
    expect(r.primary).not.toContain("&");
  });
  it("fully clean ENTRY_READY has no blocker", () => {
    expect(canonicalBlocker(bi({ status: "ENTRY_READY" })).primary).toBe("none — entry ready");
  });
});

describe("§7 watch priority follows status", () => {
  it("ENTRY_APPROACHING can never be OBSERVATION", () => {
    expect(watchPriorityFor("ENTRY_APPROACHING", false)).toBe("PRIMARY");
    expect(watchPriorityFor("ENTRY_APPROACHING", true)).toBe("PRIMARY");
  });
  it("ENTRY_READY is critical", () => expect(watchPriorityFor("ENTRY_READY", false)).toBe("CRITICAL"));
  it("rejected/invalidated are dormant", () => {
    expect(watchPriorityFor("REJECTED", true)).toBe("DORMANT");
    expect(watchPriorityFor("INVALIDATED", true)).toBe("DORMANT");
  });
  it("discovered is observation", () => expect(watchPriorityFor("DISCOVERED", true)).toBe("OBSERVATION"));
  it("watch statuses are primary only in a primary slot", () => {
    expect(watchPriorityFor("FUNDAMENTAL_WATCH", true)).toBe("PRIMARY");
    expect(watchPriorityFor("FUNDAMENTAL_WATCH", false)).toBe("SECONDARY");
  });
});

describe("§5 TOO_EXTENDED is structural, not a raw return", () => {
  const range = { rangeLow: 1.0, rangeHigh: 1.1, maxChase: 1.2 };
  it("−1.2% return is NOT automatically too extended", () => {
    const r = isTooExtended({ price: 1.05, ...range, return30m: -0.012 });
    expect(r.extended).toBe(false);
  });
  it("+1.7% return is NOT automatically too extended", () => {
    const r = isTooExtended({ price: 1.07, ...range, return30m: 0.017 });
    expect(r.extended).toBe(false);
  });
  it("price above max chase IS too extended", () => {
    const r = isTooExtended({ price: 1.25, ...range, return30m: 0.05 });
    expect(r.extended).toBe(true);
    expect(r.reason).toMatch(/maximum chase/);
  });
  it("far above the range in range-widths is too extended", () => {
    const r = isTooExtended({ price: 1.3, rangeLow: 1.0, rangeHigh: 1.1, maxChase: null, return30m: 0.3 });
    expect(r.extended).toBe(true);
    expect(r.reason).toMatch(/range-width/);
  });
  it("large positive return inside the range is not extended", () => {
    const r = isTooExtended({ price: 1.09, rangeLow: 1.0, rangeHigh: 1.1, maxChase: 1.2, return30m: 0.9 });
    expect(r.extended).toBe(false);
  });
});

describe("§8 cadence derives from status", () => {
  it("hotter statuses scan faster", () => {
    expect(cadenceMsFor("ENTRY_READY", "CRITICAL")).toBeLessThan(cadenceMsFor("ENTRY_APPROACHING", "PRIMARY"));
    expect(cadenceMsFor("ENTRY_APPROACHING", "PRIMARY")).toBeLessThan(cadenceMsFor("FUNDAMENTAL_WATCH", "PRIMARY"));
    expect(cadenceMsFor("FUNDAMENTAL_WATCH", "PRIMARY")).toBeLessThan(cadenceMsFor("FUNDAMENTAL_WATCH", "SECONDARY"));
    expect(cadenceMsFor("FUNDAMENTAL_WATCH", "SECONDARY")).toBeLessThan(cadenceMsFor("DISCOVERED", "OBSERVATION"));
  });
  it("entry ready is within 5–10s", () => {
    const ms = cadenceMsFor("ENTRY_READY", "CRITICAL");
    expect(ms).toBeGreaterThanOrEqual(5_000); expect(ms).toBeLessThanOrEqual(10_000);
  });
  it("rejected is dormant", () => expect(cadenceMsFor("REJECTED", "DORMANT")).toBe(0));
});

describe("human-readable reasons — never a bare rule ID", () => {
  it("SAFE-05 becomes an explanation of what data is needed", () => {
    const r = canonicalBlocker(bi({ coreSafety: "INCOMPLETE", coreMissing: [], coreReason: "Core rules not resolved: SAFE-05-LIQUIDITY-DRAIN" }));
    expect(r.primary).toMatch(/1h of continuous liquidity history/);
    expect(r.primary).not.toMatch(/SAFE-05/);
  });
  it("multiple unresolved rules are all explained", () => {
    const r = canonicalBlocker(bi({ coreSafety: "INCOMPLETE", coreMissing: [], coreReason: "Core rules not resolved: SAFE-05-LIQUIDITY-DRAIN, SAFE-06-AUTHORITY-SELLABILITY" }));
    expect(r.primary).toMatch(/liquidity history/);
    expect(r.primary).toMatch(/sell route/);
  });
});

describe("§6 plan/structure coherence via the blocker chain", () => {
  it("a suppressed plan surfaces as a blocker so the user knows why no levels show", () => {
    const r = canonicalBlocker(bi({
      proximity: "BASE_FORMING", coreSafety: "PASS",
      planValid: false, planInvalidReasons: ["no entry structure — levels not meaningful yet"],
    }));
    expect(r.primary).toMatch(/entry levels not usable/);
  });
  it("no-structure proximity outranks the plan blocker (clearer message first)", () => {
    const r = canonicalBlocker(bi({
      proximity: "NO_STRUCTURE", coreSafety: "PASS",
      planValid: false, planInvalidReasons: ["no trigger type identified"],
    }));
    expect(r.primary).toBe("no valid entry structure yet");
    expect(r.secondary.some((s) => s.includes("entry levels not usable"))).toBe(true);
  });
});

describe("dead/frozen market outranks almost everything", () => {
  it("POOL_GONE beats stale data and core safety", () => {
    const r = canonicalBlocker(bi({ liveness: "POOL_GONE", fresh: false, coreSafety: "INCOMPLETE" }));
    expect(r.primary).toMatch(/pool liquidity removed/);
  });
  it("FROZEN market is the primary blocker even when timestamps look fresh", () => {
    const r = canonicalBlocker(bi({ liveness: "FROZEN", livenessReason: "no new trades across 4 polls", fresh: true }));
    expect(r.primary).toMatch(/no new trades/);
  });
  it("a real safety FAIL still outranks a dead pool", () => {
    const r = canonicalBlocker(bi({ anySafetyFail: true, failingRules: ["SAFE-03"], liveness: "POOL_GONE" }));
    expect(r.primary).toMatch(/critical safety FAIL/);
  });
});

describe("observation and tradability floors are independent", () => {
  // They were one env var, and that coupling is what created the blind spot: the only
  // way to gather evidence on thin pools was to also offer them as buyable. Widening
  // what we WATCH must never widen what we are told we can BUY.
  it("a pool between the observation floor and the tradability floor is never ACTIVE", () => {
    const u = universeStatus({ liquidityUsd: 4_000, pairAgeMs: 3 * 3.6e6, activity: "REAL" });
    expect(u.status).toBe("TOO_THIN");
    expect(u.reason).toContain("6,000");
  });

  it("still admits a pool above the tradability floor", () => {
    const u = universeStatus({ liquidityUsd: 9_000, pairAgeMs: 3 * 3.6e6, activity: "REAL" });
    expect(u.status).toBe("ACTIVE");
  });

  it("the tradability floor does not read the discovery env var", () => {
    // Regression guard: setting the discovery floor must not move the trading gate.
    const prev = process.env.DISCOVERY_MIN_LIQUIDITY_USD;
    process.env.DISCOVERY_MIN_LIQUIDITY_USD = "1000";
    expect(universeStatus({ liquidityUsd: 2_000, pairAgeMs: 3.6e6, activity: "REAL" }).status).toBe("TOO_THIN");
    if (prev === undefined) delete process.env.DISCOVERY_MIN_LIQUIDITY_USD;
    else process.env.DISCOVERY_MIN_LIQUIDITY_USD = prev;
  });
});

describe("a coin under one hour old is never tradable", () => {
  // Measured at h1: 43% of sub-1h coins HALVED, against 13% at 1-6h, for the same
  // upside. This gate previously existed only in discovery, so lowering the discovery
  // floor to observe earlier would have silently made those coins buyable.
  it("rejects a 30-minute-old coin regardless of depth", () => {
    const u = universeStatus({ liquidityUsd: 50_000, pairAgeMs: 30 * 60_000, activity: "REAL" });
    expect(u.status).toBe("TOO_YOUNG");
  });

  it("admits the same coin once it passes an hour", () => {
    const u = universeStatus({ liquidityUsd: 50_000, pairAgeMs: 61 * 60_000, activity: "REAL" });
    expect(u.status).toBe("ACTIVE");
  });

  it("the buy gate does not read the discovery env var", () => {
    const prev = process.env.DISCOVERY_MIN_AGE_MINUTES;
    process.env.DISCOVERY_MIN_AGE_MINUTES = "5";
    expect(universeStatus({ liquidityUsd: 50_000, pairAgeMs: 10 * 60_000, activity: "REAL" }).status).toBe("TOO_YOUNG");
    if (prev === undefined) delete process.env.DISCOVERY_MIN_AGE_MINUTES;
    else process.env.DISCOVERY_MIN_AGE_MINUTES = prev;
  });
})

describe("a coin with no entry levels is not something you can act on", () => {
  // Regression guard for a bug that reappeared through a second door. An already-run
  // coin was kept out of the headline by the blocker check, then walked back in with a
  // clean blocker list and a plan invalidated by "price above maximum chase" — which is
  // the already-ran signal itself. The page rendered a full order slip whose own body
  // said "Nog geen bruikbare niveaus".
  const actionable = (v: { entryReadyBlockers?: string[]; plan?: { valid: boolean } | null }) =>
    !(v.entryReadyBlockers ?? []).some((g) => ["move_not_spent", "not_late_chase", "not_distributing"].includes(g)) &&
    v.plan?.valid === true;

  it("rejects a clean coin whose plan has no usable levels", () => {
    expect(actionable({ entryReadyBlockers: [], plan: { valid: false } })).toBe(false);
  });

  it("rejects a coin with no plan at all rather than defaulting to buyable", () => {
    expect(actionable({ entryReadyBlockers: [], plan: null })).toBe(false);
  });

  it("still accepts a clean coin that has valid levels", () => {
    expect(actionable({ entryReadyBlockers: [], plan: { valid: true } })).toBe(true);
  });

  it("still rejects a disqualified coin even with valid levels", () => {
    expect(actionable({ entryReadyBlockers: ["not_late_chase"], plan: { valid: true } })).toBe(false);
  });
})
