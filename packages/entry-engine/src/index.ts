/**
 * Deterministic ENTRY / range engine.
 *
 * Computes the structural entry flags the ENTRY rule family needs
 * (entryStructurePresent, reclaimConfirmed, localInvalidationPrice, estSlippagePct,
 * rewardToRisk) from the price series we actually have + current liquidity.
 *
 * Principles (same as every Aureus engine):
 *  - Pure & deterministic: same input → same output. No clock, no randomness.
 *  - Never fabricate: with too little history the flags are `undefined`, which the
 *    ENTRY rules read as INCOMPLETE (not a PASS). Missing data is never a signal.
 *  - No win-probability. This produces STRUCTURE, not a prediction.
 */

export interface EntryPricePoint {
  observedAtMs: number;
  priceUsd: number;
}

export interface EntryInput {
  nowMs: number;
  prices: EntryPricePoint[]; // any order; filtered/sorted internally
  liquidityUsd: number | null;
  tradeSizeUsd: number; // nominal size used for the slippage estimate
}

export interface EntryConfig {
  lookbackMs: number; // structure window
  minPoints: number; // minimum points in-window to analyse
  rangeTightnessMax: number; // (hi-lo)/mid ≤ this ⇒ a bounded range exists
  reclaimBufferPct: number; // must still hold ≥ rangeHigh*(1-buffer) after breaking
  reclaimHoldObservations: number; // consecutive observations that hold before it counts
  swingLookbackFrac: number; // trailing fraction of the window used for the swing low
}

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  lookbackMs: 60 * 60_000,
  minPoints: 8,
  rangeTightnessMax: 0.35,
  reclaimBufferPct: 0.03,
  /** Consecutive observations the broken level must hold before the reclaim counts. */
  reclaimHoldObservations: 3,
  swingLookbackFrac: 0.34,
};

export interface EntryFlags {
  entryStructurePresent?: boolean;
  reclaimConfirmed?: boolean;
  localInvalidationPrice?: number | null;
  estSlippagePct?: number;
  rewardToRisk?: number;
}

export interface EntryResult extends EntryFlags {
  /** Human-readable structural read (for the entry plan UI). */
  rationale: string;
  /** Concrete levels when computable (never fabricated). */
  levels: {
    rangeLow: number | null;
    rangeHigh: number | null;
    rangePosition: number | null; // 0=low … 1=high
    entry: number | null;
    invalidation: number | null;
    target: number | null;
    pointsInWindow: number;
  };
  trigger: string; // what price action is still needed
}

function undef(rationale: string, pointsInWindow: number): EntryResult {
  return {
    rationale, trigger: "Accumulate more price history for a structural read.",
    levels: { rangeLow: null, rangeHigh: null, rangePosition: null, entry: null, invalidation: null, target: null, pointsInWindow },
  };
}

/** Constant-product price impact for a USD-denominated buy against one side of the pool. */
function estSlippagePct(liquidityUsd: number | null, tradeSizeUsd: number): number | undefined {
  if (liquidityUsd == null || liquidityUsd <= 0) return undefined;
  const usdReserve = liquidityUsd / 2; // ~half the TVL is the quote side
  return Math.round((tradeSizeUsd / (usdReserve + tradeSizeUsd)) * 100 * 100) / 100;
}

export function computeEntry(input: EntryInput, config: EntryConfig = DEFAULT_ENTRY_CONFIG): EntryResult {
  const win = input.prices
    .filter((p) => Number.isFinite(p.priceUsd) && p.priceUsd > 0 && p.observedAtMs >= input.nowMs - config.lookbackMs && p.observedAtMs <= input.nowMs)
    .sort((a, b) => a.observedAtMs - b.observedAtMs);
  const slip = estSlippagePct(input.liquidityUsd, input.tradeSizeUsd);

  if (win.length < config.minPoints) {
    return { ...undef("Insufficient price history for a structural read.", win.length), estSlippagePct: slip };
  }

  const priceOf = (p: EntryPricePoint) => p.priceUsd;
  const now = priceOf(win[win.length - 1]!);
  const hi = Math.max(...win.map(priceOf));
  const lo = Math.min(...win.map(priceOf));
  const mid = (hi + lo) / 2;
  const rangeWidth = mid > 0 ? (hi - lo) / mid : Infinity;
  const rangePosition = hi - lo > 0 ? (now - lo) / (hi - lo) : null;

  // Structure: a bounded band exists (not a one-way pump/dump).
  const entryStructurePresent = rangeWidth <= config.rangeTightnessMax;

  // Established range top = high of the first 2/3 of the window; the last 1/3 is the "action".
  const splitIdx = Math.floor(win.length * (2 / 3));
  const establishedHigh = Math.max(...win.slice(0, Math.max(1, splitIdx)).map(priceOf));
  const recent = win.slice(splitIdx);
  const brokeAbove = recent.some((p) => priceOf(p) > establishedHigh);
  // HOLDING means the level held across several observations, not that price happens
  // to be above it on this single tick. The old check was `now >= level` alone, which
  // confirmed an entry the instant price touched back — a hair trigger, and exactly the
  // chase this system refuses elsewhere. The setup is break-out → pull-back → HOLD →
  // enter; without a duration requirement the "hold" step does not exist and every
  // retest collapsed straight into ENTRY_CONFIRMED.
  const holdFloor = establishedHigh * (1 - config.reclaimBufferPct);
  const holdWindow = recent.slice(-config.reclaimHoldObservations);
  const holdingBreakout =
    holdWindow.length >= config.reclaimHoldObservations &&
    holdWindow.every((p) => priceOf(p) >= holdFloor);

  let reclaimConfirmed: boolean | undefined;
  if (!entryStructurePresent) reclaimConfirmed = undefined; // no clean structure to reclaim
  else if (brokeAbove && holdingBreakout) reclaimConfirmed = true; // broke the range and HELD it
  else if (brokeAbove && !holdingBreakout) reclaimConfirmed = false; // broke but fell back (failed reclaim)
  else reclaimConfirmed = false; // range intact, no break yet — awaiting the trigger

  // Local invalidation = trailing swing low (structural support below current price).
  const tail = win.slice(Math.max(0, Math.floor(win.length * (1 - config.swingLookbackFrac))));
  const swingLow = Math.min(...tail.map(priceOf));
  const localInvalidationPrice = swingLow < now ? swingLow : null;

  // Reward-to-risk from a measured-move target (range height projected off the high).
  let rewardToRisk: number | undefined;
  let target: number | null = null;
  if (localInvalidationPrice != null && localInvalidationPrice < now) {
    const risk = now - localInvalidationPrice;
    target = hi + (hi - lo); // measured move
    const reward = target - now;
    rewardToRisk = risk > 0 ? Math.round((reward / risk) * 100) / 100 : undefined;
  }

  const rationale = !entryStructurePresent
    ? `No clean range — band width ${(rangeWidth * 100).toFixed(0)}% exceeds ${(config.rangeTightnessMax * 100).toFixed(0)}% (one-way move).`
    : reclaimConfirmed
      ? `Range [${lo.toPrecision(3)}, ${hi.toPrecision(3)}] with a held breakout above ${establishedHigh.toPrecision(3)}.`
      : brokeAbove
        ? `Broke ${establishedHigh.toPrecision(3)} but did not hold — failed reclaim.`
        : `Range [${lo.toPrecision(3)}, ${hi.toPrecision(3)}] intact; awaiting a breakout + hold above ${establishedHigh.toPrecision(3)}.`;

  const trigger = !entryStructurePresent
    ? "Wait for a consolidation/range to form."
    : reclaimConfirmed
      ? "Reclaim confirmed — see execution (slippage / R:R)."
      : brokeAbove
        ? `Reclaim of ${establishedHigh.toPrecision(3)} (hold above on retest).`
        : `Breakout + hold above ${establishedHigh.toPrecision(3)}, or a higher-low reclaim.`;

  return {
    entryStructurePresent,
    reclaimConfirmed,
    localInvalidationPrice,
    estSlippagePct: slip,
    rewardToRisk,
    rationale,
    trigger,
    levels: { rangeLow: lo, rangeHigh: hi, rangePosition, entry: now, invalidation: localInvalidationPrice, target, pointsInWindow: win.length },
  };
}

// ── Entry proximity — how close a structural entry is (deterministic, no prediction) ──
export type ProximityStage =
  | "NO_STRUCTURE" | "BASE_FORMING" | "PULLBACK_FORMING" | "HIGHER_LOW_FORMING"
  | "BREAKOUT_PENDING" | "RETEST_PENDING" | "RECLAIM_PENDING" | "CONFIRMATION_PENDING"
  | "ENTRY_CONFIRMED" | "TOO_EXTENDED";

export interface EntryProximity {
  stage: ProximityStage;
  confirmed: string[];
  missing: string[];
  distancePct: number | null; // % move from now to the range-high trigger
  confirmations: number; // observations in the structure window
  expiresInMs: number | null;
}

const STRUCTURE_TTL_MS = 90 * 60_000;

/** How far above the broken level an entry is still an entry rather than a chase.
 *  The edge is the pull-back INTO the level, where invalidation sits a few percent
 *  away — not the extension away from it. */
const MAX_CHASE_ABOVE_BREAK = 0.08;

/** Classify where in a setup the price sits, from the same window computeEntry uses.
 *  Never invents levels — everything derives from observed prices. */
export function entryProximity(input: EntryInput, config: EntryConfig = DEFAULT_ENTRY_CONFIG): EntryProximity {
  const e = computeEntry(input, config);
  const lv = e.levels;
  const win = input.prices
    .filter((p) => Number.isFinite(p.priceUsd) && p.priceUsd > 0 && p.observedAtMs >= input.nowMs - config.lookbackMs && p.observedAtMs <= input.nowMs)
    .sort((a, b) => a.observedAtMs - b.observedAtMs);
  const confirmations = win.length;
  const expiresInMs = win.length ? Math.max(0, STRUCTURE_TTL_MS - (input.nowMs - win[win.length - 1]!.observedAtMs)) : null;
  const mk = (stage: ProximityStage, confirmed: string[], missing: string[], distancePct: number | null): EntryProximity =>
    ({ stage, confirmed, missing, distancePct, confirmations, expiresInMs });

  if (e.entryStructurePresent == null || lv.rangeHigh == null || lv.rangeLow == null || lv.entry == null) {
    return mk("NO_STRUCTURE", [], ["consolidation/range to form"], null);
  }
  const pos = lv.rangePosition ?? 0.5;
  const toHigh = lv.entry > 0 ? (lv.rangeHigh - lv.entry) / lv.entry : null;
  // TOO_EXTENDED must be STRUCTURAL, never "the band is wide" or a raw return.
  // A wide/volatile band with price sitting mid-range is NO_STRUCTURE, not extended.
  // Extended = price has run beyond where a disciplined entry would still buy:
  // more than one full range-width above the range high.
  if (!e.entryStructurePresent) {
    // Measure against the ESTABLISHED range (first 2/3 of the window). The full-window
    // high includes the current move itself, so it can never be exceeded.
    const split = Math.max(1, Math.floor(win.length * (2 / 3)));
    const basePrices = win.slice(0, split).map((p) => p.priceUsd);
    const baseHigh = Math.max(...basePrices);
    const baseLow = Math.min(...basePrices);
    const baseWidth = baseHigh - baseLow;
    const aboveWidths = baseWidth > 0 ? (lv.entry - baseHigh) / baseWidth : 0;
    if (aboveWidths > 1.0) {
      return mk("TOO_EXTENDED", [`price ${aboveWidths.toFixed(1)}× base-width above the established high`], ["pullback / new base"], toHigh);
    }
    return mk("NO_STRUCTURE", [], ["a consolidation/range to form (band too wide for a clean entry)"], toHigh);
  }
  // A confirmed reclaim is only an ENTRY while price is still near the level it broke.
  // TOO_EXTENDED previously lived only inside the no-structure branch, so a breakout
  // that ran far above its level stayed "ENTRY_CONFIRMED" no matter how far it went —
  // the chase this system exists to avoid, wearing the strongest label it has.
  const _split = Math.max(1, Math.floor(win.length * (2 / 3)));
  const _basePx = win.slice(0, _split).map((p) => p.priceUsd);
  const _estHigh = Math.max(..._basePx);
  const extendedPct = _estHigh > 0 ? (lv.entry - _estHigh) / _estHigh : 0;
  if (e.reclaimConfirmed === true) {
    if (extendedPct > MAX_CHASE_ABOVE_BREAK) {
      return mk("TOO_EXTENDED",
        [`price ${(extendedPct * 100).toFixed(0)}% above the level it broke`],
        ["a pull-back toward the broken level"], toHigh);
    }
    return mk("ENTRY_CONFIRMED", ["range", "breakout held", `${(extendedPct * 100).toFixed(1)}% above the broken level`], [], toHigh);
  }

  const third = Math.max(1, Math.floor(win.length / 3));
  const recent = win.slice(-third).map((p) => p.priceUsd);
  const mid = win.slice(-2 * third, -third).map((p) => p.priceUsd);
  const recentLow = Math.min(...recent);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const midLow = mid.length ? Math.min(...mid) : recentLow;
  const base = ["range/consolidation detected"];

  // ── break-out → pull-back → retest ────────────────────────────────────────
  // The setup this system is built to trade, and the one the stage vocabulary named
  // but never actually produced: RETEST_PENDING and RECLAIM_PENDING were declared in
  // ProximityStage and returned by nothing. Without them the engine jumped straight
  // from "coiled below the high" to "reclaim confirmed", so the entry window itself —
  // price coming back to the level it just broke — had no state and could not be shown,
  // ranked or waited for.
  //
  // Buying the break itself is the chase this system already refuses. The edge is the
  // pull-back INTO the broken level, where invalidation is a few percent away instead
  // of a whole range.
  // The level that was broken must be the ESTABLISHED high — the high of the base
  // BEFORE the move — not the full-window high. `lv.rangeHigh` spans the whole window
  // including the breakout itself, so "price exceeded the range high" can never be
  // true against it. Same trap as TOO_EXTENDED, which measures the same way.
  const baseSplit = Math.max(1, Math.floor(win.length * (2 / 3)));
  const basePx = win.slice(0, baseSplit).map((p) => p.priceUsd);
  const establishedHigh = Math.max(...basePx);
  const establishedLow = Math.min(...basePx);
  const brokeOut = win.slice(baseSplit).some((p) => p.priceUsd > establishedHigh);
  if (brokeOut) {
    const breakIdx = win.findIndex((p, i) => i >= baseSplit && p.priceUsd > establishedHigh);
    const since = win.slice(breakIdx).map((p) => p.priceUsd);
    const peak = Math.max(...since);
    const nowPx = lv.entry;
    // Measured as a PERCENTAGE OF THE BROKEN LEVEL, not in base-widths. A tight base
    // (say 4% wide) under a 12% breakout makes width-normalised distances explode —
    // the retest sat at "0.5 base-widths" and fell outside every sensible band. What
    // matters is simply how close price is to the level it broke, in price terms.
    const backFromPeak = peak > 0 ? (peak - nowPx) / peak : 0;
    const aboveBreak = (nowPx - establishedHigh) / establishedHigh;

    if (aboveBreak >= -0.02 && aboveBreak <= 0.08 && backFromPeak > 0.02) {
      // Pulled back to the broken high and still holding it — the entry window.
      return mk("RETEST_PENDING",
        [...base, "broke above range high", `pulled back ${(backFromPeak * 100).toFixed(0)}% from the peak`, "holding the broken level"],
        ["a higher low or a hold confirmation on this level"], toHigh);
    }
    if (aboveBreak < -0.02 && aboveBreak > -0.25) {
      // Lost the level after breaking out. Tradeable only if it takes it back.
      return mk("RECLAIM_PENDING",
        [...base, "broke above range high", "lost the level on the pull-back"],
        ["price to reclaim and hold the broken high"], toHigh);
    }
    // aboveBreak > 0.08 → still extended above the break; not a retest yet.
  }

  if (pos >= 0.9) return mk("BREAKOUT_PENDING", [...base, "coiled near range high"], ["breakout close above range high"], toHigh);
  if (recentLow > midLow && recentAvg < lv.rangeHigh) return mk("HIGHER_LOW_FORMING", [...base, "higher low printing"], ["reclaim / breakout confirmation"], toHigh);
  if (pos <= 0.35) return mk("PULLBACK_FORMING", [...base, "pullback into range low"], ["higher low or reclaim"], toHigh);
  return mk("BASE_FORMING", base, ["breakout, higher-low, or reclaim"], toHigh);
}
