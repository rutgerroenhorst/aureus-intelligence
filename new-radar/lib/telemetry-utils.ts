export interface FeedTelemetry {
  status: "LIVE" | "DEGRADED" | "OFFLINE";
  lastCandidateAt: string | null;
  lastWorkerCycleAt: string | null;
  lastV2EvaluationAt: string | null;
  candidateCount: number;
  v2QualifiedCount: number;
  latencyMs: number;
  refreshIntervalMs: number;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3600_000)}h`;
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "—";
  const time = new Date(isoString);
  const now = new Date();
  const ms = now.getTime() - time.getTime();
  
  if (ms < 0) return "now";
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86400_000)}d ago`;
}
