import { describe, it, expect } from "vitest";
import { buildIntel, type EnrichContext } from "./enrichment.js";

const NOW = 1_800_000_000_000;
function ctx(over: Partial<EnrichContext> = {}): EnrichContext {
  return {
    nowMs: NOW,
    supply: { amount: "1000", decimals: 0 },
    largest: [{ address: "a", amount: "400" }, { address: "b", amount: "100" }],
    mintAcc: { mintAuthority: null, freezeAuthority: null, supply: "1000", decimals: 0 },
    owners: new Map([["a", "W1"], ["b", "W2"]]),
    deployer: { creator: null, creationSig: null, reachedOldest: false, balanceRaw: null },
    sellQuotes: [],
    sellAttempts: 0,
    buyRouteExists: null,
    poolFresh: true,
    freezeActive: false,
    liqHistory: [],
    poolAddress: "POOL_VAULT",
    mint: "MINT_ADDR",
    prevDeployerExposure: null,
    ...over,
  };
}

describe("buildIntel (on-chain safety enrichment)", () => {
  it("computes raw top-10 holder concentration", () => {
    const r = buildIntel(ctx());
    expect(r.intel.onChain.available).toBe(true);
    expect(r.intel.onChain.holderTop10Pct).toBeCloseTo(0.5, 6);
    expect(r.datasets.holder_concentration!.status).toBe("OK");
  });

  it("active mint/freeze authority → authorities FAIL", () => {
    const r = buildIntel(ctx({ mintAcc: { mintAuthority: "SOMEONE", freezeAuthority: null, supply: "1000", decimals: 0 } }));
    expect(r.intel.flags.mintAuthorityActive).toBe(true);
    expect(r.datasets.authorities!.status).toBe("FAIL");
  });

  it("insider concentration uses unique beneficial owners", () => {
    const r = buildIntel(ctx({
      largest: [{ address: "a", amount: "300" }, { address: "a2", amount: "300" }, { address: "b", amount: "50" }],
      owners: new Map([["a", "W1"], ["a2", "W1"], ["b", "W2"]]), // a+a2 same owner
    }));
    expect(r.intel.onChain.insiderPct).toBeCloseTo(0.65, 6); // (600+50)/1000
    expect(r.datasets.insider_concentration!.status).toBe("OK");
  });

  it("confirmed honeypot (buy route, no sell, 2 attempts) → sellability FAIL", () => {
    const r = buildIntel(ctx({ buyRouteExists: true, poolFresh: true, sellAttempts: 2, sellQuotes: [
      { sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" },
      { sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" },
    ] }));
    expect(r.intel.flags.sellable).toBe(false);
    expect(r.datasets.sellability!.status).toBe("FAIL");
  });
  it("single failed sell route is NOT flagged honeypot (INCOMPLETE)", () => {
    const r = buildIntel(ctx({ buyRouteExists: null, sellAttempts: 1, sellQuotes: [{ sizeUsd: 50, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" }] }));
    expect(r.datasets.sellability!.status).toBe("INCOMPLETE");
    expect(r.intel.flags.sellable).toBeUndefined();
  });

  it("deployer unresolved → deployer_funding INCOMPLETE (never fabricated)", () => {
    const r = buildIntel(ctx());
    expect(r.datasets.deployer_funding!.status).toBe("INCOMPLETE");
    expect(r.intel.onChain.fundingRiskScore).toBeUndefined();
  });

  it("large deployer exposure → deployer_funding FAIL", () => {
    const r = buildIntel(ctx({ deployer: { creator: "DEP", creationSig: "sig", reachedOldest: true, balanceRaw: 700 } }));
    expect(r.datasets.deployer_funding!.status).toBe("FAIL");
    expect(r.intel.onChain.fundingRiskScore).toBeGreaterThan(0.5);
  });

  it("bundle stays INCOMPLETE without launch data (honest, not a guess)", () => {
    const r = buildIntel(ctx());
    expect(r.datasets.bundle_contamination!.status).toBe("INCOMPLETE");
  });

  it("critical liquidity drain → liquidity_drain FAIL", () => {
    const hist = [40000, 30000, 20000, 12000, 8000, 5000, 3000].map((v, i) => ({ atMs: NOW - (6 - i) * 3 * 60_000, liquidityUsd: v }));
    const r = buildIntel(ctx({ liqHistory: hist }));
    expect(r.datasets.liquidity_drain!.status).toBe("FAIL");
  });

  it("PARTIAL until every REQUIRED dataset is OK", () => {
    const r = buildIntel(ctx()); // deployer INCOMPLETE but not required; sellability UNAVAILABLE (required) → PARTIAL
    expect(r.statusOverall).toBe("PARTIAL");
  });

  it("is deterministic (stable response hash)", () => {
    expect(buildIntel(ctx()).responseHash).toBe(buildIntel(ctx()).responseHash);
  });
});

describe("LP vault / mint are never beneficial holders (real-world CATE-1 bug)", () => {
  it("excludes the pool vault from insider concentration", () => {
    // Reproduces CATE-1: pumpswap pool vault held 8.5% and was counted as an insider,
    // inflating concentration from ~2.5% to ~11% and risking a wrong REJECT.
    const r = buildIntel(ctx({
      supply: { amount: "1000", decimals: 0 },
      largest: [
        { address: "vault", amount: "850" },   // the pool itself
        { address: "w1", amount: "20" },
        { address: "w2", amount: "5" },
      ],
      owners: new Map([["vault", "POOL_VAULT"], ["w1", "W1"], ["w2", "W2"]]),
      poolAddress: "POOL_VAULT", mint: "MINT_ADDR",
    }));
    // raw top-10 still reports everything (transparency), insider excludes the vault
    expect(r.intel.onChain.holderTop10Pct).toBeCloseTo(0.875, 6);
    expect(r.intel.onChain.insiderPct).toBeCloseTo(0.025, 6); // 25/1000 — not 0.875
  });
  it("excludes the mint address too", () => {
    const r = buildIntel(ctx({
      supply: { amount: "1000", decimals: 0 },
      largest: [{ address: "m", amount: "500" }, { address: "w1", amount: "30" }],
      owners: new Map([["m", "MINT_ADDR"], ["w1", "W1"]]),
      poolAddress: null, mint: "MINT_ADDR",
    }));
    expect(r.intel.onChain.insiderPct).toBeCloseTo(0.03, 6);
  });
});
