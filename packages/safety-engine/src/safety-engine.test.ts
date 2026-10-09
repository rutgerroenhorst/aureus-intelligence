import { describe, it, expect } from "vitest";
import {
  analyzeLiquidityDrain, analyzeSellability, analyzeInsider, analyzeDeployer, analyzeBundle, analyzeWashTrading, analyzeRugRisk, analyzeDeployerWallet,
  SAFETY_REQUIRED_DATASETS, DATASET_REGISTRY, isImplemented, BURN_ADDRESSES,
} from "./index.js";

const NOW = 1_800_000_000_000;

describe("registry", () => {
  it("marks implemented datasets explicitly (no regex on reason strings)", () => {
    expect(isImplemented("sellability")).toBe(true);
    expect(isImplemented("deployer_sales")).toBe(false);
    expect(DATASET_REGISTRY.wallet_clusters!.implemented).toBe(false);
  });
  it("required-for-safety set excludes advisory datasets", () => {
    expect(SAFETY_REQUIRED_DATASETS).toContain("sellability");
    expect(SAFETY_REQUIRED_DATASETS).toContain("liquidity_drain");
    expect(SAFETY_REQUIRED_DATASETS).not.toContain("bundle_contamination");
    expect(SAFETY_REQUIRED_DATASETS).not.toContain("deployer_sales");
  });
});

describe("liquidity drain", () => {
  const pts = (vals: number[], stepMs = 60_000) => vals.map((v, i) => ({ atMs: NOW - (vals.length - 1 - i) * stepMs, liquidityUsd: v }));
  it("insufficient history → INCOMPLETE", () => {
    expect(analyzeLiquidityDrain(pts([40_000]), NOW).status).toBe("INCOMPLETE");
  });
  it("stable liquidity → OK", () => {
    // Needs enough span to actually measure the shortest (5m) horizon.
    expect(analyzeLiquidityDrain(pts([40_000, 40_500, 41_000, 40_800, 40_900, 40_700, 41_100, 40_950]), NOW).status).toBe("OK");
  });
  it("3 minutes of history cannot certify a 5-minute horizon → INCOMPLETE, not OK", () => {
    const r = analyzeLiquidityDrain(pts([40_000, 40_500, 41_000, 40_800]), NOW);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.severity).toBe("stale");
  });
  it("critical drain → FAIL and downgrade-worthy", () => {
    const r = analyzeLiquidityDrain(pts([40_000, 35_000, 30_000, 20_000, 15_000, 12_000, 8_000, 6_000, 5_000, 4_000], 3 * 60_000), NOW);
    expect(r.status).toBe("FAIL");
    expect(["critical", "pool_gone"]).toContain(r.severity);
  });
  it("pool gone → FAIL", () => {
    expect(analyzeLiquidityDrain(pts([40_000, 20_000, 100]), NOW).severity).toBe("pool_gone");
  });

  // Real capture: the worker stopped observing at 2026-07-28 20:01 and resumed
  // 2026-07-29 13:43. FRANK's nearest sample at-or-before "1h ago" was 17.8h old,
  // and the old code compared against it and published the result as an h1 drain.
  describe("observation gaps are never silently used as a baseline", () => {
    const GAP_MS = 17.8 * 60 * 60_000;
    /** Six fresh samples from the last ~5 min, plus a cluster from before a 17.8h hole. */
    const frank = [
      { atMs: NOW - GAP_MS - 120_000, liquidityUsd: 143_869 },
      { atMs: NOW - GAP_MS - 60_000, liquidityUsd: 147_390 },
      { atMs: NOW - GAP_MS, liquidityUsd: 154_896 },
      { atMs: NOW - 240_000, liquidityUsd: 107_924 },
      { atMs: NOW - 180_000, liquidityUsd: 109_007 },
      { atMs: NOW - 120_000, liquidityUsd: 107_845 },
      { atMs: NOW - 60_000, liquidityUsd: 106_136 },
      { atMs: NOW, liquidityUsd: 106_673 },
    ];

    it("refuses to publish an h1 number sourced from a 17.8h-old baseline", () => {
      const r = analyzeLiquidityDrain(frank, NOW);
      expect(r.horizons.h1).toBeNull();
      expect(r.unmeasured.join(" ")).toMatch(/h1: nearest baseline is \d+m old/);
    });

    it("reports the observation hole so the gap is visible, not inferred", () => {
      expect(analyzeLiquidityDrain(frank, NOW).maxGapMs).toBeGreaterThan(17 * 60 * 60_000);
    });

    it("with every horizon spanning the gap, drain is INCOMPLETE — never a clean OK", () => {
      // Only the ~5 min of fresh samples exist post-gap, so m15/m30/h1/h6 all reach back across it.
      const r = analyzeLiquidityDrain(frank, NOW);
      expect(r.status).toBe("INCOMPLETE");
      expect(r.severity).toBe("stale");
      expect(r.reason).toMatch(/No measurable drain horizon/);
    });

    it("sinceDiscovery still spans the gap but must not drive severity", () => {
      const r = analyzeLiquidityDrain(frank, NOW);
      expect(r.horizons.sinceDiscovery).toBeLessThan(-0.25); // -31%, would have read as 'warning'
      expect(r.severity).toBe("stale");                       // yet severity is honest instead
    });

    it("a dead pool is still FAIL even when the history has a hole", () => {
      const dead = [...frank.slice(0, 3), { atMs: NOW, liquidityUsd: 120 }];
      const r = analyzeLiquidityDrain(dead, NOW);
      expect(r.severity).toBe("pool_gone");
      expect(r.status).toBe("FAIL");
    });

    it("a continuously-observed pool still measures every horizon", () => {
      const continuous = Array.from({ length: 80 }, (_, i) => ({
        atMs: NOW - (79 - i) * 5 * 60_000, liquidityUsd: 100_000 + i * 10,
      }));
      const r = analyzeLiquidityDrain(continuous, NOW);
      expect(r.unmeasured).toEqual([]);
      expect(r.horizons.h1).not.toBeNull();
      expect(r.status).toBe("OK");
    });

    it("a sparse but genuinely-watched series is accepted inside tolerance", () => {
      // Change-based persistence writes rarely when liquidity is flat; a 1h baseline
      // that is 70 min old is a real reading, not a gap.
      const sparse = [
        { atMs: NOW - 70 * 60_000, liquidityUsd: 50_000 },
        { atMs: NOW - 20 * 60_000, liquidityUsd: 50_400 },
        { atMs: NOW, liquidityUsd: 50_200 },
      ];
      const r = analyzeLiquidityDrain(sparse, NOW);
      expect(r.horizons.h1).not.toBeNull();
      expect(r.status).toBe("OK");
    });
  });
});

describe("sellability (classified)", () => {
  const routedQ = [{ sizeUsd: 50, outUsd: 49, priceImpactPct: 1.2, routed: true }, { sizeUsd: 500, outUsd: 470, priceImpactPct: 4.0, routed: true }];
  const noRoute = [{ sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" }, { sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" }];
  it("CONFIRMED FAIL only with buy route + fresh + ≥2 attempts", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: noRoute, buyRouteExists: true, poolFresh: true, attempts: 2 });
    expect(r.classification).toBe("CONFIRMED_SELLABILITY_FAIL"); expect(r.status).toBe("FAIL"); expect(r.sellable).toBe(false);
  });
  it("single failed route is NOT a honeypot → NO_ROUTE_RETRY (INCOMPLETE)", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: [noRoute[0]!], buyRouteExists: null, poolFresh: true, attempts: 1 });
    expect(r.classification).toBe("NO_ROUTE_RETRY"); expect(r.status).toBe("INCOMPLETE"); expect(r.sellable).toBeNull();
  });
  it("no route but no buy route either → not confirmed (retry)", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: noRoute, buyRouteExists: false, poolFresh: true, attempts: 2 });
    expect(r.classification).toBe("NO_ROUTE_RETRY"); expect(r.status).toBe("INCOMPLETE");
  });
  it("temporary API error → INDEXING_UNKNOWN (INCOMPLETE), never a FAIL", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: [{ sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "timeout" }], buyRouteExists: true, poolFresh: true, attempts: 2 });
    expect(r.classification).toBe("INDEXING_UNKNOWN"); expect(r.status).toBe("INCOMPLETE");
  });
  it("routed low impact → SELLABLE (OK)", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: routedQ, buyRouteExists: true, poolFresh: true, attempts: 1 });
    expect(r.classification).toBe("SELLABLE"); expect(r.status).toBe("OK"); expect(r.sellable).toBe(true); expect(r.maxReasonableSizeUsd).toBe(500);
  });
  it("smallest size already high impact → INSUFFICIENT_LIQUIDITY (not FAIL)", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: [{ sizeUsd: 50, outUsd: 30, priceImpactPct: 40, routed: true }], buyRouteExists: true, poolFresh: true, attempts: 1, maxImpactPct: 35 });
    expect(r.classification).toBe("INSUFFICIENT_LIQUIDITY"); expect(r.status).toBe("INCOMPLETE");
  });
  it("active freeze authority → CONFIRMED FAIL", () => {
    const r = analyzeSellability({ nowMs: NOW, freezeAuthorityActive: true, quotes: routedQ, buyRouteExists: true, poolFresh: true, attempts: 1 });
    expect(r.status).toBe("FAIL"); expect(r.classification).toBe("CONFIRMED_SELLABILITY_FAIL");
  });
  it("no quote data → UNAVAILABLE (not fabricated)", () => {
    expect(analyzeSellability({ nowMs: NOW, freezeAuthorityActive: false, quotes: [], buyRouteExists: null, poolFresh: false, attempts: 0 }).status).toBe("UNAVAILABLE");
  });
});

describe("insider concentration (unique owners)", () => {
  const supply = 1_000_000;
  it("aggregates multiple token accounts of the same owner", () => {
    const r = analyzeInsider({ nowMs: NOW, supplyRaw: supply, holdings: [
      { tokenAccount: "ta1", owner: "W1", amountRaw: 100_000 },
      { tokenAccount: "ta2", owner: "W1", amountRaw: 100_000 }, // same owner → merged
      { tokenAccount: "ta3", owner: "W2", amountRaw: 50_000 },
    ] });
    expect(r.status).toBe("OK");
    // W1 = 200k/1M = 0.2 ; unique top-10 includes W1+W2 = 0.25
    expect(r.uniqueOwnerTop10Pct).toBeCloseTo(0.25, 6);
  });
  it("excludes LP/burn/system owners from beneficial concentration", () => {
    const burn = [...BURN_ADDRESSES][0]!;
    const r = analyzeInsider({ nowMs: NOW, supplyRaw: supply, holdings: [
      { tokenAccount: "lp", owner: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", amountRaw: 600_000 }, // Raydium vault
      { tokenAccount: "b", owner: burn, amountRaw: 100_000 },
      { tokenAccount: "w", owner: "W1", amountRaw: 50_000 },
    ] });
    expect(r.uniqueOwnerTop10Pct).toBeCloseTo(0.05, 6); // only W1 counts
    expect(r.excludedPct).toBeCloseTo(0.7, 6);
  });
  it("too much unresolved ownership → INCOMPLETE (UNKNOWN, not guessed)", () => {
    const r = analyzeInsider({ nowMs: NOW, supplyRaw: supply, holdings: [
      { tokenAccount: "ta1", owner: null, amountRaw: 300_000 },
      { tokenAccount: "ta2", owner: "W1", amountRaw: 50_000 },
    ] });
    expect(r.status).toBe("INCOMPLETE");
  });
});

describe("deployer", () => {
  it("creation not reached → INCOMPLETE", () => {
    expect(analyzeDeployer({ nowMs: NOW, creator: null, creationSig: null, reachedOldest: false, deployerBalanceRaw: null, supplyRaw: 1_000_000 }).status).toBe("INCOMPLETE");
  });
  it("large deployer supply exposure → FAIL with evidence", () => {
    const r = analyzeDeployer({ nowMs: NOW, creator: "DEP", creationSig: "sig", reachedOldest: true, deployerBalanceRaw: 700_000, supplyRaw: 1_000_000 });
    expect(r.status).toBe("FAIL"); expect(r.deployerExposurePct).toBeCloseTo(0.7, 6);
    expect(r.fundingRiskScore).toBeGreaterThan(0.5);
  });
  it("small exposure → OK", () => {
    expect(analyzeDeployer({ nowMs: NOW, creator: "DEP", creationSig: "sig", reachedOldest: true, deployerBalanceRaw: 20_000, supplyRaw: 1_000_000 }).status).toBe("OK");
  });
});

describe("bundle", () => {
  it("no launch data → INCOMPLETE (never FAIL on proximity alone)", () => {
    expect(analyzeBundle({ nowMs: NOW, earlyBuys: [], supplyRaw: 1_000_000, hasLaunchData: false }).status).toBe("INCOMPLETE");
  });
  it("coordinated same-funder cluster → measurable bundled supply", () => {
    const r = analyzeBundle({ nowMs: NOW, supplyRaw: 1_000_000, hasLaunchData: true, minClusterWallets: 3, earlyBuys: [
      { wallet: "a", funder: "F1", amountRaw: 100_000, slot: 1 },
      { wallet: "b", funder: "F1", amountRaw: 100_000, slot: 1 },
      { wallet: "c", funder: "F1", amountRaw: 100_000, slot: 2 },
      { wallet: "d", funder: "F2", amountRaw: 50_000, slot: 3 },
    ] });
    expect(r.status).toBe("OK");
    expect(r.bundleSupplyPct).toBeCloseTo(0.3, 6); // F1 cluster only
    expect(r.connectedLaunchWallets).toBe(3);
  });
});

import { effectiveSafety } from "./effective.js";
describe("effective safety (registry-aware ACTIONABLE gate)", () => {
  const okDatasets = { insider_concentration: "OK", holder_concentration: "OK", authorities: "OK", sellability: "OK", liquidity_drain: "OK", supply: "OK", holders: "OK", bundle_contamination: "INCOMPLETE", deployer_funding: "OK" };
  const passRules = [
    { ruleId: "SAFE-02-BLACKLIST-FUNDING", result: "PASS" },
    { ruleId: "SAFE-03-INSIDER-CONCENTRATION", result: "PASS" },
    { ruleId: "SAFE-05-LIQUIDITY-DRAIN", result: "PASS" },
    { ruleId: "SAFE-06-AUTHORITY-SELLABILITY", result: "PASS" },
    { ruleId: "SAFE-01-CRITICAL-DATA", result: "INCOMPLETE" },
    { ruleId: "SAFE-04-BUNDLE-CONTAMINATION", result: "INCOMPLETE" },
  ];
  it("required PASS + advisory bundle INCOMPLETE → PASS (actionable reachable)", () => {
    expect(effectiveSafety(passRules, okDatasets).status).toBe("PASS");
  });
  it("any safety rule FAIL → FAIL", () => {
    const r = effectiveSafety([...passRules, { ruleId: "SAFE-06-AUTHORITY-SELLABILITY", result: "FAIL" }], okDatasets);
    expect(r.status).toBe("FAIL");
  });
  it("missing REQUIRED dataset → INCOMPLETE (never PASS)", () => {
    expect(effectiveSafety(passRules, { ...okDatasets, sellability: "UNAVAILABLE" }).status).toBe("INCOMPLETE");
  });
  it("required value-rule still INCOMPLETE → INCOMPLETE", () => {
    const r = effectiveSafety(passRules.map((x) => x.ruleId === "SAFE-03-INSIDER-CONCENTRATION" ? { ...x, result: "INCOMPLETE" } : x), okDatasets);
    expect(r.status).toBe("INCOMPLETE");
  });
});

// ── wash trading ────────────────────────────────────────────────────────────
// Both of these were sitting on the live watchlist — KEKODYSSEUS at ENTRY_APPROACHING —
// with holder concentrations that read as perfectly healthy. Bundling is designed to
// defeat the concentration check; the shape of the flow is what it cannot fake.
describe("wash trading / manufactured activity", () => {
  it("KEKODYSSEUS: $14k of volume against a $64k pool is PARKED, not a market", () => {
    // $8.16 a trade is small but not unambiguous dust, so this is NOT labelled a wash —
    // what IS proven is that the pool barely turns over. Calling it DUST_WASH would be
    // moving a threshold to fit a label rather than reporting what the data supports.
    const r = analyzeWashTrading({ liquidityUsd: 63_996, volume24Usd: 14_233, buys: 947, sells: 797 });
    expect(r.activity).toBe("PARKED");
    expect(r.turnover!).toBeCloseTo(0.22, 2);
    expect(r.avgTradeUsd!).toBeCloseTo(8.16, 1);
    expect(r.reasons.join(" ")).toMatch(/money parked/);
  });

  it("WSOLP: $642 of volume across 2,800 trades on an $88k pool", () => {
    const r = analyzeWashTrading({ liquidityUsd: 87_815, volume24Usd: 642, buys: 1675, sells: 1125 });
    expect(r.activity).toBe("DUST_WASH");
    expect(r.avgTradeUsd!).toBeLessThan(0.5);   // nobody trades 23 cents
    expect(r.turnover!).toBeLessThan(0.01);
  });

  it("a genuinely traded coin is REAL", () => {
    // GINNAN, 3.8h old: $46,950 pool, $1,081,222 volume.
    const r = analyzeWashTrading({ liquidityUsd: 46_950, volume24Usd: 1_081_222, buys: 4200, sells: 3800 });
    expect(r.activity).toBe("REAL");
    expect(r.turnover!).toBeGreaterThan(20);
    expect(r.reasons).toEqual([]);
  });

  it("a big pool with no volume is PARKED even when trades are normal-sized", () => {
    const r = analyzeWashTrading({ liquidityUsd: 200_000, volume24Usd: 20_000, buys: 40, sells: 30 });
    expect(r.activity).toBe("PARKED");
    expect(r.reasons.join(" ")).toMatch(/money parked/);
  });

  it("a few small trades on a young pair is not called wash trading", () => {
    // Below the tx floor: a handful of small fills is normal, not manufactured.
    const r = analyzeWashTrading({ liquidityUsd: 40_000, volume24Usd: 120_000, buys: 12, sells: 8 });
    expect(r.activity).toBe("REAL");
  });

  it("both PARKED and DUST_WASH disqualify — neither is a tradeable market", () => {
    for (const c of [
      { liquidityUsd: 63_996, volume24Usd: 14_233, buys: 947, sells: 797 },   // KEKODYSSEUS
      { liquidityUsd: 87_815, volume24Usd: 642, buys: 1675, sells: 1125 },    // WSOLP
    ]) {
      expect(["PARKED", "DUST_WASH"]).toContain(analyzeWashTrading(c).activity);
    }
  });

  it("unknown depth or volume is UNKNOWN, never REAL", () => {
    expect(analyzeWashTrading({ liquidityUsd: null, volume24Usd: 5000, buys: 10, sells: 10 }).activity).toBe("UNKNOWN");
    expect(analyzeWashTrading({ liquidityUsd: 50_000, volume24Usd: null, buys: 10, sells: 10 }).activity).toBe("UNKNOWN");
  });

  it("bundling defeats holder concentration but not the flow shape", () => {
    // KEKODYSSEUS reported a top-10 of 17% — healthier than most of the fleet.
    // The concentration check passes it; the activity check does not.
    const healthyLookingConcentration = 0.17;
    expect(healthyLookingConcentration).toBeLessThan(0.30);
    // Concentration says "fine". Activity says the market is not real. Either verdict
    // alone would have let this onto the watchlist, which is exactly what happened.
    expect(analyzeWashTrading({ liquidityUsd: 63_996, volume24Usd: 14_233, buys: 947, sells: 797 }).activity)
      .not.toBe("REAL");
  });
});

// ── rug risk at $5-50k ──────────────────────────────────────────────────────
describe("rug risk on a brand-new coin", () => {
  const base = {
    mintAuthorityActive: false, freezeAuthorityActive: false,
    ownerShares: [0.08, 0.05, 0.04, 0.03, 0.02], deployerShare: 0.01,
    activity: "REAL" as const,
  };

  it("a clean launch reads CLEAN", () => {
    // The live probe of a real $10k coin: authorities revoked, largest wallet 8.4%.
    const r = analyzeRugRisk(base);
    expect(r.verdict).toBe("CLEAN");
    expect(r.largestHolderPct).toBeCloseTo(0.08, 2);
    expect(r.top5Pct).toBeCloseTo(0.22, 2);
    expect(r.blocking).toEqual([]);
  });

  it("an active mint authority is disqualifying on its own", () => {
    const r = analyzeRugRisk({ ...base, mintAuthorityActive: true });
    expect(r.verdict).toBe("DANGER");
    expect(r.blocking.join(" ")).toMatch(/supply can be inflated/);
  });

  it("an active freeze authority is disqualifying on its own", () => {
    expect(analyzeRugRisk({ ...base, freezeAuthorityActive: true }).verdict).toBe("DANGER");
  });

  it("one wallet above 20% ends the coin regardless of everything else", () => {
    const r = analyzeRugRisk({ ...base, ownerShares: [0.28, 0.03, 0.02] });
    expect(r.verdict).toBe("DANGER");
    expect(r.blocking.join(" ")).toMatch(/a single exit ends this/);
  });

  it("a large-but-not-fatal wallet is a concern, not a block", () => {
    const r = analyzeRugRisk({ ...base, ownerShares: [0.15, 0.04, 0.03] });
    expect(r.verdict).toBe("WATCH");
    expect(r.blocking).toEqual([]);
    expect(r.concerns.join(" ")).toMatch(/largest wallet 15%/);
  });

  it("a nominal float (top 5 above 60%) is disqualifying", () => {
    expect(analyzeRugRisk({ ...base, ownerShares: [0.18, 0.17, 0.15, 0.10, 0.05] }).verdict).toBe("DANGER");
  });

  it("a deployer still holding 10%+ is disqualifying", () => {
    const r = analyzeRugRisk({ ...base, deployerShare: 0.14 });
    expect(r.verdict).toBe("DANGER");
    expect(r.blocking.join(" ")).toMatch(/deployer still holds/);
  });

  it("a washed or parked market blocks even with perfect holders", () => {
    expect(analyzeRugRisk({ ...base, activity: "DUST_WASH" }).verdict).toBe("DANGER");
    expect(analyzeRugRisk({ ...base, activity: "PARKED" }).verdict).toBe("DANGER");
  });

  // Missing data is the normal state minutes after launch, and it must never read as safe.
  it("unknown authorities are UNKNOWN, never CLEAN", () => {
    expect(analyzeRugRisk({ ...base, mintAuthorityActive: null }).verdict).toBe("UNKNOWN");
    expect(analyzeRugRisk({ ...base, freezeAuthorityActive: null }).verdict).toBe("UNKNOWN");
  });

  it("no holder data at all is UNKNOWN, never CLEAN", () => {
    const r = analyzeRugRisk({ ...base, ownerShares: [] });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.concerns.join(" ")).toMatch(/not yet available/);
  });

  it("a real danger still reads DANGER even when other data is missing", () => {
    // DANGER outranks UNKNOWN: a known disqualifier is not softened by an unknown.
    const r = analyzeRugRisk({ ...base, mintAuthorityActive: null, ownerShares: [0.4] });
    expect(r.verdict).toBe("DANGER");
  });
});

// Measured on real deployers. Finding a creator's PREVIOUS launches was tried and
// abandoned — getAssetsByCreator returns nothing for pump.fun mints, and sampling
// transaction history cost 13 RPC calls and found zero prior mints in 12 samples.
describe("deployer wallet profile", () => {
  const P = 500;

  it("2 transactions over 3 days is a wallet made for this launch", () => {
    const r = analyzeDeployerWallet({ txCount: 2, pageLimit: P, historyDays: 3.2 });
    // 3.2 days is past the 2-day floor, so this is YOUNG rather than THROWAWAY.
    expect(r.profile).toBe("YOUNG");
    expect(r.blocking).toBe(false);
  });

  it("a wallet hours old with a handful of transactions is a throwaway", () => {
    const r = analyzeDeployerWallet({ txCount: 4, pageLimit: P, historyDays: 0.3 });
    expect(r.profile).toBe("THROWAWAY");
    expect(r.blocking).toBe(true);
    expect(r.reason).toMatch(/made for this launch/);
  });

  it("500 transactions over 108 days is someone with a history to lose", () => {
    const r = analyzeDeployerWallet({ txCount: 500, pageLimit: P, historyDays: 108.3 });
    expect(r.profile).toBe("ESTABLISHED");
    expect(r.blocking).toBe(false);
  });

  // The one that surprises: a very high tx count normally reads as "established".
  it("500 transactions inside one day is automation, not an established founder", () => {
    const r = analyzeDeployerWallet({ txCount: 500, pageLimit: P, historyDays: 0.0 });
    expect(r.profile).toBe("HIGH_FREQUENCY");
    expect(r.blocking).toBe(true);
    expect(r.reason).toMatch(/automation, not a founder/);
  });

  it("a busy but not frantic wallet is established, not automation", () => {
    expect(analyzeDeployerWallet({ txCount: 500, pageLimit: P, historyDays: 13.2 }).profile).toBe("ESTABLISHED");
  });

  it("missing history is UNKNOWN and never blocks on its own", () => {
    const r = analyzeDeployerWallet({ txCount: null, pageLimit: P, historyDays: null });
    expect(r.profile).toBe("UNKNOWN");
    expect(r.blocking).toBe(false);
  });
});
