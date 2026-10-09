import type { Source, SourceMode, EvidenceStatus } from "@aureus/contracts";

/** A normalized adapter response ready to become a raw_events row. */
export interface AdapterResult<T = unknown> {
  source: Source;
  endpoint: string;
  naturalKey: string; // mint / pool / signature the call is about
  observedAt: string | null; // source clock if the payload provides one
  evidenceStatus: EvidenceStatus;
  httpStatus: number | null;
  payload: T;
  /** Present when the adapter could not fetch and returned a labelled placeholder. */
  degradedReason?: string;
}

export interface SourceAdapter {
  readonly source: Source;
  readonly mode: SourceMode;
}

/** Deterministic idempotency key for a raw event. */
export function idempotencyKey(
  source: Source,
  endpoint: string,
  naturalKey: string,
  observedAt: string | null,
): string {
  return `${source}:${endpoint}:${naturalKey}:${observedAt ?? "no-ts"}`;
}
