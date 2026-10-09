import type { CandidateState } from "@aureus/contracts";

const int = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

export const workerConfig = {
  discoveryIntervalMs: int("DISCOVERY_POLL_INTERVAL_SECONDS", 60) * 1000,
  activeIntervalMs: int("ACTIVE_CANDIDATE_POLL_INTERVAL_SECONDS", 30) * 1000,
  researchingIntervalMs: int("RESEARCHING_POLL_INTERVAL_SECONDS", 60) * 1000,
  watchlistIntervalMs: int("WATCHLIST_POLL_INTERVAL_SECONDS", 20) * 1000,
  staleAfterMs: int("STALE_AFTER_SECONDS", 180) * 1000,
  maxCandidatesPerCycle: int("MAX_CANDIDATES_PER_CYCLE", 25),
  maxConcurrent: int("MAX_CONCURRENT_CANDIDATES", 5),
  cooldownMinutes: int("TELEGRAM_COOLDOWN_MINUTES", 15),
  cycleTickMs: int("WORKER_TICK_SECONDS", 10) * 1000,
};

const DORMANT_MS = 24 * 60 * 60_000; // REJECTED/EXPIRED: effectively stop scanning

/** Adaptive polling interval by state — not all candidates scanned equally often. */
export function nextIntervalMs(state: CandidateState): number {
  switch (state) {
    case "ENTRY_READY":
    case "POSITION_RISK":
      return workerConfig.activeIntervalMs;
    case "STRUCTURE_WATCH":
    case "QUALITY_CONFIRMED":
    case "ENTRY_WATCH":
    case "OVEREXTENDED":
      return workerConfig.watchlistIntervalMs;
    case "RESEARCHING":
    case "UNRESOLVED":
      return workerConfig.researchingIntervalMs;
    case "REJECTED":
    case "EXPIRED":
      return DORMANT_MS;
    default:
      return workerConfig.researchingIntervalMs;
  }
}
