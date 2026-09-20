/**
 * Pure Safety analyzers. Each takes already-fetched raw data (so the worker owns
 * all RPC/HTTP and these stay deterministic + unit-testable) and returns a typed
 * result with status + evidence. Never fabricates: insufficient/uncertain data
 * yields INCOMPLETE/UNAVAILABLE, never a manufactured OK/FAIL.
 */
import type { DatasetStatus } from "./registry.js";

export interface AnalysisResult {
  status: DatasetStatus;
  value?: number; // primary metric (fraction), when meaningful
  reason: string;
  evidence: Record<string, unknown>;
  observedAtMs: number;
  sources: string[];
}

// ── Known non-beneficial owners (LP vaults / burn / system) ──────────────────
export const BURN_ADDRESSES = new Set<string>([
  "1nc1nerator11111111111111111111111111111111", // SPL incinerator
  "11111111111111111111111111111111", // system program
]);
// Program owners whose token accounts are pool vaults, not beneficial holders.
export const POOL_PROGRAM_OWNERS = new Set<string>([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora pools
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpools
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY", // Phoenix
]);

// ── 1. Liquidity drain (pure, from history) ──────────────────────────────────
export interface LiqPoint { atMs: number; liquidityUsd: number }
export type DrainSeverity = "normal" | "warning" | "critical" | "pool_gone" | "stale";

/**
 * A baseline is only allowed to stand in for horizon H if it is genuinely about H
 * old. Taking "the most recent sample at or before 1h ago" and calling the result
 * a 1h drain is wrong whenever observation stopped: after a 17h outage that rule
 * silently compares now against a sample from 17.8h ago and labels it "h1".
 *
 * Absence of a sample is only evidence of "no change" while we were actually
 * watching. When we were not, absence means nothing at all — so a horizon whose
 * baseline is older than this tolerance is reported as UNMEASURED, never guessed.
 */
function horizonToleranceMs(horizonMs: number): number {
  return Math.max(horizonMs, 15 * 60_000);
}

export function analyzeLiquidityDrain(history: LiqPoint[], nowMs: number): AnalysisResult & {
  severity: DrainSeverity;
  horizons: Record<string, number | null>;
  /** Actual age of the baseline behind each measured horizon, in ms. */
  horizonAgeMs: Record<string, number>;
  /** Horizons we deliberately refused to compute, and why. */
  unmeasured: string[];
  /** Largest hole between consecutive observations inside the 6h window. */
  maxGapMs: number;
} {
  const pts = history.filter((p) => Number.isFinite(p.liquidityUsd) && p.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs);
  const HZ: Record<string, number> = { m5: 5 * 60_000, m15: 15 * 60_000, m30: 30 * 60_000, h1: 60 * 60_000, h6: 6 * 60 * 60_000 };
  const horizons: Record<string, number | null> = {};
  const horizonAgeMs: Record<string, number> = {};
  const unmeasured: string[] = [];
  if (pts.length < 2) {
    return {
      status: "INCOMPLETE", severity: "stale", horizons, horizonAgeMs, unmeasured: Object.keys(HZ), maxGapMs: 0,
      reason: "Insufficient liquidity history.", evidence: { points: pts.length }, observedAtMs: nowMs, sources: ["derived"],
    };
  }
  const now = pts[pts.length - 1]!.liquidityUsd;

  // Largest observation hole in the window — a drain-and-refill inside a hole is invisible.
  let maxGapMs = 0;
  for (let n = 1; n < pts.length; n++) maxGapMs = Math.max(maxGapMs, pts[n]!.atMs - pts[n - 1]!.atMs);
  maxGapMs = Math.max(maxGapMs, nowMs - pts[pts.length - 1]!.atMs);

  for (const [k, ms] of Object.entries(HZ)) {
    const cutoff = nowMs - ms;
    const prior = [...pts].reverse().find((p) => p.atMs <= cutoff);
    if (!prior || prior.liquidityUsd <= 0) { unmeasured.push(`${k}: no observation that far back`); horizons[k] = null; continue; }
    const age = nowMs - prior.atMs;
    if (age > ms + horizonToleranceMs(ms)) {
      unmeasured.push(`${k}: nearest baseline is ${Math.round(age / 60_000)}m old — observation gap, not a ${k} reading`);
      horizons[k] = null;
      continue;
    }
    horizons[k] = (now - prior.liquidityUsd) / prior.liquidityUsd;
    horizonAgeMs[k] = age;
  }
  horizons.sinceDiscovery = pts[0]!.liquidityUsd > 0 ? (now - pts[0]!.liquidityUsd) / pts[0]!.liquidityUsd : null;
  horizonAgeMs.sinceDiscovery = nowMs - pts[0]!.atMs;

  // sinceDiscovery spans any outage by definition, so it must not drive severity.
  const gradedValues = Object.entries(horizons)
    .filter(([k, v]) => k !== "sinceDiscovery" && v != null)
    .map(([, v]) => v as number);

  // A pool at zero is dead regardless of history — that reading needs no baseline.
  if (now <= 500) {
    return {
      status: "FAIL", value: -1, severity: "pool_gone", horizons, horizonAgeMs, unmeasured, maxGapMs,
      reason: "Pool liquidity effectively gone.", evidence: { nowUsd: now, horizons, horizonAgeMs, unmeasured },
      observedAtMs: nowMs, sources: ["derived:liquidity_snapshots"],
    };
  }
  // No horizon survived the tolerance check → we cannot claim anything about drain.
  if (gradedValues.length === 0) {
    return {
      status: "INCOMPLETE", severity: "stale", horizons, horizonAgeMs, unmeasured, maxGapMs,
      reason: `No measurable drain horizon — ${unmeasured[0] ?? "observation gap"}.`,
      evidence: { nowUsd: now, horizons, horizonAgeMs, unmeasured, maxGapMs },
      observedAtMs: nowMs, sources: ["derived:liquidity_snapshots"],
    };
  }

  let severity: DrainSeverity = "normal";
  const worst = Math.min(...gradedValues, 0);
  if (
    (horizons.m15 != null && horizons.m15 <= -0.5) ||
    (horizons.m30 != null && horizons.m30 <= -0.4) ||
    (horizons.h1 != null && horizons.h1 <= -0.6) ||
    worst <= -0.6
  ) severity = "critical";
  else if (worst <= -0.2) severity = "warning";

  const status: DatasetStatus = severity === "critical" ? "FAIL" : "OK";
  const reason = severity === "critical" ? `Critical liquidity drain (worst ${(worst * 100).toFixed(0)}%).`
    : severity === "warning" ? `Liquidity contracting (worst ${(worst * 100).toFixed(0)}%).`
    : "Liquidity stable within limits.";
  return {
    status, value: worst, severity, horizons, horizonAgeMs, unmeasured, maxGapMs, reason,
    evidence: { nowUsd: now, horizons, horizonAgeMs, unmeasured, maxGapMs }, observedAtMs: nowMs,
    sources: ["derived:liquidity_snapshots"],
  };
}

// ── 2. Sellability (from Jupiter quotes) ─────────────────────────────────────
export interface SellQuote { sizeUsd: number; outUsd: number | null; priceImpactPct: number | null; routed: boolean; failReason?: string }
export type SellClass =
  | "SELLABLE" | "HIGH_IMPACT" | "INSUFFICIENT_LIQUIDITY"
  | "NO_ROUTE_RETRY" | "INDEXING_UNKNOWN" | "CONFIRMED_SELLABILITY_FAIL";
export interface SellabilityInput {
  quotes: SellQuote[]; // sell quotes across sizes (may include repeated attempts)
  freezeAuthorityActive: boolean | null;
  nowMs: number;
  buyRouteExists: boolean | null; // does a BUY route exist? (distinguishes honeypot from dead/unindexed pool)
  poolFresh: boolean; // fresh price/pool data present
  attempts: number; // how many independent quote attempts were made
  maxImpactPct?: number; // above this at the smallest size = not usefully sellable
}

/** A CONFIRMED sellability FAIL requires multiple sizes, ≥2 attempts, fresh pool
 *  data, an existing BUY route, no temporary API error, and a reproducible no-sell. */
export function analyzeSellability(inp: SellabilityInput): AnalysisResult & { sellable: boolean | null; classification: SellClass; maxReasonableSizeUsd: number | null } {
  const maxImpact = inp.maxImpactPct ?? 35;
  const quotes = [...inp.quotes].sort((a, b) => a.sizeUsd - b.sizeUsd);
  const wrap = (status: DatasetStatus, classification: SellClass, sellable: boolean | null, reason: string, maxReasonableSizeUsd: number | null): AnalysisResult & { sellable: boolean | null; classification: SellClass; maxReasonableSizeUsd: number | null } =>
    ({ status, classification, sellable, maxReasonableSizeUsd, value: maxReasonableSizeUsd ?? undefined, reason, evidence: { quotes, attempts: inp.attempts, buyRouteExists: inp.buyRouteExists, poolFresh: inp.poolFresh }, observedAtMs: inp.nowMs, sources: ["jupiter", "helius-rpc"] });

  if (quotes.length === 0) return wrap("UNAVAILABLE", "INDEXING_UNKNOWN", null, "No sell-route data (quote source unavailable).", null);

  const apiError = quotes.some((q) => q.failReason === "timeout" || (q.failReason ?? "").startsWith("http") || q.failReason === "fetch error");
  const routed = quotes.filter((q) => q.routed && q.outUsd != null && q.outUsd > 0);
  const smallest = quotes[0]!;

  // No sell route anywhere.
  if (routed.length === 0) {
    if (apiError) return wrap("INCOMPLETE", "INDEXING_UNKNOWN", null, "Sell quotes failed on a temporary API/indexing error — retry required.", null);
    // Honeypot only when: buy route exists, pool fresh, reproduced across ≥2 attempts.
    if (inp.buyRouteExists === true && inp.poolFresh && inp.attempts >= 2) {
      return wrap("FAIL", "CONFIRMED_SELLABILITY_FAIL", false, "Confirmed non-sellable: buy route exists, no sell route across multiple attempts (honeypot pattern).", null);
    }
    return wrap("INCOMPLETE", "NO_ROUTE_RETRY", null, `No sell route yet (buyRoute=${inp.buyRouteExists}, fresh=${inp.poolFresh}, attempts=${inp.attempts}) — not confirmed, retry required.`, null);
  }
  // Freeze authority can block transfers → confirmed sellability risk.
  if (inp.freezeAuthorityActive === true) return wrap("FAIL", "CONFIRMED_SELLABILITY_FAIL", false, "Freeze authority active — sells can be frozen.", null);

  const acceptable = routed.filter((q) => q.priceImpactPct != null && q.priceImpactPct <= maxImpact);
  const maxReasonableSizeUsd = acceptable.length ? Math.max(...acceptable.map((q) => q.sizeUsd)) : null;
  const smallImpact = smallest.priceImpactPct;
  // Even the smallest tested size is too costly → thin, not a honeypot.
  if (smallImpact != null && smallImpact > maxImpact) {
    return wrap("INCOMPLETE", "INSUFFICIENT_LIQUIDITY", null, `Even a $${smallest.sizeUsd} sell has ${smallImpact.toFixed(1)}% impact (> ${maxImpact}%) — insufficient liquidity.`, maxReasonableSizeUsd);
  }
  // Sellable, but larger sizes are costly.
  if (acceptable.length < routed.length) {
    return wrap("OK", "HIGH_IMPACT", true, `Sellable up to ~$${maxReasonableSizeUsd}; larger sizes exceed ${maxImpact}% impact.`, maxReasonableSizeUsd);
  }
  return wrap("OK", "SELLABLE", true, `Sellable across tested sizes (≤ ${maxImpact}% impact up to $${maxReasonableSizeUsd}).`, maxReasonableSizeUsd);
}

// ── 3. Insider concentration (unique beneficial owners) ──────────────────────
export interface TokenAccountHolding { tokenAccount: string; owner: string | null; amountRaw: number }
export interface InsiderInput {
  holdings: TokenAccountHolding[]; // from getTokenLargestAccounts + owner resolution
  supplyRaw: number;
  nowMs: number;
  excludeOwners?: Set<string>; // extra LP/vault owners (e.g. pool authorities)
  maxUnresolvedFrac?: number; // if too many token accounts lack owner → INCOMPLETE
}

export function analyzeInsider(inp: InsiderInput): AnalysisResult & { rawTokenAccountTop10Pct: number | null; uniqueOwnerTop10Pct: number | null; excludedPct: number; ownerShares: number[] } {
  const exclude = inp.excludeOwners ?? new Set<string>();
  if (inp.supplyRaw <= 0 || inp.holdings.length === 0) {
    return { status: "INCOMPLETE", rawTokenAccountTop10Pct: null, uniqueOwnerTop10Pct: null, excludedPct: 0, ownerShares: [], reason: "No supply / holdings for concentration.", evidence: {}, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
  }
  const isExcluded = (owner: string | null) => owner != null && (exclude.has(owner) || BURN_ADDRESSES.has(owner) || POOL_PROGRAM_OWNERS.has(owner));

  // Raw token-account concentration (top 10 by amount).
  const byAmt = [...inp.holdings].sort((a, b) => b.amountRaw - a.amountRaw);
  const rawTop10 = byAmt.slice(0, 10).reduce((s, h) => s + h.amountRaw, 0) / inp.supplyRaw;

  const unresolved = inp.holdings.filter((h) => h.owner == null).reduce((s, h) => s + h.amountRaw, 0) / inp.supplyRaw;
  if (unresolved > (inp.maxUnresolvedFrac ?? 0.15)) {
    return { status: "INCOMPLETE", rawTokenAccountTop10Pct: rawTop10, uniqueOwnerTop10Pct: null, excludedPct: 0, ownerShares: [], reason: `Owner resolution incomplete (${(unresolved * 100).toFixed(0)}% of supply unresolved).`, evidence: { rawTop10 }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
  }

  // Aggregate by beneficial owner, excluding LP/burn/system.
  const byOwner = new Map<string, number>();
  let excludedRaw = 0;
  for (const h of inp.holdings) {
    if (h.owner == null) continue;
    if (isExcluded(h.owner)) { excludedRaw += h.amountRaw; continue; }
    byOwner.set(h.owner, (byOwner.get(h.owner) ?? 0) + h.amountRaw);
  }
  const owners = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  const uniqueTop10 = owners.slice(0, 10).reduce((s, [, amt]) => s + amt, 0) / inp.supplyRaw;
  const excludedPct = excludedRaw / inp.supplyRaw;
  // Per-owner shares, largest first. A top-10 aggregate hides the case that actually
  // ends a coin: one wallet holding enough to exit through the whole float.
  const ownerShares = owners.map(([, amt]) => amt / inp.supplyRaw);

  return {
    status: "OK", value: uniqueTop10, rawTokenAccountTop10Pct: rawTop10, uniqueOwnerTop10Pct: uniqueTop10, excludedPct, ownerShares,
    reason: `Top-10 unique-owner share ${(uniqueTop10 * 100).toFixed(1)}% (excluded LP/burn ${(excludedPct * 100).toFixed(1)}%).`,
    evidence: { uniqueOwners: owners.length, topOwners: owners.slice(0, 10).map(([o, a]) => ({ owner: o, pct: a / inp.supplyRaw })), excludedPct },
    observedAtMs: inp.nowMs, sources: ["helius-rpc"],
  };
}

// ── 4. Deployer identity + funding exposure ──────────────────────────────────
export interface DeployerInput {
  creator: string | null; // resolved from oldest mint tx
  creationSig: string | null;
  reachedOldest: boolean; // did we page back to the mint's creation?
  deployerBalanceRaw: number | null; // deployer's current balance of this token
  supplyRaw: number;
  nowMs: number;
}

export function analyzeDeployer(inp: DeployerInput): AnalysisResult & { creator: string | null; deployerExposurePct: number | null; fundingRiskScore: number | null } {
  if (inp.creator == null || !inp.reachedOldest) {
    return { status: "INCOMPLETE", creator: inp.creator, deployerExposurePct: null, fundingRiskScore: null, reason: inp.reachedOldest ? "Creator not resolvable from creation tx." : "Could not page back to the mint's creation (too many txs on free RPC).", evidence: { creationSig: inp.creationSig, reachedOldest: inp.reachedOldest }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
  }
  const exposure = inp.deployerBalanceRaw != null && inp.supplyRaw > 0 ? inp.deployerBalanceRaw / inp.supplyRaw : null;
  // Deterministic funding-risk from deployer supply exposure (higher exposure = higher risk).
  const fundingRiskScore = exposure == null ? null : Math.min(1, Math.round(exposure * 1.5 * 100) / 100);
  const status: DatasetStatus = exposure == null ? "INCOMPLETE" : exposure >= 0.5 ? "FAIL" : "OK";
  const reason = exposure == null ? "Deployer balance unknown." : exposure >= 0.5 ? `Deployer holds ${(exposure * 100).toFixed(0)}% of supply (large hidden exposure).` : `Deployer holds ${(exposure * 100).toFixed(1)}% of supply.`;
  return { status, value: exposure ?? undefined, creator: inp.creator, deployerExposurePct: exposure, fundingRiskScore, reason, evidence: { creator: inp.creator, creationSig: inp.creationSig, exposure }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
}

// ── 5. Bundle / launch-window contamination ──────────────────────────────────
export interface LaunchBuy { wallet: string; funder: string | null; amountRaw: number; slot: number }
export interface BundleInput {
  earlyBuys: LaunchBuy[]; // buys in the launch window
  supplyRaw: number;
  nowMs: number;
  hasLaunchData: boolean; // did we actually reach the launch window?
  minClusterWallets?: number;
}

export function analyzeBundle(inp: BundleInput): AnalysisResult & { bundleSupplyPct: number | null; connectedLaunchWallets: number } {
  if (!inp.hasLaunchData || inp.earlyBuys.length === 0 || inp.supplyRaw <= 0) {
    return { status: "INCOMPLETE", bundleSupplyPct: null, connectedLaunchWallets: 0, reason: "Launch-window data unavailable (free RPC couldn't reconstruct the launch).", evidence: { hasLaunchData: inp.hasLaunchData }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
  }
  // Cluster early buyers by shared funder — coordinated accumulation.
  const byFunder = new Map<string, { wallets: Set<string>; amount: number }>();
  let unknownFunder = 0;
  for (const b of inp.earlyBuys) {
    if (b.funder == null) { unknownFunder += b.amountRaw; continue; }
    const e = byFunder.get(b.funder) ?? { wallets: new Set(), amount: 0 };
    e.wallets.add(b.wallet); e.amount += b.amountRaw; byFunder.set(b.funder, e);
  }
  const minWallets = inp.minClusterWallets ?? 3;
  const clusters = [...byFunder.values()].filter((c) => c.wallets.size >= minWallets);
  const bundledRaw = clusters.reduce((s, c) => s + c.amount, 0);
  const bundleSupplyPct = bundledRaw / inp.supplyRaw;
  const connectedLaunchWallets = clusters.reduce((s, c) => s + c.wallets.size, 0);

  // Too much unknown funding → we cannot claim a clean PASS.
  if (unknownFunder / inp.supplyRaw > 0.5 && clusters.length === 0) {
    return { status: "INCOMPLETE", bundleSupplyPct: null, connectedLaunchWallets: 0, reason: "Funder attribution too incomplete for a bundle verdict.", evidence: { unknownFunderPct: unknownFunder / inp.supplyRaw }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
  }
  return { status: "OK", value: bundleSupplyPct, bundleSupplyPct, connectedLaunchWallets, reason: `Coordinated launch clusters hold ${(bundleSupplyPct * 100).toFixed(1)}% across ${connectedLaunchWallets} wallets.`, evidence: { clusters: clusters.length, connectedLaunchWallets, bundleSupplyPct }, observedAtMs: inp.nowMs, sources: ["helius-rpc"] };
}

// ── 6. Market liveness — "pretty chart, dead pool" ───────────────────────────
/**
 * Detects a FROZEN market. Dexscreener keeps returning the last known values after
 * trading stops, so `observed_at` stays fresh while the content is stale. A chart can
 * look like a clean uptrend while the pool has been abandoned for hours.
 *
 * Real case: a token showing a textbook rising trend, liquidity ≈ $0.000002, and no
 * new trades for ~20h. Freshness-by-timestamp said "fresh". This catches it.
 */
export interface TxSample { atMs: number; buys: number | null; sells: number | null; volumeUsd: number | null }
export type Liveness = "ACTIVE" | "THIN" | "FROZEN" | "POOL_GONE" | "UNKNOWN";

export function analyzeLiveness(
  samples: TxSample[], liquidityUsd: number | null, nowMs: number,
  opts: { minLiquidityUsd?: number; frozenPolls?: number } = {},
): AnalysisResult & { liveness: Liveness; distinctSamples: number } {
  const minLiq = opts.minLiquidityUsd ?? 500;
  const needDistinct = opts.frozenPolls ?? 3;
  const wrap = (status: DatasetStatus, liveness: Liveness, reason: string, distinct: number) =>
    ({ status, liveness, distinctSamples: distinct, reason, evidence: { liquidityUsd, samples: samples.length, distinct }, observedAtMs: nowMs, sources: ["derived:transaction_aggregates"] });

  // Liquidity effectively removed → the pool is gone no matter what the chart shows.
  if (liquidityUsd != null && liquidityUsd <= minLiq) {
    return wrap("FAIL", "POOL_GONE", `liquidity effectively removed ($${liquidityUsd.toFixed(2)}) — chart is stale, pool is dead`, 0);
  }
  const recent = samples.filter((s) => s.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs).slice(-8);
  if (recent.length < needDistinct) return wrap("INCOMPLETE", "UNKNOWN", "not enough trade samples to judge liveness", recent.length);

  // Identical buy/sell/volume across consecutive polls ⇒ no new trades are landing.
  const fingerprint = (s: TxSample) => `${s.buys ?? "-"}|${s.sells ?? "-"}|${s.volumeUsd ?? "-"}`;
  const distinct = new Set(recent.map(fingerprint)).size;
  if (distinct === 1) {
    return wrap("FAIL", "FROZEN", `no new trades across ${recent.length} polls — market frozen (timestamps look fresh, content is not)`, distinct);
  }
  if (distinct <= 2 && recent.length >= 5) {
    return wrap("INCOMPLETE", "THIN", `only ${distinct} distinct trade snapshots in ${recent.length} polls — near-frozen`, distinct);
  }
  return wrap("OK", "ACTIVE", `${distinct} distinct trade snapshots — market active`, distinct);
}

// ── 7. Deployer selling — free proxy for "dev is dumping" ────────────────────
/**
 * We can't read parsed transfer history on the free tier, but we DO re-read the
 * deployer's token balance every enrichment. A falling balance means the creator is
 * distributing — the pattern that precedes most launch rugs.
 */
export function analyzeDeployerSelling(
  prevExposure: number | null, currentExposure: number | null, nowMs: number,
  opts: { materialDropPct?: number } = {},
): AnalysisResult & { sold: boolean | null; dropPct: number | null } {
  const drop = opts.materialDropPct ?? 0.1; // ≥10% of prior holding
  if (prevExposure == null || currentExposure == null) {
    return { status: "INCOMPLETE", sold: null, dropPct: null, reason: "no prior deployer balance to compare", evidence: { prevExposure, currentExposure }, observedAtMs: nowMs, sources: ["helius-rpc"] };
  }
  if (prevExposure <= 0) {
    return { status: "OK", sold: false, dropPct: 0, reason: "deployer held nothing to sell", evidence: { prevExposure, currentExposure }, observedAtMs: nowMs, sources: ["helius-rpc"] };
  }
  const dropPct = (prevExposure - currentExposure) / prevExposure;
  if (dropPct >= drop) {
    return { status: "FAIL", sold: true, dropPct, value: dropPct, reason: `deployer sold ${(dropPct * 100).toFixed(0)}% of their holding (${(prevExposure * 100).toFixed(1)}% → ${(currentExposure * 100).toFixed(1)}% of supply)`, evidence: { prevExposure, currentExposure, dropPct }, observedAtMs: nowMs, sources: ["helius-rpc"] };
  }
  return { status: "OK", sold: false, dropPct, reason: `deployer holding stable (${(currentExposure * 100).toFixed(1)}% of supply)`, evidence: { prevExposure, currentExposure, dropPct }, observedAtMs: nowMs, sources: ["helius-rpc"] };
}

// ── Wash trading / manufactured activity ────────────────────────────────────
/**
 * Detects a market that is being *simulated* rather than traded.
 *
 * Holder concentration cannot catch this. Bundling — insiders splitting a bag across
 * many wallets — is designed specifically to defeat it, and it works: KEKODYSSEUS
 * showed a top-10 of 17%, which reads as healthy, while its chart was pinned flat and
 * its market was bots trading with themselves.
 *
 * What bundling cannot fake is the SHAPE of the flow, and that is visible in free data:
 *
 *   KEKODYSSEUS  $63,996 pool · $14,233 vol24 · 1,744 tx  → turnover 0.22×, $8/trade
 *   WSOLP        $87,815 pool · $642 vol24   · 2,800 tx  → turnover 0.007×, $0.23/trade
 *
 * Nobody trades 23 cents. Thousands of dust transactions against a large parked pool
 * is a bot maintaining the appearance of a market, and both coins were sitting on our
 * watchlist — one at ENTRY_APPROACHING.
 */
export type ActivityClass = "REAL" | "THIN" | "DUST_WASH" | "PARKED" | "UNKNOWN";

export interface WashInput {
  liquidityUsd: number | null;
  volume24Usd: number | null;
  buys: number | null;
  sells: number | null;
}

export interface WashResult {
  activity: ActivityClass;
  /** 24h volume relative to pool depth. Real markets turn over; parked money does not. */
  turnover: number | null;
  /** Mean USD per transaction. Dust means the trades are not economically motivated. */
  avgTradeUsd: number | null;
  reasons: string[];
}

export const WASH = {
  /** Below this, the pool is parked rather than traded. */
  MIN_TURNOVER: 0.30,
  /** Below this, the average "trade" is too small to be a real participant. */
  MIN_AVG_TRADE_USD: 5,
  /** Ignore the dust test on very low tx counts — a handful of small trades is normal. */
  MIN_TX_FOR_DUST: 50,
} as const;

export function analyzeWashTrading(i: WashInput): WashResult {
  const reasons: string[] = [];
  const liq = i.liquidityUsd ?? 0;
  const vol = i.volume24Usd ?? 0;
  const tx = (i.buys ?? 0) + (i.sells ?? 0);

  if (liq <= 0 || i.volume24Usd == null) {
    return { activity: "UNKNOWN", turnover: null, avgTradeUsd: null,
             reasons: ["pool depth or volume unknown — activity not classifiable"] };
  }
  const turnover = vol / liq;
  const avgTradeUsd = tx > 0 ? vol / tx : null;

  const dust = tx >= WASH.MIN_TX_FOR_DUST && avgTradeUsd != null && avgTradeUsd < WASH.MIN_AVG_TRADE_USD;
  const parked = turnover < WASH.MIN_TURNOVER;

  if (dust) reasons.push(`${tx} trades averaging $${avgTradeUsd!.toFixed(2)} — dust, not participants`);
  if (parked) reasons.push(`turnover ${turnover.toFixed(2)}× on a $${Math.round(liq).toLocaleString()} pool — money parked, not traded`);

  // Many transactions + dust size + a parked pool is a bot maintaining a market.
  let activity: ActivityClass;
  if (dust && parked) activity = "DUST_WASH";
  else if (parked) activity = "PARKED";
  else if (turnover < 1) activity = "THIN";
  else activity = "REAL";

  return { activity, turnover, avgTradeUsd, reasons };
}

// ── Rug risk on a brand-new coin ────────────────────────────────────────────
/**
 * The checks that matter at $5–50k market cap, where a coin is hours old and most
 * of the usual evidence does not exist yet.
 *
 * Deliberately built only from signals we can actually observe on the free tier, and
 * only from ones that survived checking. The "only buys, no sellers" pattern is a
 * common piece of advice and it did NOT hold up in our own forward data — buy-share
 * ≥90% (n=12) produced a median peak of +6% against +4% for coins that were mostly
 * selling, with the middle buckets flat. So it is recorded, not gated on. What a
 * bot pattern actually looks like is dust-sized trades against a parked pool, which
 * `analyzeWashTrading` already detects.
 *
 * Concentration thresholds follow published trader practice, which is consistent
 * across independent sources: a single wallet above ~20% can end the coin on its own,
 * and a top-5 above 90% means the float is an illusion.
 */
export type RugVerdict = "CLEAN" | "WATCH" | "DANGER" | "UNKNOWN";

export interface RugInput {
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  /** Beneficial-owner shares of supply, largest first, pool/burn already excluded. */
  ownerShares: number[];
  /** Share held by the deployer, when known. */
  deployerShare: number | null;
  /** From analyzeWashTrading. */
  activity: ActivityClass | null;
}

export interface RugResult {
  verdict: RugVerdict;
  largestHolderPct: number | null;
  top5Pct: number | null;
  /** Reasons that alone justify refusing the coin. */
  blocking: string[];
  /** Real concerns that do not alone disqualify it. */
  concerns: string[];
}

export const RUG = {
  /** A single wallet this large can end the coin on its own. */
  MAX_SINGLE_HOLDER: 0.20,
  /** Below this a single wallet is not, by itself, a reason to walk away. */
  WATCH_SINGLE_HOLDER: 0.12,
  /** Top-5 above this means the float is nominal. */
  MAX_TOP5: 0.60,
  WATCH_TOP5: 0.40,
  /** A deployer still holding this much has not committed to anything. */
  MAX_DEPLOYER: 0.10,
} as const;

export function analyzeRugRisk(i: RugInput): RugResult {
  const blocking: string[] = [];
  const concerns: string[] = [];

  // Authorities are the one binary: either the creator can still mint or freeze, or
  // they cannot. Unknown is not clean.
  if (i.mintAuthorityActive === true) blocking.push("mint authority still active — supply can be inflated");
  if (i.freezeAuthorityActive === true) blocking.push("freeze authority still active — your wallet can be frozen");
  const authoritiesUnknown = i.mintAuthorityActive == null || i.freezeAuthorityActive == null;

  const shares = [...i.ownerShares].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  const largestHolderPct = shares[0] ?? null;
  const top5Pct = shares.length ? shares.slice(0, 5).reduce((a, b) => a + b, 0) : null;

  if (largestHolderPct != null) {
    if (largestHolderPct >= RUG.MAX_SINGLE_HOLDER) {
      blocking.push(`one wallet holds ${(largestHolderPct * 100).toFixed(0)}% — a single exit ends this`);
    } else if (largestHolderPct >= RUG.WATCH_SINGLE_HOLDER) {
      concerns.push(`largest wallet ${(largestHolderPct * 100).toFixed(0)}%`);
    }
  }
  if (top5Pct != null) {
    if (top5Pct >= RUG.MAX_TOP5) blocking.push(`top 5 wallets hold ${(top5Pct * 100).toFixed(0)}% — the float is nominal`);
    else if (top5Pct >= RUG.WATCH_TOP5) concerns.push(`top 5 hold ${(top5Pct * 100).toFixed(0)}%`);
  }
  if (i.deployerShare != null && i.deployerShare >= RUG.MAX_DEPLOYER) {
    blocking.push(`deployer still holds ${(i.deployerShare * 100).toFixed(0)}%`);
  }
  if (i.activity === "DUST_WASH") blocking.push("trades are dust between bots, not a market");
  else if (i.activity === "PARKED") blocking.push("pool is parked — no real turnover");
  else if (i.activity === "THIN") concerns.push("thin trading");

  // Missing data is never clean. A coin we cannot check is UNKNOWN, which the caller
  // must treat as "not yet", never as "fine".
  if (blocking.length) return { verdict: "DANGER", largestHolderPct, top5Pct, blocking, concerns };
  if (authoritiesUnknown || largestHolderPct == null) {
    return { verdict: "UNKNOWN", largestHolderPct, top5Pct, blocking,
             concerns: [...concerns, "holder or authority data not yet available"] };
  }
  return { verdict: concerns.length ? "WATCH" : "CLEAN", largestHolderPct, top5Pct, blocking, concerns };
}

// ── Deployer wallet profile ─────────────────────────────────────────────────
/**
 * Who launched this, judged by the only wallet evidence a single RPC call can buy.
 *
 * Finding a creator's PREVIOUS launches was tried and abandoned: `getAssetsByCreator`
 * returns nothing for pump.fun mints (the DAS creator is the program, not the wallet),
 * and sampling their transaction history cost 13 RPC calls per coin and surfaced zero
 * prior mints in 12 sampled transactions. Too expensive for too little.
 *
 * What one call to `getSignaturesForAddress` does buy is the shape of the wallet, and
 * measured on real deployers it separates cleanly:
 *
 *     2 txs over 3.2 days     → a wallet made to launch this and nothing else
 *     500 txs over 108 days   → someone with a history to lose
 *     500 txs within one day  → an automation, launching at industrial rate
 *
 * The third is the one that surprises: a very high transaction count is normally read
 * as "established", but 500 transactions inside a single day is a bot, and a bot that
 * deploys tokens is a token factory rather than a founder.
 */
export type DeployerProfile = "THROWAWAY" | "YOUNG" | "ESTABLISHED" | "HIGH_FREQUENCY" | "UNKNOWN";

export interface DeployerWalletInput {
  /** Number of signatures returned (capped by the page size used). */
  txCount: number | null;
  /** Page size used for the query — needed to know whether txCount is a cap. */
  pageLimit: number;
  /** Days between the oldest signature seen and now. */
  historyDays: number | null;
}

export interface DeployerWalletResult {
  profile: DeployerProfile;
  reason: string;
  /** True when this alone justifies walking away. */
  blocking: boolean;
}

export const DEPLOYER = {
  /** Below this many transactions AND days, the wallet exists only for this launch. */
  THROWAWAY_TX: 60,
  THROWAWAY_DAYS: 2,
  /** A wallet at the page cap inside this many days is automation, not a person. */
  HIGH_FREQ_DAYS: 1,
  YOUNG_DAYS: 7,
} as const;

export function analyzeDeployerWallet(i: DeployerWalletInput): DeployerWalletResult {
  if (i.txCount == null || i.historyDays == null) {
    return { profile: "UNKNOWN", reason: "deployer wallet history not available", blocking: false };
  }
  const atCap = i.txCount >= i.pageLimit;
  if (atCap && i.historyDays <= DEPLOYER.HIGH_FREQ_DAYS) {
    return {
      profile: "HIGH_FREQUENCY",
      reason: `deployer made ${i.txCount}+ transactions in ${i.historyDays.toFixed(1)} days — automation, not a founder`,
      blocking: true,
    };
  }
  if (i.txCount < DEPLOYER.THROWAWAY_TX && i.historyDays < DEPLOYER.THROWAWAY_DAYS) {
    return {
      profile: "THROWAWAY",
      reason: `deployer wallet is ${i.historyDays.toFixed(1)} days old with ${i.txCount} transactions — made for this launch`,
      blocking: true,
    };
  }
  if (i.historyDays < DEPLOYER.YOUNG_DAYS) {
    return { profile: "YOUNG", reason: `deployer wallet is ${i.historyDays.toFixed(1)} days old`, blocking: false };
  }
  return { profile: "ESTABLISHED", reason: `deployer has ${i.historyDays.toFixed(0)} days of wallet history`, blocking: false };
}
