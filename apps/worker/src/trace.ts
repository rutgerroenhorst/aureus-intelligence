/**
 * Minimal development-only trace correlation.
 * Records T0→T6 timestamps for candidate pipeline measurement.
 * Does not alter Phase 1 logic or gate semantics.
 */

interface TraceEvent {
  candidateId: string;
  stage: "DISCOVERED" | "PROCESSING_START" | "ENRICHMENT_DONE" | "V2_EVAL_DONE" | "SNAPSHOT_DONE";
  timestamp: string;
  details?: Record<string, any>;
}

const TRACE_ENABLED = process.env.TRACE_PIPELINE === "true" || process.env.NODE_ENV === "development";

export function traceEvent(event: TraceEvent): void {
  if (!TRACE_ENABLED) return;
  
  console.log(JSON.stringify({
    trace: event.stage,
    candidate_id: event.candidateId,
    timestamp: event.timestamp,
    ...event.details,
  }));
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}
