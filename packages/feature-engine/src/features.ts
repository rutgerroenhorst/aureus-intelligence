import type { FeatureValue, Source } from "@aureus/contracts";
import { DEFAULT_TTL, type FeatureInput } from "./input.js";
import { latest, atOrBefore, isStale, ok, missing, unavailable, stale } from "./helpers.js";

export type Calculator = (input: FeatureInput) => FeatureValue;

interface Def {
  id: string;
  unit: string;
  window: string;
  description: string;
  requiredInputs: string[];
  calc: Calculator;
}

const uniq = <T extends { source: Source }>(pts: T[]): Source[] => [...new Set(pts.map((p) => p.source))];
const ctxOf = (input: FeatureInput, window: string) => ({ nowMs: input.nowMs, window });

// ── Liquidity retention family ─────────────────────────────────────────────
function liqRetention(input: FeatureInput, windowMs: number, label: string, id: string): FeatureValue {
  const ctx = ctxOf(input, label);
  const ttl = input.ttl ?? DEFAULT_TTL;
  const now = latest(input.liquidity, input.nowMs);
  if (!now) return missing(id, "ratio", ctx, "no liquidity observations");
  if (isStale(now, input.nowMs, ttl.liquidityMs)) return stale(id, "ratio", ctx, "latest liquidity observation is stale");
  const baseline = atOrBefore(input.liquidity, input.nowMs - windowMs, windowMs / 2);
  if (!baseline) return missing(id, "ratio", ctx, `no liquidity observation near ${label} ago`);
  if (baseline.liquidityUsd <= 0) return missing(id, "ratio", ctx, "baseline liquidity is zero");
  const value = now.liquidityUsd / baseline.liquidityUsd;
  return ok(id, "ratio", ctx, value, uniq([now, baseline]), 0.9,
    `current liquidity ${now.liquidityUsd} / baseline ${baseline.liquidityUsd} over ${label}`);
}

// ── Demand family (Dex Screener tx aggregates) ─────────────────────────────
function twoLatestSameWindow(input: FeatureInput): [typeof input.txAggregates[number], typeof input.txAggregates[number]] | null {
  const byWindow = new Map<number, typeof input.txAggregates>();
  for (const p of input.txAggregates) {
    if (p.observedAtMs > input.nowMs) continue;
    const arr = byWindow.get(p.windowSeconds) ?? [];
    arr.push(p);
    byWindow.set(p.windowSeconds, arr);
  }
  let best: typeof input.txAggregates | null = null;
  for (const arr of byWindow.values()) {
    if (arr.length >= 2 && (!best || arr.length > best.length)) best = arr;
  }
  if (!best) return null;
  const sorted = [...best].sort((a, b) => a.observedAtMs - b.observedAtMs);
  return [sorted[sorted.length - 2]!, sorted[sorted.length - 1]!];
}

function growth(input: FeatureInput, id: string, field: "buyers" | "sellers"): FeatureValue {
  const ctx = ctxOf(input, "consecutive-windows");
  const pair = twoLatestSameWindow(input);
  if (!pair) return missing(id, "ratio", ctx, "need two consecutive tx-aggregate windows");
  const [prev, cur] = pair;
  if (prev[field] == null || cur[field] == null) return missing(id, "ratio", ctx, `${field} not reported`);
  if ((prev[field] as number) <= 0) return missing(id, "ratio", ctx, `previous ${field} is zero`);
  const value = (cur[field] as number) / (prev[field] as number);
  return ok(id, "ratio", ctx, value, uniq([prev, cur]), 0.75,
    `${field} ${cur[field]} vs previous ${prev[field]}`);
}

// ── On-chain-derived features (UNAVAILABLE without Helius) ──────────────────
function onChainScalar(
  input: FeatureInput,
  id: string,
  unit: string,
  window: string,
  pick: (o: FeatureInput["onChain"]) => number | undefined,
  dq: number,
  explain: (v: number) => string,
): FeatureValue {
  const ctx = ctxOf(input, window);
  if (!input.onChain.available) return unavailable(id, unit, ctx, "on-chain source (Helius) not available");
  const v = pick(input.onChain);
  if (v == null) return missing(id, unit, ctx, "on-chain value not present despite source available");
  return ok(id, unit, ctx, v, ["helius"], dq, explain(v));
}

// ── Registry ───────────────────────────────────────────────────────────────
export const FEATURE_DEFS: Def[] = [
  {
    id: "liquidity_retention_15m", unit: "ratio", window: "15m",
    description: "Current liquidity relative to ~15m ago.", requiredInputs: ["liquidity_snapshots"],
    calc: (i) => liqRetention(i, 15 * 60_000, "15m", "liquidity_retention_15m"),
  },
  {
    id: "liquidity_retention_1h", unit: "ratio", window: "1h",
    description: "Current liquidity relative to ~1h ago.", requiredInputs: ["liquidity_snapshots"],
    calc: (i) => liqRetention(i, 60 * 60_000, "1h", "liquidity_retention_1h"),
  },
  {
    id: "liquidity_retention_6h", unit: "ratio", window: "6h",
    description: "Current liquidity relative to ~6h ago.", requiredInputs: ["liquidity_snapshots"],
    calc: (i) => liqRetention(i, 6 * 60 * 60_000, "6h", "liquidity_retention_6h"),
  },
  {
    id: "marketcap_liquidity_ratio", unit: "ratio", window: "instant",
    description: "Market cap divided by pool liquidity (froth indicator).",
    requiredInputs: ["prices", "liquidity_snapshots"],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      const p = latest(i.prices, i.nowMs);
      const l = latest(i.liquidity, i.nowMs);
      if (!p || p.marketCapUsd == null) return missing("marketcap_liquidity_ratio", "ratio", ctx, "no market cap");
      if (!l || l.liquidityUsd <= 0) return missing("marketcap_liquidity_ratio", "ratio", ctx, "no liquidity");
      const ttl = i.ttl ?? DEFAULT_TTL;
      if (isStale(p, i.nowMs, ttl.priceMs) || isStale(l, i.nowMs, ttl.liquidityMs))
        return stale("marketcap_liquidity_ratio", "ratio", ctx, "price or liquidity stale");
      return ok("marketcap_liquidity_ratio", "ratio", ctx, p.marketCapUsd / l.liquidityUsd, uniq([p, l]), 0.85,
        `mcap ${p.marketCapUsd} / liq ${l.liquidityUsd}`);
    },
  },
  {
    id: "unique_buyer_growth", unit: "ratio", window: "consecutive-windows",
    description: "Unique buyers this window vs previous.", requiredInputs: ["transaction_aggregates"],
    calc: (i) => growth(i, "unique_buyer_growth", "buyers"),
  },
  {
    id: "unique_seller_growth", unit: "ratio", window: "consecutive-windows",
    description: "Unique sellers this window vs previous.", requiredInputs: ["transaction_aggregates"],
    calc: (i) => growth(i, "unique_seller_growth", "sellers"),
  },
  {
    id: "buyer_seller_ratio", unit: "ratio", window: "latest-window",
    description: "Buyers divided by sellers in the latest window.", requiredInputs: ["transaction_aggregates"],
    calc: (i) => {
      const ctx = ctxOf(i, "latest-window");
      const t = latest(i.txAggregates, i.nowMs);
      if (!t || t.buyers == null || t.sellers == null) return missing("buyer_seller_ratio", "ratio", ctx, "buyers/sellers not reported");
      if (t.sellers <= 0) return ok("buyer_seller_ratio", "ratio", ctx, t.buyers > 0 ? 999 : 0, [t.source], 0.6, "no sellers in window (capped)");
      return ok("buyer_seller_ratio", "ratio", ctx, t.buyers / t.sellers, [t.source], 0.75, `${t.buyers} buyers / ${t.sellers} sellers`);
    },
  },
  {
    id: "buyer_concentration", unit: "fraction", window: "latest-window",
    description: "Share of buy volume from the largest buyers (needs trade-level data).",
    requiredInputs: ["helius_trades"],
    calc: (i) => onChainScalar(i, "buyer_concentration", "fraction", "latest-window", (o) => o.buyerConcentration, 0.8, (v) => `top-buyer share ${v}`),
  },
  {
    id: "wallet_group_diversity", unit: "ratio", window: "instant",
    description: "Independent holder groups relative to holder count (higher = more diverse).",
    requiredInputs: ["clusters", "holder_snapshots"],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      if (!i.onChain.available) return unavailable("wallet_group_diversity", "ratio", ctx, "on-chain cluster/holder data unavailable");
      const groups = i.onChain.clusterGroupCount;
      const h = latest(i.holders, i.nowMs);
      if (groups == null || !h || h.holderCount == null || h.holderCount <= 0)
        return missing("wallet_group_diversity", "ratio", ctx, "cluster count or holder count missing");
      return ok("wallet_group_diversity", "ratio", ctx, groups / h.holderCount, ["helius"], 0.7, `${groups} groups / ${h.holderCount} holders`);
    },
  },
  {
    id: "deployer_funding_risk", unit: "score01", window: "instant",
    description: "Composite deployer+funding reputation risk (0 safe .. 1 risky).",
    requiredInputs: ["deployers", "funding_wallets"],
    calc: (i) => onChainScalar(i, "deployer_funding_risk", "score01", "instant", (o) => o.fundingRiskScore, 0.7, (v) => `funding-risk score ${v}`),
  },
  {
    id: "insider_concentration", unit: "fraction", window: "instant",
    description: "Supply share held by deployer/funder-linked wallets.",
    requiredInputs: ["holder_snapshots", "funding_wallets"],
    calc: (i) => onChainScalar(i, "insider_concentration", "fraction", "instant", (o) => o.insiderPct ?? undefined, 0.8, (v) => `insider share ${v}`),
  },
  {
    id: "holder_concentration", unit: "fraction", window: "instant",
    description: "Supply share held by the top 10 holders.", requiredInputs: ["holder_snapshots"],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      // Prefer on-chain; fall back to a holder snapshot that carries top10Pct.
      if (i.onChain.available && i.onChain.holderTop10Pct != null)
        return ok("holder_concentration", "fraction", ctx, i.onChain.holderTop10Pct, ["helius"], 0.85, `top10 ${i.onChain.holderTop10Pct}`);
      const h = latest(i.holders, i.nowMs);
      if (h && h.top10Pct != null) return ok("holder_concentration", "fraction", ctx, h.top10Pct, [h.source], 0.7, `top10 ${h.top10Pct}`);
      return unavailable("holder_concentration", "fraction", ctx, "no holder concentration source (needs Helius holders)");
    },
  },
  {
    id: "bundle_contamination", unit: "fraction", window: "instant",
    description: "Supply share acquired in a same-block launch bundle.", requiredInputs: ["launch_bundles"],
    calc: (i) => onChainScalar(i, "bundle_contamination", "fraction", "instant", (o) => o.bundleSupplyPct, 0.8, (v) => `bundled supply ${v}`),
  },
  {
    id: "smart_wallet_count", unit: "count", window: "instant",
    description: "Count of reputable/'smart' wallets currently participating.", requiredInputs: ["wallet_performance"],
    calc: (i) => onChainScalar(i, "smart_wallet_count", "count", "instant", (o) => o.smartWalletCount, 0.7, (v) => `${v} smart wallets`),
  },
  {
    id: "smart_wallet_net_flow", unit: "usd", window: "1h",
    description: "Net USD flow of smart wallets (positive = accumulating).", requiredInputs: ["wallet_performance"],
    calc: (i) => onChainScalar(i, "smart_wallet_net_flow", "usd", "1h", (o) => o.smartWalletNetFlowUsd, 0.7, (v) => `net flow ${v} USD`),
  },
  {
    id: "smart_wallet_hold_ratio", unit: "fraction", window: "instant",
    description: "Share of participating smart wallets still holding.", requiredInputs: ["wallet_performance"],
    calc: (i) => onChainScalar(i, "smart_wallet_hold_ratio", "fraction", "instant", (o) => o.smartWalletHoldRatio, 0.7, (v) => `hold ratio ${v}`),
  },
  {
    id: "lp_change_rate", unit: "per_hour", window: "1h",
    description: "Fractional change in liquidity over the last hour.", requiredInputs: ["liquidity_snapshots"],
    calc: (i) => {
      const ctx = ctxOf(i, "1h");
      const now = latest(i.liquidity, i.nowMs);
      if (!now) return missing("lp_change_rate", "per_hour", ctx, "no liquidity observations");
      const earlier = atOrBefore(i.liquidity, i.nowMs - 60 * 60_000, 30 * 60_000);
      if (!earlier || earlier.liquidityUsd <= 0) return missing("lp_change_rate", "per_hour", ctx, "no liquidity ~1h ago");
      const value = (now.liquidityUsd - earlier.liquidityUsd) / earlier.liquidityUsd;
      return ok("lp_change_rate", "per_hour", ctx, value, uniq([now, earlier]), 0.85, `Δliq ${value} over 1h`);
    },
  },
  {
    id: "price_drawdown_from_local_high", unit: "fraction", window: "6h",
    description: "Drawdown of price from its local high over the last 6h.", requiredInputs: ["prices"],
    calc: (i) => {
      const ctx = ctxOf(i, "6h");
      const window = i.prices.filter((p) => p.observedAtMs <= i.nowMs && p.observedAtMs >= i.nowMs - 6 * 60 * 60_000);
      const now = latest(i.prices, i.nowMs);
      if (!now || window.length === 0) return missing("price_drawdown_from_local_high", "fraction", ctx, "no price history in window");
      const high = Math.max(...window.map((p) => p.priceUsd));
      if (high <= 0) return missing("price_drawdown_from_local_high", "fraction", ctx, "invalid high");
      return ok("price_drawdown_from_local_high", "fraction", ctx, (high - now.priceUsd) / high, uniq(window), 0.8, `high ${high}, now ${now.priceUsd}`);
    },
  },
  {
    id: "price_distance_from_range", unit: "fraction", window: "6h",
    description: "Position of current price within its recent range (0=low, 1=high).", requiredInputs: ["prices"],
    calc: (i) => {
      const ctx = ctxOf(i, "6h");
      const window = i.prices.filter((p) => p.observedAtMs <= i.nowMs && p.observedAtMs >= i.nowMs - 6 * 60 * 60_000);
      const now = latest(i.prices, i.nowMs);
      if (!now || window.length < 3) return missing("price_distance_from_range", "fraction", ctx, "insufficient price history for a range");
      const lo = Math.min(...window.map((p) => p.priceUsd));
      const hi = Math.max(...window.map((p) => p.priceUsd));
      if (hi - lo <= 0) return missing("price_distance_from_range", "fraction", ctx, "degenerate range");
      return ok("price_distance_from_range", "fraction", ctx, (now.priceUsd - lo) / (hi - lo), uniq(window), 0.8, `range [${lo}, ${hi}], now ${now.priceUsd}`);
    },
  },
  {
    id: "attention_velocity", unit: "per_hour", window: "social-window",
    description: "Rate of change of organic (non-paid) attention.", requiredInputs: ["social_observations"],
    calc: (i) => {
      const ctx = ctxOf(i, "social-window");
      const organic = i.social.filter((s) => !s.isPaid && s.observedAtMs <= i.nowMs).sort((a, b) => a.observedAtMs - b.observedAtMs);
      if (organic.length < 2) return missing("attention_velocity", "per_hour", ctx, "need >=2 organic social observations");
      const a = organic[0]!, b = organic[organic.length - 1]!;
      const hours = (b.observedAtMs - a.observedAtMs) / 3_600_000;
      if (hours <= 0) return missing("attention_velocity", "per_hour", ctx, "zero timespan");
      return ok("attention_velocity", "per_hour", ctx, (b.value - a.value) / hours, uniq(organic), 0.55, `Δattention ${(b.value - a.value)} over ${hours}h`);
    },
  },
  {
    id: "boost_dependency", unit: "fraction", window: "social-window",
    description: "Share of attention that is paid promotion (boosts).", requiredInputs: ["social_observations"],
    calc: (i) => {
      const ctx = ctxOf(i, "social-window");
      const recent = i.social.filter((s) => s.observedAtMs <= i.nowMs);
      if (recent.length === 0) return missing("boost_dependency", "fraction", ctx, "no social observations");
      const paid = recent.filter((s) => s.isPaid).reduce((a, s) => a + s.value, 0);
      const total = recent.reduce((a, s) => a + s.value, 0);
      if (total <= 0) return missing("boost_dependency", "fraction", ctx, "zero total attention");
      return ok("boost_dependency", "fraction", ctx, paid / total, uniq(recent), 0.6, `paid ${paid} / total ${total}`);
    },
  },
  {
    id: "source_agreement", unit: "fraction", window: "instant",
    description: "Cross-source agreement on latest liquidity (1=agree, 0=disagree). Needs >=2 sources.",
    requiredInputs: ["liquidity_snapshots"],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      const bySource = new Map<Source, number>();
      for (const p of i.liquidity) {
        if (p.observedAtMs > i.nowMs) continue;
        const prev = bySource.get(p.source);
        if (prev == null) bySource.set(p.source, p.liquidityUsd);
      }
      const vals = [...bySource.values()];
      if (vals.length < 2) return missing("source_agreement", "fraction", ctx, "single source — cannot cross-check");
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (mean <= 0) return missing("source_agreement", "fraction", ctx, "zero mean liquidity");
      const spread = (Math.max(...vals) - Math.min(...vals)) / mean;
      return ok("source_agreement", "fraction", ctx, Math.max(0, 1 - spread), [...bySource.keys()], 0.8, `spread ${spread} across ${vals.length} sources`);
    },
  },
  {
    id: "data_completeness", unit: "fraction", window: "instant",
    description: "Fraction of expected input classes that are present.", requiredInputs: [],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      const classes = [
        i.prices.length > 0,
        i.liquidity.length > 0,
        i.txAggregates.length > 0,
        i.holders.length > 0,
        i.social.length > 0,
        i.onChain.available,
      ];
      const present = classes.filter(Boolean).length;
      return ok("data_completeness", "fraction", ctx, present / classes.length, i.sourcesPresent, 1, `${present}/${classes.length} input classes present`);
    },
  },
  {
    id: "data_freshness", unit: "score01", window: "instant",
    description: "Freshness score (1=all fresh, 0=fully stale) across present classes.", requiredInputs: [],
    calc: (i) => {
      const ctx = ctxOf(i, "instant");
      const ttl = i.ttl ?? DEFAULT_TTL;
      const scores: number[] = [];
      const add = (pt: { observedAtMs: number } | undefined, ttlMs: number) => {
        if (!pt) return;
        const age = i.nowMs - pt.observedAtMs;
        scores.push(Math.max(0, Math.min(1, 1 - age / ttlMs)));
      };
      add(latest(i.prices, i.nowMs), ttl.priceMs);
      add(latest(i.liquidity, i.nowMs), ttl.liquidityMs);
      add(latest(i.txAggregates, i.nowMs), ttl.txMs);
      add(latest(i.holders, i.nowMs), ttl.holdersMs);
      add(latest(i.social, i.nowMs), ttl.socialMs);
      if (scores.length === 0) return ok("data_freshness", "score01", ctx, 0, i.sourcesPresent, 0.5, "no observations to score");
      return ok("data_freshness", "score01", ctx, Math.min(...scores), i.sourcesPresent, 0.9, `worst-class freshness of ${scores.length} classes`);
    },
  },
];
