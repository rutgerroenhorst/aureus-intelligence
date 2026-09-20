/**
 * Deterministic active-candidate monitoring: assign a priority tier + a scheduling
 * priority score from state, rules, blockers, liquidity/volume, pair age, enrichment
 * status, last change, and freshness. This is a SCHEDULING priority, NOT a win
 * probability. Interesting candidates are polled fast; dead ones go dormant.
 */
import type { CandidateState } from "@aureus/contracts";

export type MonitoringTier = "TIER0_DORMANT" | "TIER1_LOW" | "TIER2_ENRICHMENT" | "TIER3_WATCH" | "TIER4_TRADE";

/** Base scan interval per tier (ms). */
export const TIER_INTERVAL_MS: Record<MonitoringTier, number> = {
  TIER0_DORMANT: 24 * 60 * 60_000,
  TIER1_LOW: 20 * 60_000,
  TIER2_ENRICHMENT: 120_000,
  TIER3_WATCH: 40_000,
  TIER4_TRADE: 12_000,
};

export const MONITORING_WINDOW_MS = Number(process.env.MONITORING_WINDOW_HOURS ?? 168) * 60 * 60_000; // 7d

export interface TierInput {
  state: CandidateState;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  liquidityTrend: number | null; // fractional change since previous scan (+ up)
  volumeTrend: number | null;
  dataCompleteness: number | null; // 0..1
  enrichmentStatus: string; // NOT_REQUESTED/QUEUED/RUNNING/PARTIAL/COMPLETE/FAILED/RETRYING/STALE
  hasCriticalMarketFail: boolean; // e.g. SAFE-05 liquidity drain
  isRug: boolean;
  freshnessScore: number | null; // 0..1 (1 fresh)
  requiredInputsAvailable: number; // safety inputs available (proximity)
  requiredInputsTotal: number;
}

export interface MonitoringDecision {
  tier: MonitoringTier;
  intervalMs: number;
  priorityScore: number;
  components: Record<string, number>;
  reason: string;
}

const TIER_BASE: Record<MonitoringTier, number> = {
  TIER0_DORMANT: 0, TIER1_LOW: 20, TIER2_ENRICHMENT: 60, TIER3_WATCH: 80, TIER4_TRADE: 100,
};

export function computeMonitoring(i: TierInput): MonitoringDecision {
  const poolInactive = (i.liquidityUsd ?? 0) < 500;
  let tier: MonitoringTier;
  let reason: string;

  if (i.state === "REJECTED" || i.state === "EXPIRED") { tier = "TIER0_DORMANT"; reason = `state ${i.state}`; }
  else if (i.isRug) { tier = "TIER0_DORMANT"; reason = "confirmed rug"; }
  else if (poolInactive) { tier = "TIER0_DORMANT"; reason = "pool inactive (liquidity ~0)"; }
  else if (i.state === "ENTRY_WATCH" || i.state === "ENTRY_READY" || i.state === "POSITION_RISK") { tier = "TIER4_TRADE"; reason = `trade proximity (${i.state})`; }
  else if (i.state === "STRUCTURE_WATCH" || i.state === "QUALITY_CONFIRMED" || i.state === "OVEREXTENDED") { tier = "TIER3_WATCH"; reason = `watch (${i.state})`; }
  else {
    const strongMarket = (i.liquidityUsd ?? 0) >= 10_000 && (i.volumeUsd ?? 0) >= 5_000 && !i.hasCriticalMarketFail;
    const awaitingHelius = i.enrichmentStatus !== "COMPLETE";
    if (strongMarket && awaitingHelius) { tier = "TIER2_ENRICHMENT"; reason = "strong market data, awaiting on-chain enrichment"; }
    else { tier = "TIER1_LOW"; reason = "weak/low-liquidity, low priority"; }
  }

  // Priority score (ordering within a cycle). Deterministic weighted sum.
  const components: Record<string, number> = { tierBase: TIER_BASE[tier] };
  if (tier !== "TIER0_DORMANT") {
    components.liquidityTrend = i.liquidityTrend != null ? Math.max(-10, Math.min(10, i.liquidityTrend * 20)) : 0;
    components.volumeTrend = i.volumeTrend != null ? Math.max(-10, Math.min(10, i.volumeTrend * 10)) : 0;
    components.proximity = i.requiredInputsTotal > 0 ? (i.requiredInputsAvailable / i.requiredInputsTotal) * 10 : 0;
    components.staleBoost = i.freshnessScore != null ? (1 - i.freshnessScore) * 8 : 0; // stale → refresh sooner
    components.dataCompleteness = (i.dataCompleteness ?? 0) * 5;
  }
  const priorityScore = Object.values(components).reduce((a, b) => a + b, 0);

  return { tier, intervalMs: TIER_INTERVAL_MS[tier], priorityScore: Math.round(priorityScore * 1000) / 1000, components, reason };
}
