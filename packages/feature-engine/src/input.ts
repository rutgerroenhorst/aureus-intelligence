import type { Source } from "@aureus/contracts";

/** All timestamps are epoch-ms so feature math is deterministic and clock-free. */
export interface LiquidityPoint {
  observedAtMs: number;
  liquidityUsd: number;
  source: Source;
}
export interface PricePoint {
  observedAtMs: number;
  priceUsd: number;
  marketCapUsd?: number;
  source: Source;
}
export interface TxAggPoint {
  observedAtMs: number;
  windowSeconds: number;
  buyers?: number;
  sellers?: number;
  buys?: number;
  sells?: number;
  netFlowUsd?: number;
  source: Source;
}
export interface HolderInfo {
  observedAtMs: number;
  holderCount?: number;
  top10Pct?: number;
  insiderPct?: number;
  source: Source;
}
export interface SocialPoint {
  observedAtMs: number;
  metric: string;
  value: number;
  isPaid: boolean;
  source: Source;
}

/**
 * On-chain intelligence, only trustworthy when `available` (Helius LIVE). When
 * unavailable, on-chain-derived features become UNAVAILABLE — never guessed.
 */
export interface OnChainIntel {
  /** Largest single beneficial owner's share of supply. A top-10 aggregate hides the
   *  one case that ends a coin outright: a single wallet big enough to exit through
   *  the entire float. */
  largestHolderPct?: number;
  /** Top-5 beneficial owners' combined share — how nominal the float is. */
  top5Pct?: number;
  available: boolean;
  insiderPct?: number;
  holderTop10Pct?: number;
  buyerConcentration?: number;
  clusterCombinedPct?: number;
  clusterGroupCount?: number;
  bundleSupplyPct?: number;
  blacklistMatch?: boolean;
  fundingRiskScore?: number; // 0..1
  smartWalletCount?: number;
  smartWalletNetFlowUsd?: number;
  smartWalletHoldRatio?: number;
}

/** Freshness TTLs (ms) per data class — mirrors PRD §6. */
export interface FreshnessTtl {
  priceMs: number;
  liquidityMs: number;
  txMs: number;
  holdersMs: number;
  socialMs: number;
}

export const DEFAULT_TTL: FreshnessTtl = {
  priceMs: 60_000,
  liquidityMs: 120_000,
  txMs: 120_000,
  holdersMs: 900_000,
  socialMs: 1_800_000,
};

export interface FeatureInput {
  nowMs: number;
  discoveryAtMs: number;
  liquidity: LiquidityPoint[];
  prices: PricePoint[];
  txAggregates: TxAggPoint[];
  holders: HolderInfo[];
  social: SocialPoint[];
  onChain: OnChainIntel;
  sourcesPresent: Source[];
  ttl?: FreshnessTtl;
}
