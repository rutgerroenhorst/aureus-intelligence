/** Engine-layer contracts: features, rules, transitions, snapshots, outcomes. */
import type { CandidateState, Severity, Source } from "./index.js";

// ── Features ──────────────────────────────────────────────────────────────
export const FEATURE_STATUSES = ["OK", "MISSING", "UNAVAILABLE", "STALE", "PARTIAL"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export interface FeatureValue {
  featureId: string;
  version: string;
  status: FeatureStatus;
  /** Numeric value — present only when status is OK or PARTIAL, else null. */
  value: number | null;
  unit: string;
  calculatedAt: string; // ISO
  observationWindow: string; // '15m' | '1h' | 'instant' | ...
  sourceInputs: Source[];
  dataQuality: number | null; // 0..1
  missingReason: string | null;
  explanation: string;
}

// ── Rules ─────────────────────────────────────────────────────────────────
export const RULE_FAMILIES = ["SAFETY", "QUALITY", "ENTRY", "POSITION_RISK", "DATA_QUALITY"] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

export const RULE_RESULTS = ["PASS", "FAIL", "INCOMPLETE", "NOT_APPLICABLE"] as const;
export type RuleResult = (typeof RULE_RESULTS)[number];

export interface RuleEvaluation {
  ruleId: string;
  ruleVersion: string;
  family: RuleFamily;
  requiredFeatures: string[];
  result: RuleResult;
  severity: Severity;
  evidence: Record<string, unknown>;
  evaluatedAt: string; // ISO
  expiresAt: string | null;
  explanation: string;
  invalidation: string;
}

// ── Decision reduction ────────────────────────────────────────────────────
export interface DecisionInput {
  safety: RuleEvaluation[];
  quality: RuleEvaluation[];
  entry: RuleEvaluation[];
  positionRisk: RuleEvaluation[];
  dataQuality: RuleEvaluation[];
  hasOpenPosition: boolean;
  discoveryAt: string;
  now: string;
  discoveryTtlMs?: number; // window before an unqualified candidate EXPIRES
}

export interface DecisionOutput {
  state: CandidateState;
  reason: string;
  safetyStatus: "PASSED" | "INCOMPLETE" | "FAILED";
  qualityStatus: "WEAK" | "DEVELOPING" | "CONFIRMED";
  entryStatus: "TOO_EARLY" | "WAIT_FOR_LEVEL" | "READY" | "OVEREXTENDED" | "INVALIDATED" | "EXPIRED" | "NONE";
}

// ── Snapshots ─────────────────────────────────────────────────────────────
export const SNAPSHOT_KINDS = ["discovery", "m15", "h1", "h6", "h24", "h72", "d7", "d30"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

/** Offset in milliseconds from discovery for each snapshot kind. */
export const SNAPSHOT_OFFSETS_MS: Record<SnapshotKind, number> = {
  discovery: 0,
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  h6: 6 * 60 * 60_000,
  h24: 24 * 60 * 60_000,
  h72: 72 * 60 * 60_000,
  d7: 7 * 24 * 60 * 60_000,
  d30: 30 * 24 * 60 * 60_000,
};

export interface EngineVersions {
  feature: string;
  rule: string;
  snapshot: string;
  outcome?: string;
}

export interface CandidateSnapshot {
  candidateId: string;
  kind: SnapshotKind;
  scheduledFor: string;
  takenAt: string;
  decisionState: CandidateState;
  dataQualityStatus: "OK" | "DEGRADED" | "CONFLICTED" | "STALE";
  engineVersions: EngineVersions;
  market: Record<string, unknown> | null;
  liquidity: Record<string, unknown> | null;
  holders: Record<string, unknown> | null;
  walletFlows: Record<string, unknown> | null;
  features: FeatureValue[];
  rules: RuleEvaluation[];
}
