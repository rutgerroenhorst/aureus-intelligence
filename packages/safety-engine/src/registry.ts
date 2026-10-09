/**
 * Explicit on-chain dataset registry — the single source of truth for what each
 * Safety dataset is, who provides it, and whether it's implemented / required.
 *
 * This REPLACES the old regex-on-reason-strings heuristic. UI, enrichment engine
 * and rule integration all read this same table.
 */

export type DatasetStatus = "OK" | "FAIL" | "INCOMPLETE" | "UNAVAILABLE";
export type Provider = "helius-rpc" | "jupiter" | "derived" | "none";

/** CORE = the checks a conditional entry relies on. ADVANCED = deeper attribution
 *  that free RPC can't fully do; its absence must never read as "Safety complete". */
export type SafetyLayer = "core" | "advanced";

export interface DatasetSpec {
  id: string;
  layer: SafetyLayer;
  implemented: boolean;
  /** Must be OK for CORE SAFETY to be allowed to PASS. (Advanced is never required.) */
  requiredForSafety: boolean;
  provider: Provider;
  /** Data older than this is treated as stale (INCOMPLETE). */
  freshnessThresholdMs: number;
  supportedStatuses: DatasetStatus[];
  dependencies: string[];
  failureSemantics: string;
  /** Honest note: what a fuller/paid source would add. Empty when fully covered. */
  paidUpgrade?: string;
}

const M = 60_000;

export const DATASET_REGISTRY: Record<string, DatasetSpec> = {
  supply: {
    id: "supply", layer: "core", implemented: true, requiredForSafety: true, provider: "helius-rpc",
    freshnessThresholdMs: 30 * M, supportedStatuses: ["OK", "UNAVAILABLE"], dependencies: [],
    failureSemantics: "No supply → concentration/insider math impossible.",
  },
  holders: {
    id: "holders", layer: "core", implemented: true, requiredForSafety: true, provider: "helius-rpc",
    freshnessThresholdMs: 30 * M, supportedStatuses: ["OK", "UNAVAILABLE"], dependencies: ["supply"],
    failureSemantics: "No largest-accounts → no concentration.",
  },
  holder_concentration: {
    id: "holder_concentration", layer: "core", implemented: true, requiredForSafety: true, provider: "derived",
    freshnessThresholdMs: 30 * M, supportedStatuses: ["OK", "UNAVAILABLE"], dependencies: ["supply", "holders"],
    failureSemantics: "Raw top-10 token-account share.",
  },
  authorities: {
    id: "authorities", layer: "core", implemented: true, requiredForSafety: true, provider: "helius-rpc",
    freshnessThresholdMs: 30 * M, supportedStatuses: ["OK", "FAIL", "UNAVAILABLE"], dependencies: [],
    failureSemantics: "Active mint/freeze authority = FAIL (mintable / freezable).",
  },
  rug_risk: {
    id: "rug_risk",
    // A DERIVED verdict, not a raw dataset. `requiredForSafety` governs whether data
    // must be PRESENT before Core Safety can pass; making a verdict required meant
    // every coin without it read INCOMPLETE. A DANGER verdict blocks through the
    // reject path in fundamentalWatch(), which is where judgements belong.
    layer: "core", implemented: true, requiredForSafety: false, provider: "helius-rpc",
    freshnessThresholdMs: 15 * 60_000,
    supportedStatuses: ["OK", "FAIL", "INCOMPLETE"],
    dependencies: ["holders", "authorities"],
    failureSemantics: "DANGER blocks; UNKNOWN is INCOMPLETE and never a pass",
  },
  insider_concentration: {
    id: "insider_concentration", layer: "core", implemented: true, requiredForSafety: true, provider: "helius-rpc",
    freshnessThresholdMs: 30 * M, supportedStatuses: ["OK", "FAIL", "INCOMPLETE", "UNAVAILABLE"],
    dependencies: ["holders", "supply"],
    failureSemantics: "Unique beneficial-owner top-10 share above limit = FAIL. LP/burn/system excluded.",
    paidUpgrade: "Full funding-graph clustering (connected insider wallets) needs an indexer (Helius DAS/enhanced tx or a wallet-graph API).",
  },
  sellability: {
    id: "sellability", layer: "core", implemented: true, requiredForSafety: true, provider: "jupiter",
    freshnessThresholdMs: 10 * M, supportedStatuses: ["OK", "FAIL", "INCOMPLETE", "UNAVAILABLE"], dependencies: [],
    failureSemantics: "No sell route (honeypot) or extreme price impact = FAIL. Read-only quote, no transaction.",
  },
  liquidity_drain: {
    id: "liquidity_drain", layer: "core", implemented: true, requiredForSafety: true, provider: "derived",
    freshnessThresholdMs: 15 * M, supportedStatuses: ["OK", "FAIL", "INCOMPLETE"], dependencies: [],
    failureSemantics: "Critical multi-horizon liquidity contraction / pool disappearance = FAIL.",
  },
  deployer_identity: {
    id: "deployer_identity", layer: "core", implemented: true, requiredForSafety: false, provider: "helius-rpc",
    freshnessThresholdMs: 6 * 60 * M, supportedStatuses: ["OK", "INCOMPLETE", "UNAVAILABLE"], dependencies: [],
    failureSemantics: "Creator resolved from the mint's oldest transaction, else INCOMPLETE.",
    paidUpgrade: "Reliable creator + prior-deployment history across many-tx mints needs a paid indexer.",
  },
  deployer_funding: {
    id: "deployer_funding", layer: "core", implemented: true, requiredForSafety: true, provider: "helius-rpc",
    freshnessThresholdMs: 6 * 60 * M, supportedStatuses: ["OK", "FAIL", "INCOMPLETE", "UNAVAILABLE"],
    dependencies: ["deployer_identity"],
    failureSemantics: "Large hidden deployer supply exposure = elevated funding risk.",
    paidUpgrade: "Full backward funding-chain + blacklist matching needs an indexer / reputation API.",
  },
  deployer_sales: {
    id: "deployer_sales", layer: "advanced", implemented: false, requiredForSafety: false, provider: "helius-rpc",
    freshnessThresholdMs: 6 * 60 * M, supportedStatuses: ["INCOMPLETE", "UNAVAILABLE"], dependencies: ["deployer_identity"],
    failureSemantics: "Active deployer dump = FAIL (once implemented).",
    paidUpgrade: "Requires parsed transfer history for the deployer wallet (enhanced-tx / indexer).",
  },
  wallet_clusters: {
    id: "wallet_clusters", layer: "advanced", implemented: false, requiredForSafety: false, provider: "helius-rpc",
    freshnessThresholdMs: 6 * 60 * M, supportedStatuses: ["INCOMPLETE", "UNAVAILABLE"], dependencies: ["holders"],
    failureSemantics: "Connected-wallet clustering (funding graph).",
    paidUpgrade: "Needs a funding-graph indexer; free RPC can't reconstruct wallet clusters reliably.",
  },
  bundle_contamination: {
    id: "bundle_contamination", layer: "advanced", implemented: true, requiredForSafety: false, provider: "helius-rpc",
    freshnessThresholdMs: 6 * 60 * M, supportedStatuses: ["OK", "FAIL", "INCOMPLETE", "UNAVAILABLE"], dependencies: [],
    failureSemantics: "Coordinated launch-cluster supply above limit = FAIL. Only with sufficient launch-window data.",
    paidUpgrade: "Jito bundle attribution + full launch reconstruction needs a specialized bundle dataset.",
  },
};

/** Datasets that must be OK before CORE SAFETY may PASS. */
export const SAFETY_REQUIRED_DATASETS: string[] = Object.values(DATASET_REGISTRY)
  .filter((d) => d.requiredForSafety)
  .map((d) => d.id);

export const CORE_DATASETS: string[] = Object.values(DATASET_REGISTRY).filter((d) => d.layer === "core").map((d) => d.id);
export const ADVANCED_DATASETS: string[] = Object.values(DATASET_REGISTRY).filter((d) => d.layer === "advanced").map((d) => d.id);

export function datasetSpec(id: string): DatasetSpec | undefined {
  return DATASET_REGISTRY[id];
}

/** Implemented = we run a real analysis; not a regex on a reason string. */
export function isImplemented(id: string): boolean {
  return DATASET_REGISTRY[id]?.implemented ?? false;
}
