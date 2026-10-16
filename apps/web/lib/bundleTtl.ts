/**
 * How long the Radar's one-request bundle (app/api/radar-bundle) is kept before it is built again, by how much of the day's database allowance is used (docs/LIMITS.md: the hosted database may send 5 GB a month,
 * the site's own daily brake is 100 MB). A build is the part that reads the database, so a longer keep is the brake: it was a flat five minutes as soon as the allowance was used, which on 2026-10-16 (at 15:56 UTC,
 * after a day of builds that read 330 to 410 KB each) froze the lists and the owner saw no coin leave or arrive. A build now reads about a sixth of that (the base list and the graduations are shared between builds),
 * so the brake is graded: a minute normally, two minutes over the allowance, five minutes only when a quarter over it.
 */
export const TTL_NORMAL_MS = 60_000;
export const TTL_OVER_MS = 120_000;
export const TTL_WELL_OVER_MS = 300_000;

export function bundleTtlMs(usedMb: number, budgetMb: number): number {
  if (!(budgetMb > 0) || !Number.isFinite(usedMb)) return TTL_NORMAL_MS;
  if (usedMb >= budgetMb * 1.25) return TTL_WELL_OVER_MS;
  if (usedMb >= budgetMb) return TTL_OVER_MS;
  return TTL_NORMAL_MS;
}
