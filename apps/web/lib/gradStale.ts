/**
 * The Graduations tab lists what pump.fun's live event stream saw. Only the laptop can follow that stream (a serverless site cannot hold a websocket open),
 * so the hosted site shows the last snapshot the laptop pushed, every 3 minutes while it is awake. A laptop that sleeps leaves the same list on the screen
 * for hours, which looks exactly like a list that does not refresh: this says how old the snapshot is and when that is worth a loud notice.
 */

/** The laptop pushes every 3 minutes; past this many minutes the stream is not running. */
export const GRAD_STALE_AFTER_MIN = 20;

export function gradSnapshot(meta: { source?: string; asOf?: string } | null | undefined, nowMs: number): { ageMin: number | null; stale: boolean } {
  if (meta?.source !== "laptop" || !meta.asOf) return { ageMin: null, stale: false };
  const t = new Date(meta.asOf).getTime();
  if (!Number.isFinite(t)) return { ageMin: null, stale: false };
  const ageMin = Math.max(0, Math.round((nowMs - t) / 60_000));
  return { ageMin, stale: ageMin > GRAD_STALE_AFTER_MIN };
}

/** "12 min", "3.5 h", "2.1 d" */
export const gradAgeText = (min: number): string => (min < 90 ? `${Math.round(min)} min` : min < 2880 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} d`);
