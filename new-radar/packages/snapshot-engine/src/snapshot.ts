import type {
  CandidateSnapshot,
  CandidateState,
  EngineVersions,
  FeatureValue,
  RuleEvaluation,
  SnapshotKind,
} from "@aureus/contracts";
import { SNAPSHOT_KINDS, SNAPSHOT_OFFSETS_MS } from "@aureus/contracts";

export const SNAPSHOT_ENGINE_VERSION = "se-0.1.0";

export interface SnapshotInput {
  candidateId: string;
  kind: SnapshotKind;
  discoveryAtMs: number;
  takenAtMs: number;
  decisionState: CandidateState;
  engineVersions: EngineVersions;
  market: Record<string, unknown> | null;
  liquidity: Record<string, unknown> | null;
  holders: Record<string, unknown> | null;
  walletFlows: Record<string, unknown> | null;
  features: FeatureValue[];
  rules: RuleEvaluation[];
}

/** The scheduled snapshot instants for a candidate. */
export function computeSchedule(discoveryAtMs: number): Array<{ kind: SnapshotKind; scheduledForMs: number }> {
  return SNAPSHOT_KINDS.map((kind) => ({ kind, scheduledForMs: discoveryAtMs + SNAPSHOT_OFFSETS_MS[kind] }));
}

export type DataQualityStatus = "OK" | "DEGRADED" | "CONFLICTED" | "STALE";

/** Derive a single data-quality label from the features + rules in the snapshot. */
export function deriveDataQualityStatus(features: FeatureValue[], rules: RuleEvaluation[]): DataQualityStatus {
  const conflict = rules.find((r) => r.ruleId === "DQ-02-SOURCE-CONFLICT");
  if (conflict?.result === "FAIL") return "CONFLICTED";
  const freshnessRule = rules.find((r) => r.ruleId === "DQ-01-FRESHNESS");
  const freshnessFeature = features.find((f) => f.featureId === "data_freshness");
  if (freshnessRule?.result === "FAIL" || freshnessFeature?.status === "STALE") return "STALE";
  const anyStale = features.some((f) => f.status === "STALE");
  if (anyStale) return "STALE";
  const anyMissing = features.some((f) => f.status === "MISSING" || f.status === "UNAVAILABLE");
  if (anyMissing) return "DEGRADED";
  return "OK";
}

export function buildSnapshot(input: SnapshotInput): CandidateSnapshot {
  return {
    candidateId: input.candidateId,
    kind: input.kind,
    scheduledFor: new Date(input.discoveryAtMs + SNAPSHOT_OFFSETS_MS[input.kind]).toISOString(),
    takenAt: new Date(input.takenAtMs).toISOString(),
    decisionState: input.decisionState,
    dataQualityStatus: deriveDataQualityStatus(input.features, input.rules),
    engineVersions: input.engineVersions,
    market: input.market,
    liquidity: input.liquidity,
    holders: input.holders,
    walletFlows: input.walletFlows,
    features: input.features,
    rules: input.rules,
  };
}
