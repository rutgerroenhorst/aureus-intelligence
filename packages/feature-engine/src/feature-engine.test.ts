import { describe, it, expect } from "vitest";
import { runFeatureEngine, FEATURE_CATALOG, type FeatureInput } from "./index.js";

const NOW = 1_753_000_000_000; // fixed epoch ms
const min = (n: number) => n * 60_000;

function baseInput(over: Partial<FeatureInput> = {}): FeatureInput {
  return {
    nowMs: NOW,
    discoveryAtMs: NOW - min(60),
    liquidity: [],
    prices: [],
    txAggregates: [],
    holders: [],
    social: [],
    onChain: { available: false },
    sourcesPresent: [],
    ...over,
  };
}

function byId(features: ReturnType<typeof runFeatureEngine>, id: string) {
  const f = features.find((x) => x.featureId === id);
  if (!f) throw new Error(`feature ${id} not produced`);
  return f;
}

describe("feature engine coverage", () => {
  it("produces exactly the cataloged features, in order", () => {
    const out = runFeatureEngine(baseInput());
    expect(out.map((f) => f.featureId)).toEqual(FEATURE_CATALOG.map((c) => c.featureId));
    expect(out.length).toBe(24);
  });
});

describe("missing / unavailable / stale — never fabricated", () => {
  it("on-chain features are UNAVAILABLE without Helius", () => {
    const out = runFeatureEngine(baseInput());
    for (const id of ["deployer_funding_risk", "insider_concentration", "bundle_contamination", "smart_wallet_count"]) {
      const f = byId(out, id);
      expect(f.status).toBe("UNAVAILABLE");
      expect(f.value).toBeNull();
    }
  });

  it("liquidity retention is MISSING without a baseline point", () => {
    const out = runFeatureEngine(baseInput({ liquidity: [{ observedAtMs: NOW, liquidityUsd: 1000, source: "dexscreener" }] }));
    expect(byId(out, "liquidity_retention_1h").status).toBe("MISSING");
  });

  it("liquidity retention is STALE when the latest point is too old", () => {
    const out = runFeatureEngine(baseInput({
      liquidity: [
        { observedAtMs: NOW - min(70), liquidityUsd: 1000, source: "dexscreener" },
        { observedAtMs: NOW - min(10), liquidityUsd: 900, source: "dexscreener" }, // >2m ttl → stale
      ],
    }));
    expect(byId(out, "liquidity_retention_1h").status).toBe("STALE");
  });

  it("source_agreement is MISSING with a single source", () => {
    const out = runFeatureEngine(baseInput({ liquidity: [{ observedAtMs: NOW, liquidityUsd: 1000, source: "dexscreener" }] }));
    expect(byId(out, "source_agreement").status).toBe("MISSING");
  });
});

describe("numeric correctness", () => {
  it("computes liquidity retention as current/baseline", () => {
    const out = runFeatureEngine(baseInput({
      liquidity: [
        { observedAtMs: NOW - min(60), liquidityUsd: 1000, source: "dexscreener" },
        { observedAtMs: NOW, liquidityUsd: 800, source: "dexscreener" },
      ],
    }));
    const f = byId(out, "liquidity_retention_1h");
    expect(f.status).toBe("OK");
    expect(f.value).toBeCloseTo(0.8, 6);
  });

  it("computes marketcap_liquidity_ratio", () => {
    const out = runFeatureEngine(baseInput({
      prices: [{ observedAtMs: NOW, priceUsd: 1, marketCapUsd: 500_000, source: "dexscreener" }],
      liquidity: [{ observedAtMs: NOW, liquidityUsd: 50_000, source: "dexscreener" }],
    }));
    expect(byId(out, "marketcap_liquidity_ratio").value).toBeCloseTo(10, 6);
  });

  it("computes source_agreement across two sources", () => {
    const out = runFeatureEngine(baseInput({
      liquidity: [
        { observedAtMs: NOW, liquidityUsd: 100_000, source: "dexscreener" },
        { observedAtMs: NOW, liquidityUsd: 110_000, source: "geckoterminal" },
      ],
    }));
    const f = byId(out, "source_agreement");
    expect(f.status).toBe("OK");
    // spread = 10000/105000 ≈ 0.0952 → agreement ≈ 0.9048
    expect(f.value).toBeCloseTo(0.904762, 4);
  });
});

describe("determinism", () => {
  it("identical input yields identical output", () => {
    const input = baseInput({
      liquidity: [
        { observedAtMs: NOW - min(60), liquidityUsd: 1000, source: "dexscreener" },
        { observedAtMs: NOW, liquidityUsd: 950, source: "dexscreener" },
      ],
      onChain: { available: true, insiderPct: 0.12, fundingRiskScore: 0.3, bundleSupplyPct: 0.05, holderTop10Pct: 0.4, clusterGroupCount: 20, smartWalletCount: 3, smartWalletNetFlowUsd: 1000, smartWalletHoldRatio: 0.8 },
      holders: [{ observedAtMs: NOW, holderCount: 100, top10Pct: 0.4, source: "helius" }],
    });
    expect(runFeatureEngine(input)).toEqual(runFeatureEngine(structuredClone(input)));
  });
});
