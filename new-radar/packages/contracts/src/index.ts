/**
 * @aureus/contracts — shared types across ingestion, engines, and (later) web.
 * These mirror the DB enums in db/migrations/0001_init.sql. Keep them in sync.
 */
export * from "./engines.js";

export const CHAINS = ["solana"] as const;
export type Chain = (typeof CHAINS)[number];

export const SOURCES = [
  "dexscreener",
  "geckoterminal",
  "helius",
  "solana_rpc",
  "bubblemaps",
  "fomo",
  "aureus_derived",
  "manual",
  "mock",
] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Evidence status is the honesty flag on every observation.
 * VERIFIED  — checked against live source
 * ASSUMED   — from prior knowledge, unconfirmed
 * MISSING   — the source has no such datum
 * GATED     — exists upstream but we lack credentials
 * MANUAL    — hand-imported (e.g. FOMO)
 * MOCK      — deliberately fabricated placeholder, clearly labelled
 * STALE     — real but past its freshness TTL
 * UNAVAILABLE — source that WOULD provide this is not configured (e.g. no Helius key)
 */
export const EVIDENCE_STATUSES = [
  "VERIFIED",
  "ASSUMED",
  "MISSING",
  "GATED",
  "MANUAL",
  "MOCK",
  "STALE",
  "UNAVAILABLE",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const CANDIDATE_STATES = [
  "RESEARCHING",
  "REJECTED",
  "STRUCTURE_WATCH",
  "QUALITY_CONFIRMED",
  "ENTRY_WATCH",
  "ENTRY_READY",
  "OVEREXTENDED",
  "POSITION_RISK",
  "EXPIRED",
  "UNRESOLVED",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const SAFETY_STATUSES = ["PASSED", "INCOMPLETE", "FAILED"] as const;
export type SafetyStatus = (typeof SAFETY_STATUSES)[number];

export const QUALITY_LEVELS = ["WEAK", "DEVELOPING", "CONFIRMED"] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export const ENTRY_STATUSES = [
  "TOO_EARLY",
  "WAIT_FOR_LEVEL",
  "READY",
  "OVEREXTENDED",
  "INVALIDATED",
  "EXPIRED",
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ALERT_TYPES = [
  "INTELLIGENCE_UPDATE",
  "ENTRY_WATCH",
  "ENTRY_READY",
  "ENTRY_INVALIDATED",
  "OVEREXTENDED",
  "LIQUIDITY_RISK",
  "SMART_WALLET_EXIT",
  "DEPLOYER_ACTIVITY",
  "DATA_STALE",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Operating mode of a data source given current credentials/health. */
export const SOURCE_MODES = ["LIVE", "DEGRADED", "MOCK", "DISABLED"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

/** Provenance carried by every normalized observation. */
export interface Provenance {
  source: Source;
  observedAt: string | null; // source clock (ISO) — nullable
  ingestedAt: string; // our clock (ISO)
  evidenceStatus: EvidenceStatus;
  dataQualityConfidence: number | null; // 0..1
  rawSourceRef: string | null;
  rawEventId: string | null;
}

/** A raw event as stored append-only before normalization. */
export interface RawEvent {
  source: Source;
  endpoint: string;
  naturalKey: string;
  idempotencyKey: string;
  observedAt: string | null;
  httpStatus: number | null;
  payload: unknown;
}

/** Address-first identity — never keyed on name/ticker. */
export interface CandidateIdentity {
  chain: Chain;
  mint: string;
  poolAddress: string | null;
  candidateCode: string;
  discoveredAt: string;
}

/** Universal engine output unit (Safety/Entry). */
export interface Finding {
  engine: "safety" | "entry";
  ruleId: string;
  status?: SafetyStatus;
  severity: Severity;
  explanation: string;
  evidence: Record<string, unknown>;
  invalidation: string; // "what would change this outcome"
  provenance: Provenance;
  specVersion: string;
  paramHash: string;
}

/** Quality-dimension confirmation. */
export interface Confirmation {
  dimension: "independent_demand" | "capital_retention" | "attention";
  level: QualityLevel;
  evidence: Record<string, unknown>;
  missingChecks: string[];
  invalidation: string;
  provenance: Provenance;
  specVersion: string;
  paramHash: string;
}
