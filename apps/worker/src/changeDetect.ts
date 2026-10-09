/**
 * Change-based persistence: decide whether a freshly computed feature value or
 * rule evaluation is worth writing, vs the last stored one. This is the write-
 * amplification fix — identical results within a checkpoint are NOT re-written.
 *
 * Raw time-series observations are handled separately (they stay full-resolution).
 */
import type { FeatureValue, RuleEvaluation } from "@aureus/contracts";

const min = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

export const FEATURE_CHECKPOINT_MS = min("FEATURE_AUDIT_CHECKPOINT_MINUTES", 60) * 60_000;
export const RULE_CHECKPOINT_MS = min("RULE_AUDIT_CHECKPOINT_MINUTES", 60) * 60_000;

/** Per-feature numeric change thresholds (absolute and/or relative). */
interface Epsilon { abs?: number; rel?: number }
const FEATURE_EPSILON: Record<string, Epsilon> = {
  liquidity_retention_15m: { rel: 0.005 },
  liquidity_retention_1h: { rel: 0.005 },
  liquidity_retention_6h: { rel: 0.005 },
  data_completeness: { abs: 0.01 },
  data_freshness: { abs: 0.02 },
  insider_concentration: { abs: 0.0025 },
  holder_concentration: { abs: 0.0025 },
  buyer_concentration: { abs: 0.0025 },
  bundle_contamination: { abs: 0.0025 },
  smart_wallet_hold_ratio: { abs: 0.0025 },
};
const DEFAULT_EPSILON: Epsilon = { rel: 0.01 };

export interface StoredFeature {
  status: string;
  value: number | null;
  version: string;
  evidenceHash: string | null;
  calculatedAtMs: number;
}
export interface StoredRule {
  result: string;
  severity: string;
  ruleVersion: string;
  evidenceHash: string | null;
  evaluatedAtMs: number;
}

export type WriteReason =
  | "new" | "status" | "numeric" | "evidence" | "version" | "checkpoint"
  | "result" | "severity" | "unchanged" | "nonfinite";

export interface WriteDecision {
  write: boolean;
  reason: WriteReason;
  /** A meaningful change is anything except a plain audit checkpoint / no-op. */
  meaningful: boolean;
}

const NO: WriteDecision = { write: false, reason: "unchanged", meaningful: false };

/** Stable FNV-1a hash of a canonical object. */
export function stableHash(obj: unknown): string {
  const canon = JSON.stringify(sortKeys(obj));
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) { h ^= canon.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === "object") return Object.fromEntries(Object.keys(o as object).sort().map((k) => [k, sortKeys((o as Record<string, unknown>)[k])]));
  return o;
}

/**
 * Feature evidence hash intentionally EXCLUDES the numeric value (governed by
 * epsilon) so metadata changes (sources, missing reason) trigger a write while
 * tiny numeric jitter does not.
 */
export function featureEvidenceHash(f: FeatureValue): string {
  return stableHash({ status: f.status, unit: f.unit, sources: f.sourceInputs, missing: f.missingReason, window: f.observationWindow });
}
export function ruleEvidenceHash(r: RuleEvaluation): string {
  return stableHash({ evidence: r.evidence, explanation: r.explanation, invalidation: r.invalidation });
}

function numericChanged(prev: number, next: number, eps: Epsilon): boolean {
  const absOk = eps.abs != null && Math.abs(next - prev) >= eps.abs;
  const relOk = eps.rel != null && Math.abs(next - prev) >= Math.abs(prev) * eps.rel;
  // If neither threshold configured, any difference counts.
  if (eps.abs == null && eps.rel == null) return next !== prev;
  return absOk || relOk;
}

export function shouldWriteFeature(prev: StoredFeature | undefined, next: FeatureValue, nowMs: number): WriteDecision {
  // Never store NaN/Infinity.
  if (next.status === "OK" || next.status === "PARTIAL") {
    if (next.value != null && !Number.isFinite(next.value)) return { write: false, reason: "nonfinite", meaningful: false };
  }
  if (!prev) return { write: true, reason: "new", meaningful: true };
  // Any status/availability transition always writes (incl. UNAVAILABLE↔OK).
  if (prev.status !== next.status) return { write: true, reason: "status", meaningful: true };
  if (prev.version !== next.version) return { write: true, reason: "version", meaningful: true };

  // Numeric epsilon for available numeric features.
  if ((next.status === "OK" || next.status === "PARTIAL") && next.value != null && prev.value != null) {
    const eps = FEATURE_EPSILON[next.featureId] ?? DEFAULT_EPSILON;
    if (numericChanged(prev.value, next.value, eps)) return { write: true, reason: "numeric", meaningful: true };
  }
  // Metadata evidence change (non-value).
  const h = featureEvidenceHash(next);
  if (prev.evidenceHash !== h) return { write: true, reason: "evidence", meaningful: true };
  // Audit checkpoint (not a meaningful change, just an integrity heartbeat).
  if (nowMs - prev.calculatedAtMs >= FEATURE_CHECKPOINT_MS) return { write: true, reason: "checkpoint", meaningful: false };
  return NO;
}

export function shouldWriteRule(prev: StoredRule | undefined, next: RuleEvaluation, nowMs: number): WriteDecision {
  if (!prev) return { write: true, reason: "new", meaningful: true };
  if (prev.result !== next.result) return { write: true, reason: "result", meaningful: true };
  if (prev.severity !== next.severity) return { write: true, reason: "severity", meaningful: true };
  if (prev.ruleVersion !== next.ruleVersion) return { write: true, reason: "version", meaningful: true };
  const h = ruleEvidenceHash(next); // covers evidence, missing fields, explanation, invalidation
  if (prev.evidenceHash !== h) return { write: true, reason: "evidence", meaningful: true };
  if (nowMs - prev.evaluatedAtMs >= RULE_CHECKPOINT_MS) return { write: true, reason: "checkpoint", meaningful: false };
  return NO;
}
