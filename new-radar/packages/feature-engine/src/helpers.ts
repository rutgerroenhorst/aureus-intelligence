import type { FeatureValue, FeatureStatus, Source } from "@aureus/contracts";

export const FEATURE_VERSION = "0.1.0";
export const FEATURE_ENGINE_VERSION = "fe-0.1.0";

interface TimePoint {
  observedAtMs: number;
}

/** Latest point with observedAtMs <= nowMs. Series need not be pre-sorted. */
export function latest<T extends TimePoint>(series: T[], nowMs: number): T | undefined {
  let best: T | undefined;
  for (const p of series) {
    if (p.observedAtMs <= nowMs && (!best || p.observedAtMs > best.observedAtMs)) best = p;
  }
  return best;
}

/** Nearest point at or before targetMs, within toleranceMs. */
export function atOrBefore<T extends TimePoint>(
  series: T[],
  targetMs: number,
  toleranceMs: number,
): T | undefined {
  let best: T | undefined;
  for (const p of series) {
    if (p.observedAtMs <= targetMs && targetMs - p.observedAtMs <= toleranceMs) {
      if (!best || p.observedAtMs > best.observedAtMs) best = p;
    }
  }
  return best;
}

export function ageMs(point: TimePoint, nowMs: number): number {
  return nowMs - point.observedAtMs;
}

export function isStale(point: TimePoint, nowMs: number, ttlMs: number): boolean {
  return ageMs(point, nowMs) > ttlMs;
}

/** Round to keep deterministic, stable stored values. */
export function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ── FeatureValue builders ────────────────────────────────────────────────
interface Ctx {
  nowMs: number;
  window: string;
}

function base(id: string, unit: string, ctx: Ctx): Pick<FeatureValue, "featureId" | "version" | "unit" | "calculatedAt" | "observationWindow"> {
  return {
    featureId: id,
    version: FEATURE_VERSION,
    unit,
    calculatedAt: new Date(ctx.nowMs).toISOString(),
    observationWindow: ctx.window,
  };
}

export function ok(
  id: string,
  unit: string,
  ctx: Ctx,
  value: number,
  sources: Source[],
  dataQuality: number,
  explanation: string,
  status: Extract<FeatureStatus, "OK" | "PARTIAL"> = "OK",
): FeatureValue {
  return {
    ...base(id, unit, ctx),
    status,
    value: round(value),
    sourceInputs: sources,
    dataQuality: round(dataQuality, 3),
    missingReason: null,
    explanation,
  };
}

function absent(
  id: string,
  unit: string,
  ctx: Ctx,
  status: Extract<FeatureStatus, "MISSING" | "UNAVAILABLE" | "STALE">,
  reason: string,
): FeatureValue {
  return {
    ...base(id, unit, ctx),
    status,
    value: null,
    sourceInputs: [],
    dataQuality: null,
    missingReason: reason,
    explanation: reason,
  };
}

export const missing = (id: string, unit: string, ctx: Ctx, reason: string) =>
  absent(id, unit, ctx, "MISSING", reason);
export const unavailable = (id: string, unit: string, ctx: Ctx, reason: string) =>
  absent(id, unit, ctx, "UNAVAILABLE", reason);
export const stale = (id: string, unit: string, ctx: Ctx, reason: string) =>
  absent(id, unit, ctx, "STALE", reason);
