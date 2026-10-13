/** The little sums behind the knowledge tab's calculators. Pure and tested: a calculator that is wrong is worse than none. */

/** Position size for a fixed share of the bankroll at risk per coin. On memecoins a stop cannot be trusted, so the whole stake counts as the loss. */
export const positionSize = (bankroll: number, riskPct: number): number => (bankroll > 0 && riskPct > 0 ? (bankroll * riskPct) / 100 : 0);

/** The share of the bankroll gone after `n` losing coins in a row, each losing `riskPct` of the bankroll as it was just before (0.18 = 18%). */
export const streakLoss = (riskPct: number, n: number): number => (riskPct > 0 && n > 0 ? 1 - Math.pow(1 - Math.min(riskPct, 100) / 100, n) : 0);

/** The chance of `n` losers in a row when a share `lossRate` (0 to 1) of the coins loses. */
export const streakChance = (lossRate: number, n: number): number => (n > 0 ? Math.pow(Math.min(Math.max(lossRate, 0), 1), n) : 1);

/** The chance of at least one run of `n` losers somewhere in `trades` coins (a close approximation; exact enough for a rule of thumb). */
export function runChance(lossRate: number, n: number, trades: number): number {
  const p = Math.min(Math.max(lossRate, 0), 1);
  if (trades < n) return 0;
  const starts = (trades - n) * (1 - p) * Math.pow(p, n) + Math.pow(p, n);
  return 1 - Math.exp(-starts);
}

/** The gain needed to get back from a loss of `lossPct` percent (50 -> 100). Infinity at 100%. */
export const neededGain = (lossPct: number): number => (lossPct <= 0 ? 0 : lossPct >= 100 ? Infinity : (100 * (1 / (1 - lossPct / 100) - 1)));

/** The share of a position to sell at `multiple` times the entry to get the stake back, with a cost of `feePct` percent on what is sold (at 2x and no fee: half). */
export const stakeBackFraction = (multiple: number, feePct = 0): number => {
  if (multiple <= 1) return 1;
  return Math.min(1, 1 / (multiple * (1 - Math.min(Math.max(feePct, 0), 99) / 100)));
};

export interface TakeProfit {
  /** what the sale brings in, after the fee */
  proceeds: number;
  /** what is left, at the current multiple */
  remainingValue: number;
  /** the share of the position still held */
  remainingFraction: number;
  /** does the sale bring in at least the stake? */
  stakeBack: boolean;
  /** the part of the stake still at risk */
  atRisk: number;
}

export function takeProfit(stake: number, multiple: number, sellFraction: number, feePct = 0): TakeProfit {
  const f = Math.min(Math.max(sellFraction, 0), 1);
  const value = stake * Math.max(multiple, 0);
  const proceeds = value * f * (1 - Math.min(Math.max(feePct, 0), 99) / 100);
  return { proceeds, remainingValue: value * (1 - f), remainingFraction: 1 - f, stakeBack: proceeds >= stake - 1e-9, atRisk: Math.max(0, stake - proceeds) };
}

/** Rule of thumb for the price impact of an order in a pool: about twice the order's share of the whole pool (0.02 = 2%). */
export const priceImpact = (order: number, pool: number): number => (order > 0 && pool > 0 ? Math.min(1, (2 * order) / pool) : 0);
