/**
 * Round-trip cost model.
 *
 * The system has been showing entry plans with a target price and no notion of
 * what it costs to actually get in and back out. On the pools this scanner finds,
 * that omission is not a rounding error — it is usually larger than the target.
 *
 * Worked example from a live card: GINGY, $12.3K pool, $500 nominal position.
 *   buy impact   ≈ 500 / (12300/2)      = 8.1%
 *   sell impact  ≈ same size, same pool = 8.1%
 *   fees         ≈ 2 × (0.25% LP + 1% platform) = 2.5%
 *   ─────────────────────────────────────────────
 *   round trip   ≈ 18.8%
 *
 * So a "+20% target" on that pool is a +1% trade. A plan whose target does not
 * clear its own round-trip cost is not an opportunity, and the user must be able
 * to see that before committing money — not after.
 *
 * Model: constant-product AMM (x·y=k), which is what Raydium/pumpswap pools are.
 * For a quote reserve Q and a buy of size S, the effective price paid is
 * (Q+S)/B against a spot of Q/B, so the impact is exactly S/Q. Dexscreener
 * reports total pool liquidity (both sides), so Q ≈ liquidityUsd/2.
 *
 * This is a cost floor, not a promise. It excludes MEV/sandwiching, the spread
 * against other flow, and any price movement between the two legs.
 */

export interface CostInput {
  /** Position size in USD. */
  tradeSizeUsd: number;
  /** Total pool liquidity in USD as reported by the feed (both sides). */
  liquidityUsd: number | null;
  /** LP fee per leg, in percent. Raydium CPMM ≈ 0.25%. */
  lpFeePct?: number;
  /** Platform/creator fee per leg, in percent. pump.fun-style ≈ 1%. */
  platformFeePct?: number;
  /** Priority fee per transaction in USD (congestion-dependent). */
  priorityFeeUsd?: number;
  /** Base network fee per transaction in USD. */
  networkFeeUsd?: number;
}

export interface RoundTripCost {
  /** Price impact entering, as a fraction of the position (0.081 = 8.1%). */
  buyImpact: number | null;
  /** Price impact exiting the same size from the same depth. */
  sellImpact: number | null;
  /** Both legs of LP + platform fees, as a fraction. */
  fees: number;
  /** Fixed SOL costs for both legs, in USD. */
  fixedUsd: number;
  /** Total round-trip cost as a fraction of the position. */
  total: number | null;
  /** Spot move required just to return the capital. Equals `total` grossed up. */
  breakevenMove: number | null;
  /** Position as a share of total pool liquidity — the real danger signal. */
  poolShare: number | null;
  reasons: string[];
}

export const COST_DEFAULTS = {
  lpFeePct: 0.25,
  platformFeePct: 1.0,
  priorityFeeUsd: 0.02,
  networkFeeUsd: 0.001,
} as const;

/**
 * A position worth more than this share of the pool is self-defeating: you are
 * the market, and the exit impact grows faster than any realistic target.
 */
export const MAX_SANE_POOL_SHARE = 0.02; // 2%

export function roundTripCost(i: CostInput): RoundTripCost {
  const reasons: string[] = [];
  const lp = i.lpFeePct ?? COST_DEFAULTS.lpFeePct;
  const platform = i.platformFeePct ?? COST_DEFAULTS.platformFeePct;
  const prio = i.priorityFeeUsd ?? COST_DEFAULTS.priorityFeeUsd;
  const net = i.networkFeeUsd ?? COST_DEFAULTS.networkFeeUsd;

  const fees = 2 * ((lp + platform) / 100);
  const fixedUsd = 2 * (prio + net);
  const size = i.tradeSizeUsd;

  if (!Number.isFinite(size) || size <= 0) {
    return { buyImpact: null, sellImpact: null, fees, fixedUsd, total: null, breakevenMove: null, poolShare: null,
             reasons: ["no position size given"] };
  }
  const liq = i.liquidityUsd;
  if (liq == null || !Number.isFinite(liq) || liq <= 0) {
    // No depth reading ⇒ no impact estimate. Reporting only the fee component here
    // would understate the true cost by an order of magnitude on a thin pool.
    return { buyImpact: null, sellImpact: null, fees, fixedUsd, total: null, breakevenMove: null, poolShare: null,
             reasons: ["pool depth unknown — round-trip cost not computable"] };
  }

  const quoteReserve = liq / 2;
  const poolShare = size / liq;
  // Constant product: impact entering = S/Q. Exiting the same notional from the
  // same depth costs the same again — the two do NOT cancel, because we are not
  // reversing a trade into an unchanged pool, we are paying spread twice.
  const buyImpact = size / quoteReserve;
  const sellImpact = size / quoteReserve;

  const total = buyImpact + sellImpact + fees + fixedUsd / size;
  // To recover a position that cost `total` to round-trip, the spot price must
  // rise by total/(1-total): you are recovering out of a shrunken base.
  const breakevenMove = total < 1 ? total / (1 - total) : Infinity;

  if (poolShare > MAX_SANE_POOL_SHARE) {
    reasons.push(`position is ${(poolShare * 100).toFixed(1)}% of the pool — you are the market`);
  }
  if (buyImpact > 0.05) reasons.push(`entry impact ${(buyImpact * 100).toFixed(1)}% on this depth`);
  if (total > 0.15) reasons.push(`round trip costs ${(total * 100).toFixed(1)}% of the position`);

  return { buyImpact, sellImpact, fees, fixedUsd, total, breakevenMove, poolShare, reasons };
}

export interface TargetViability {
  /** Does the target clear the round trip with the required margin? */
  viable: boolean;
  /** Move the plan implies, as a fraction. */
  targetMove: number | null;
  /** What is actually left after costs. */
  netMove: number | null;
  /** Smallest target that would be worth taking at this size and depth. */
  minimumViableTarget: number | null;
  reason: string;
}

/**
 * Judge a plan's target against its own cost. `marginMultiple` is how much better
 * than break-even the move must be to be worth the risk — at 2.0 the target has
 * to be twice the round-trip cost.
 */
export function targetViability(
  entryPrice: number | null,
  targetPrice: number | null,
  cost: RoundTripCost,
  marginMultiple = 2.0,
): TargetViability {
  if (entryPrice == null || targetPrice == null || entryPrice <= 0) {
    return { viable: false, targetMove: null, netMove: null, minimumViableTarget: null,
             reason: "no entry/target price to evaluate" };
  }
  if (cost.breakevenMove == null || !Number.isFinite(cost.breakevenMove)) {
    return { viable: false, targetMove: (targetPrice - entryPrice) / entryPrice, netMove: null,
             minimumViableTarget: null, reason: cost.reasons[0] ?? "round-trip cost unknown" };
  }
  const targetMove = (targetPrice - entryPrice) / entryPrice;
  const netMove = targetMove - (cost.total ?? 0);
  const minimumViableTarget = cost.breakevenMove * marginMultiple;
  const viable = targetMove >= minimumViableTarget;
  const reason = viable
    ? `target +${(targetMove * 100).toFixed(1)}% clears the ${(cost.breakevenMove * 100).toFixed(1)}% round trip`
    : `target +${(targetMove * 100).toFixed(1)}% does not clear the ${(cost.breakevenMove * 100).toFixed(1)}% round-trip cost (need +${(minimumViableTarget * 100).toFixed(1)}%)`;
  return { viable, targetMove, netMove, minimumViableTarget, reason };
}

/**
 * Largest position that keeps the round trip at or under `maxCost` at this depth.
 *
 * Cost is U-shaped in size: the fixed SOL fees dominate when the position is tiny,
 * price impact dominates when it is large. So we solve the whole thing rather than
 * dropping the fixed term — an approximation here would return a size that breaches
 * the very budget the caller asked us to respect.
 *
 *   cost(S) = 4S/L + fixed/S + fees ≤ maxCost
 *   ⇒ (4/L)S² − B·S + fixed ≤ 0,  where B = maxCost − fees
 *   ⇒ valid between the two roots; we want the larger one.
 */
export function maxPositionForCost(
  liquidityUsd: number | null,
  maxCost = 0.10,
  lpFeePct = COST_DEFAULTS.lpFeePct,
  platformFeePct = COST_DEFAULTS.platformFeePct,
  priorityFeeUsd = COST_DEFAULTS.priorityFeeUsd,
  networkFeeUsd = COST_DEFAULTS.networkFeeUsd,
): number | null {
  if (liquidityUsd == null || !Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return null;
  const fees = 2 * ((lpFeePct + platformFeePct) / 100);
  const fixed = 2 * (priorityFeeUsd + networkFeeUsd);
  const B = maxCost - fees;
  if (B <= 0) return 0; // fees alone already exceed the budget
  const disc = B * B - (16 * fixed) / liquidityUsd;
  if (disc < 0) return 0; // fixed costs alone cannot fit the budget at any size
  return (liquidityUsd * (B + Math.sqrt(disc))) / 8;
}
