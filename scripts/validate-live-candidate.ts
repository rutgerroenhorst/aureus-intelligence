/**
 * pnpm validate:live — fetch ONE real public Solana candidate from Dex Screener,
 * run the feature + rule engines on it, and print the (honest) result. On-chain
 * features will be UNAVAILABLE (no Helius key), so Safety is INCOMPLETE and the
 * state is UNRESOLVED — which is the correct, non-fabricated behaviour.
 */
import { DexScreenerAdapter } from "@aureus/ingestion";
import { runFeatureEngine, type FeatureInput } from "@aureus/feature-engine";
import { evaluateRules, reduceState, DEFAULT_RULE_CONFIG } from "@aureus/rule-engine";

const dex = new DexScreenerAdapter();

function pickMint(profiles: unknown): string | null {
  if (!Array.isArray(profiles)) return null;
  for (const p of profiles as Array<{ chainId?: string; tokenAddress?: string }>) {
    if (p.chainId === "solana" && p.tokenAddress) return p.tokenAddress;
  }
  return null;
}

try {
  const profiles = await dex.latestTokenProfiles();
  const mint = pickMint(profiles.payload);
  if (!mint) {
    console.log("No Solana token in latest profiles right now; try again shortly.");
    process.exit(0);
  }
  console.log(`Real candidate mint: ${mint}`);
  const tokens = await dex.tokens([mint]);
  const pairs = tokens.payload as Array<{
    priceUsd?: string; liquidity?: { usd?: number }; marketCap?: number; pairAddress?: string;
    txns?: { h1?: { buys?: number; sells?: number } };
  }>;
  const pair = Array.isArray(pairs) ? pairs[0] : undefined;
  if (!pair) {
    console.log("No pair data returned for mint.");
    process.exit(0);
  }
  const nowMs = Date.now();
  console.log(`Pool: ${pair.pairAddress}  price=$${pair.priceUsd}  liq=$${pair.liquidity?.usd}  mcap=$${pair.marketCap}`);

  const input: FeatureInput = {
    nowMs,
    discoveryAtMs: nowMs,
    prices: pair.priceUsd ? [{ observedAtMs: nowMs, priceUsd: Number(pair.priceUsd), marketCapUsd: pair.marketCap, source: "dexscreener" }] : [],
    liquidity: pair.liquidity?.usd != null ? [{ observedAtMs: nowMs, liquidityUsd: pair.liquidity.usd, source: "dexscreener" }] : [],
    txAggregates: pair.txns?.h1 ? [{ observedAtMs: nowMs, windowSeconds: 3600, buyers: pair.txns.h1.buys, sellers: pair.txns.h1.sells, source: "dexscreener" }] : [],
    holders: [],
    social: [],
    onChain: { available: false },
    sourcesPresent: ["dexscreener"],
  };

  const features = runFeatureEngine(input);
  console.log("\nFeature statuses:");
  for (const f of features) console.log(`  ${f.status.padEnd(12)} ${f.featureId}${f.value != null ? " = " + f.value : ""}`);

  const rules = evaluateRules({
    nowMs, features: Object.fromEntries(features.map((f) => [f.featureId, f])),
    flags: { onChainAvailable: false }, config: DEFAULT_RULE_CONFIG, hasOpenPosition: false,
  });
  const decision = reduceState(rules, { hasOpenPosition: false, discoveryAtMs: nowMs, nowMs });
  console.log(`\nSafety=${decision.safetyStatus}  Quality=${decision.qualityStatus}  Entry=${decision.entryStatus}`);
  console.log(`Decision state: ${decision.state} — ${decision.reason}`);
} catch (err) {
  console.error("LIVE VALIDATION ERROR:", (err as Error).message);
  process.exitCode = 1;
}
