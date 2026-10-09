import type { CandidateState, SnapshotKind } from "@aureus/contracts";
import { SNAPSHOT_OFFSETS_MS } from "@aureus/contracts";

export const OUTCOME_ENGINE_VERSION = "oe-0.1.0";

export interface OutcomeSeriesPoint {
  atMs: number;
  priceUsd: number;
  liquidityUsd?: number;
  holderCount?: number;
}

export interface MeasureInput {
  anchorAtMs: number;
  horizon: SnapshotKind;
  nowMs: number;
  series: OutcomeSeriesPoint[];
  simEntryPrice?: number;
  reachedState?: CandidateState;
}

export interface OutcomeMeasurement {
  ret: number | null;
  mfe: number | null;
  mae: number | null;
  timeToPeakS: number | null;
  timeToFailureS: number | null;
  liquidityLossPct: number | null;
  holderGrowth: number | null;
  rugLabel: "rug" | "soft_fail" | "survived" | null;
  reachedState: CandidateState | null;
  simEntryReturn: number | null;
  falsePositive: boolean | null;
  falseNegative: boolean | null;
  windowComplete: boolean;
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Measure forward outcome for one anchor+horizon.
 *
 * Anti-look-ahead (binding): only data points inside [anchorAt, windowEnd] are
 * used, where windowEnd = min(now, anchorAt + horizonOffset). Points after the
 * horizon are NEVER used, and points after `now` cannot exist yet. `windowComplete`
 * is true only once `now` has reached the horizon end; incomplete windows are
 * reported but must be excluded from aggregate reports.
 */
export function measureOutcome(input: MeasureInput): OutcomeMeasurement {
  const horizonEndMs = input.anchorAtMs + SNAPSHOT_OFFSETS_MS[input.horizon];
  const windowEndMs = Math.min(input.nowMs, horizonEndMs);
  const windowComplete = input.nowMs >= horizonEndMs;

  const inWindow = input.series
    .filter((p) => p.atMs >= input.anchorAtMs && p.atMs <= windowEndMs)
    .sort((a, b) => a.atMs - b.atMs);

  const empty: OutcomeMeasurement = {
    ret: null, mfe: null, mae: null, timeToPeakS: null, timeToFailureS: null,
    liquidityLossPct: null, holderGrowth: null, rugLabel: null,
    reachedState: input.reachedState ?? null, simEntryReturn: null,
    falsePositive: null, falseNegative: null, windowComplete,
  };
  if (inWindow.length === 0) return empty;

  const anchor = inWindow[0]!;
  const last = inWindow[inWindow.length - 1]!;
  const anchorPrice = anchor.priceUsd;
  if (anchorPrice <= 0) return empty;

  const prices = inWindow.map((p) => p.priceUsd);
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const peakPoint = inWindow.find((p) => p.priceUsd === maxP)!;

  const ret = last.priceUsd / anchorPrice - 1;
  const mfe = maxP / anchorPrice - 1;
  const mae = minP / anchorPrice - 1;
  const timeToPeakS = Math.round((peakPoint.atMs - input.anchorAtMs) / 1000);

  const failPoint = inWindow.find((p) => p.priceUsd <= anchorPrice * 0.5);
  const timeToFailureS = failPoint ? Math.round((failPoint.atMs - input.anchorAtMs) / 1000) : null;

  const liqs = inWindow.map((p) => p.liquidityUsd).filter((v): v is number => v != null);
  let liquidityLossPct: number | null = null;
  if (liqs.length > 0 && anchor.liquidityUsd != null && anchor.liquidityUsd > 0) {
    liquidityLossPct = round((anchor.liquidityUsd - Math.min(...liqs)) / anchor.liquidityUsd);
  }

  const holderGrowth =
    anchor.holderCount != null && last.holderCount != null ? last.holderCount - anchor.holderCount : null;

  let rugLabel: OutcomeMeasurement["rugLabel"] = null;
  if (liquidityLossPct != null && liquidityLossPct > 0.9) rugLabel = "rug";
  else if (ret < -0.7) rugLabel = "soft_fail";
  else if (windowComplete) rugLabel = "survived";

  const simEntryReturn =
    input.simEntryPrice && input.simEntryPrice > 0 ? round(last.priceUsd / input.simEntryPrice - 1) : null;

  // False positive/negative only meaningful once the window is complete.
  let falsePositive: boolean | null = null;
  let falseNegative: boolean | null = null;
  if (windowComplete && input.reachedState) {
    const accepted = ["QUALITY_CONFIRMED", "ENTRY_WATCH", "ENTRY_READY"].includes(input.reachedState);
    const failed = rugLabel === "rug" || rugLabel === "soft_fail";
    falsePositive = accepted && failed;
    falseNegative = input.reachedState === "REJECTED" && mfe > 1.0;
  }

  return {
    ret: round(ret), mfe: round(mfe), mae: round(mae), timeToPeakS, timeToFailureS,
    liquidityLossPct, holderGrowth, rugLabel, reachedState: input.reachedState ?? null,
    simEntryReturn, falsePositive, falseNegative, windowComplete,
  };
}
