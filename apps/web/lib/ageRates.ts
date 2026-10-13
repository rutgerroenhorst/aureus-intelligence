/**
 * What the lab measured about the age of a PumpSwap pool (docs/EXIT_PRACTICE.md, section 3; scripts/lab-exit-practice.ts, read 2026-10-13): for the Radar's PumpSwap coins that were still
 * alive and priced when their pool was N hours old, the share that lost half of the price within the next 24 hours and the share that doubled within 72 hours. Coins whose 72 hours
 * were over by the latest reading only (a recent cohort holds mostly dead coins, which made the first numbers look worse than they are).
 *
 * The lab's own first look is at a pool age of about 1.3 hours (the Radar's door admits a pool only once it is 60 minutes old), so there is no finished record of coins younger than that.
 * These are base rates of a group, not a forecast of a coin; they are shown in the Check as a note and count for nothing in its verdict.
 */
export interface AgeRate {
  /** this row covers pools younger than this many hours */
  upToH: number;
  /** the median pool age of the coins in this row, hours */
  ageH: number;
  /** coins in this row */
  n: number;
  /** share that lost half within 24 hours of that moment */
  loseHalf: number;
  /** share that touched 2x within 72 hours of that moment */
  touch2: number;
}

export const PUMPSWAP_AGE_RATES: AgeRate[] = [
  { upToH: 1.7, ageH: 1.2, n: 519, loseHalf: 0.78, touch2: 0.24 },
  { upToH: 2.7, ageH: 2.2, n: 514, loseHalf: 0.63, touch2: 0.21 },
  { upToH: 4.5, ageH: 3.3, n: 507, loseHalf: 0.56, touch2: 0.17 },
  { upToH: 9, ageH: 6.3, n: 488, loseHalf: 0.47, touch2: 0.16 },
  { upToH: 18, ageH: 12.3, n: 419, loseHalf: 0.37, touch2: 0.2 },
  { upToH: 36, ageH: 24.4, n: 402, loseHalf: 0.28, touch2: 0.12 },
];
export const AGE_RATES_AS_OF = "2026-10-13";

/** The row for a pool of this age, or null when the lab has no finished record that old (more than a day and a half). */
export function ageRate(ageH: number): AgeRate | null {
  if (!Number.isFinite(ageH) || ageH < 0) return null;
  return PUMPSWAP_AGE_RATES.find((r) => ageH < r.upToH) ?? null;
}

const HOURS = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 10 ? `${h.toFixed(1)} hours` : `${Math.round(h)} hours`);

/** The line the Check shows for a PumpSwap pool of this age (English, like the other lines), or null when there is nothing to say. */
export function ageNote(ageH: number): string | null {
  const first = PUMPSWAP_AGE_RATES[0]!;
  if (!Number.isFinite(ageH) || ageH < 0) return null;
  if (ageH < 1) {
    return `Pool age ${HOURS(ageH)}: the lab has no finished record of coins this young (it starts looking at about an hour); at an hour old, ${Math.round(first.loseHalf * 100)}% of PumpSwap coins lost half within a day (${first.n} coins). Noted, not counted`;
  }
  const r = ageRate(ageH);
  if (!r) return null;
  return `Pool age ${HOURS(ageH)}: of ${r.n} PumpSwap coins that were still alive at about this age, ${Math.round(r.loseHalf * 100)}% lost half within a day and ${Math.round(r.touch2 * 100)}% doubled within three days. A group's rate, not a forecast; noted, not counted`;
}
