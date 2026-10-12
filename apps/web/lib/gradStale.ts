/**
 * The Graduations tab has two sources on the hosted site. While the laptop is awake it shows the snapshot the laptop pushes every 3 minutes (from pump.fun's live event
 * stream, which only a computer that stays awake can follow); otherwise the site's own feed, read from the chain every 3 minutes (lib/graduateFeed.ts), which needs
 * no laptop. Either can go quiet: a sleeping laptop leaves the same list on the screen for hours, which looks exactly like a list that does not refresh. This says how
 * old the list is and when that is worth a loud notice.
 */

/** The laptop pushes every 3 minutes; past this many minutes the stream is not running. */
export const GRAD_STALE_AFTER_MIN = 20;
/** The chain feed ticks every 3 minutes; past this many minutes it is not running. */
export const CHAIN_STALE_AFTER_MIN = 15;

export function gradSnapshot(meta: { source?: string; asOf?: string } | null | undefined, nowMs: number): { ageMin: number | null; stale: boolean; source: "laptop" | "chain" | null } {
  if ((meta?.source !== "laptop" && meta?.source !== "chain") || !meta.asOf) return { ageMin: null, stale: false, source: null };
  const t = new Date(meta.asOf).getTime();
  if (!Number.isFinite(t)) return { ageMin: null, stale: false, source: null };
  const ageMin = Math.max(0, Math.round((nowMs - t) / 60_000));
  return { ageMin, stale: ageMin > (meta.source === "chain" ? CHAIN_STALE_AFTER_MIN : GRAD_STALE_AFTER_MIN), source: meta.source };
}

/** "12 min", "3.5 h", "2.1 d" */
export const gradAgeText = (min: number): string => (min < 90 ? `${Math.round(min)} min` : min < 2880 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} d`);
