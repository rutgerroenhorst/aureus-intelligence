/**
 * The database's data allowance as a rolling month, so that a day that uses little leaves its share to the days after it (docs/LIMITS.md, item 14).
 *
 * Supabase Free lets the hosted database send out 5 GB a month. It was guarded by a flat 100 MB a day: a day that used 60 MB lost its other 40, a busy day hit the brake at 100 whatever the month looked like.
 * The owner (2026-10-16): "5 GB a month, divide it per day, and carry over what is left of the earlier days."
 *
 * The rule: the last 31 days together (the days before today plus today) may send out `EGRESS_USE_MB` (4,500 MB: 90% of 5,000, counted in round megabytes, which leaves room for what is not counted
 * and for the unknown day the plan's own month starts on). So today's allowance is what the previous 30 days left of that, at least 40 MB and at most 200 MB a day. A day that used little
 * raises the allowance of the days after it (the carry-over), a busy day lowers it, and no stretch of 31 days can add up to more than 4,500 MB plus the soft brake's overshoot, wherever the plan's own month begins.
 * The days counted are everything the hosted database sent: the site (the meter in @aureus/db), the laptop's own connections to it and the backups (scripts/lib/hosted.ts), and a few estimates for the days before
 * the meter existed (rows named usage:egress-estimate:<day>). Pure: no network, no database.
 */

/** Supabase Free: 5 GB of egress a month, counted as 5,000 MB to stay on the safe side. */
export const EGRESS_LIMIT_MB = 5_000;
/** What 31 days together may add up to: 90% of the limit. */
export const EGRESS_USE_MB = Number(process.env.EGRESS_WINDOW_MB ?? 4_500);
/** The most, and the least, one day's allowance can be (a day with nothing used before it does not get the whole month, and a month that is used up still lets the site breathe). */
export const EGRESS_DAY_MAX_MB = Number(process.env.EGRESS_DAY_MAX_MB ?? 200);
export const EGRESS_DAY_MIN_MB = Number(process.env.EGRESS_DAY_MIN_MB ?? 40);
/** The days that count: today and the 30 before it (a plan month is at most 31 days). */
export const EGRESS_WINDOW_DAYS = 31;

const MB = 1048576;
const DAY_ROW = /^usage:egress(?:-estimate)?:(\d{4}-\d{2}-\d{2})$/;

/** The UTC day of a moment, as the usage rows name it. */
export const utcDay = (d: Date | number): string => new Date(d).toISOString().slice(0, 10);

export interface UsageRow {
  /** usage:egress:<day> (what the database sent, counted) or usage:egress-estimate:<day> (an estimate for a day that was not counted) */
  name: string;
  bytes: number;
}

/** What was sent out on the days before today, within the window, and today so far (MB, as stored). */
export function rollingUse(rows: UsageRow[], now: Date | number): { prevMb: number; todayMb: number; byDay: Record<string, number> } {
  const today = utcDay(now);
  const first = utcDay(new Date(now).getTime() - (EGRESS_WINDOW_DAYS - 1) * 86_400_000);
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const m = DAY_ROW.exec(r.name);
    if (!m || !Number.isFinite(r.bytes)) continue;
    const day = m[1]!;
    if (day < first || day > today) continue;
    byDay[day] = (byDay[day] ?? 0) + r.bytes / MB;
  }
  let prevMb = 0;
  for (const [day, mb] of Object.entries(byDay)) if (day < today) prevMb += mb;
  return { prevMb, todayMb: byDay[today] ?? 0, byDay };
}

/** Today's allowance in MB: what the previous 30 days left of the window, between the least and the most a day may have. */
export function todaysBudgetMb(prevMb: number, o: { windowMb?: number; minMb?: number; maxMb?: number } = {}): number {
  const windowMb = o.windowMb ?? EGRESS_USE_MB;
  const min = o.minMb ?? EGRESS_DAY_MIN_MB;
  const max = o.maxMb ?? EGRESS_DAY_MAX_MB;
  const left = windowMb - (Number.isFinite(prevMb) ? prevMb : 0);
  return Math.round(Math.min(max, Math.max(min, left)));
}
