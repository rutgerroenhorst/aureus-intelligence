/**
 * What an example exit plan would have done with a trade, from the three numbers the journal keeps for it (highest point seen,
 * lowest point seen, where it is now), all as multiples of the entry. This is the lab's fixed comparison plan, not a
 * recommendation: a quarter sold at 2x, 5x and 10x, a stop at -50% until the first sale and a stop 40% below the highest point
 * after it. The journal does not record the ORDER of the highest and lowest points or every price in between, so two assumptions
 * are made and shown: the price rose to its peak first and fell afterwards, and a stop fills at its level (a real sale on a thin
 * pool can fill worse).
 */

export const PLAN = {
  rungs: [2, 5, 10] as const,
  sellEach: 0.25,
  stopAtStart: 0.5,
  trail: 0.4,
};

export interface PlanCheck {
  /** rungs the peak reached */
  rungsHit: number[];
  /** how much of the stake those sales brought back, in multiples of the stake */
  locked: number;
  /** share of the position still held after the sales */
  remaining: number;
  /** price level (x entry) of the stop right now */
  stopLevel: number;
  /** the stop has been passed: the rest would have been sold */
  stopped: boolean;
  /** what the plan is worth, in multiples of the stake, with the stop filling at its level */
  planValue: number;
  /** what holding everything is worth now */
  holdValue: number;
}

export function planCheck(peak: number, low: number, now: number): PlanCheck {
  const p = Math.max(peak, now, 1e-9);
  const rungsHit = PLAN.rungs.filter((r) => p >= r);
  const locked = rungsHit.reduce((a, r) => a + PLAN.sellEach * r, 0);
  const remaining = 1 - PLAN.sellEach * rungsHit.length;
  const trailing = rungsHit.length > 0;
  const stopLevel = trailing ? (1 - PLAN.trail) * p : PLAN.stopAtStart;
  // before the first sale the stop is a fixed -50% of the entry, so the lowest point counts; afterwards it follows the peak
  const stopped = trailing ? now <= stopLevel : Math.min(low, now) <= PLAN.stopAtStart;
  const restValue = stopped ? stopLevel : now;
  return { rungsHit: [...rungsHit], locked, remaining, stopLevel, stopped, planValue: locked + remaining * restValue, holdValue: now };
}
