import type { CandidateState, Severity } from "@aureus/contracts";

export const ALERT_ENGINE_VERSION = "ae-0.1.0";

export const ALERT_LEVELS = ["INFO", "WATCH", "HIGH_PRIORITY", "ENTRY_READY", "RISK", "SYSTEM"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Ordering for min-level filtering (SYSTEM sits alongside HIGH). */
export const LEVEL_RANK: Record<AlertLevel, number> = {
  INFO: 0, WATCH: 1, HIGH_PRIORITY: 2, SYSTEM: 2, ENTRY_READY: 3, RISK: 4,
};

export type SafetyAgg = "PASSED" | "INCOMPLETE" | "FAILED";
export type QualityAgg = "WEAK" | "DEVELOPING" | "CONFIRMED";

export interface AlertPolicyConfig {
  minLiquidityUsd: number;
  minVolumeUsd: number;
  maxPairAgeMs: number;
  maxDataAgeMs: number;
  cooldownMinutes: number;
}

export const DEFAULT_ALERT_CONFIG: AlertPolicyConfig = {
  minLiquidityUsd: 10_000,
  minVolumeUsd: 5_000,
  maxPairAgeMs: 7 * 24 * 60 * 60_000,
  maxDataAgeMs: 180_000,
  cooldownMinutes: 15,
};

/** Everything a policy needs to decide — all deterministic facts, no AI score. */
export interface AlertContext {
  candidateId: string;
  symbol: string | null;
  mint: string;
  pool: string | null;
  stateFrom: CandidateState | null;
  stateTo: CandidateState;

  safety: SafetyAgg;
  quality: QualityAgg;
  entry: string; // EntryStatus | 'NONE'
  freshnessOk: boolean;
  openCriticalDataQuality: boolean;
  hasCriticalFail: boolean;
  overextended: boolean;
  invalidationAvailable: boolean;

  liquidityUsd: number | null;
  volumeUsd: number | null;
  fdvUsd: number | null;
  pairAgeMs: number | null;
  dataAgeMs: number | null;

  heliusMode: "LIVE" | "DEGRADED" | "MOCK";

  positives: string[];
  missing: string[];
  riskReasons: string[];
  previouslyAlerted: boolean;

  config: AlertPolicyConfig;
}

export interface AlertProposal {
  policyId: string;
  policyVersion: string;
  level: AlertLevel;
  severity: Severity;
  stateFrom: CandidateState | null;
  stateTo: CandidateState;
  evidence: Record<string, unknown>;
  evidenceHash: string;
  reasons: string[];
  positives: string[];
  missing: string[];
  riskReasons: string[];
}

/** Stable FNV-1a hash of a canonical object → evidence_hash. */
export function stableHash(obj: unknown): string {
  const s = JSON.stringify(obj, (_k, v) => v, 0) ?? "";
  const canon = typeof obj === "object" && obj !== null ? JSON.stringify(sortKeys(obj)) : s;
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === "object") {
    return Object.fromEntries(
      Object.keys(o as Record<string, unknown>).sort().map((k) => [k, sortKeys((o as Record<string, unknown>)[k])]),
    );
  }
  return o;
}
