/**
 * Watch engine — Aureus's TWO separate decisions:
 *   1. IS THIS A GOOD COIN TO FOLLOW?  → fundamentalWatch()
 *   2. WHEN IS THE BEST ENTRY?         → entry proximity + readiness
 *
 * Deterministic, no win-probability. A coin with good Core Safety + healthy market
 * data becomes watchable BEFORE any entry structure exists.
 */
import type { EntryResult, EntryProximity, ProximityStage } from "@aureus/entry-engine";

export type CoreSafety = "PASS" | "FAIL" | "INCOMPLETE" | "NA";
export type FundVerdict = "WATCHABLE" | "OBSERVATION" | "REJECT";
export type ActionStatusV2 =
  | "DISCOVERED" | "FUNDAMENTAL_WATCH" | "SETUP_FORMING" | "ENTRY_APPROACHING"
  | "ENTRY_READY" | "TOO_EXTENDED" | "INVALIDATED" | "REJECTED" | "EXPIRED";
export type WatchPriority = "PRIMARY" | "SECONDARY" | "OBSERVATION";

export const WATCH = {
  MIN_LIQUIDITY_USD: 8_000,
  DEAD_VOLUME_USD: 1_500,
  HIGH_CONCENTRATION: 0.55,
  EXTREME_CONCENTRATION: 0.75,
  HIGH_INSIDER: 0.5,
  STALE_MS: 15 * 60_000,
  CRITICAL_DRAIN_30M: -0.4,
  MAX_DEPLOYER_EXPOSURE: 0.5,
} as const;

export interface WatchInput {
  nowMs: number;
  coreSafety: CoreSafety;
  anySafetyFail: boolean;
  sellClass: string | null; // SELLABLE / HIGH_IMPACT / CONFIRMED_SELLABILITY_FAIL / ...
  holderTop10: number | null;
  insiderPct: number | null;
  deployerExposure: number | null; // fundingRiskScore (0..1) proxy for exposure
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  liquidityUsd: number | null;
  liqTrend30m: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  pairAgeMs: number | null;
  freshnessMs: number | null; // price age
  advancedMissing: string[]; // advanced datasets not OK
  /** CLEAN | WATCH | DANGER | UNKNOWN from the launch-stage rug checks. */
  rugVerdict?: string | null;
  /** The specific disqualifiers behind a DANGER verdict. */
  rugBlocking?: string[];
}

export interface FundamentalWatch {
  verdict: FundVerdict;
  qualityRank: number; // 0..100 (NOT a win probability)
  positives: string[];
  knownRisks: string[];
  unknownRisks: string[];
  blocker: string; // biggest reason it's not entry-ready yet (fundamentals side)
  reasons: string[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export function fundamentalWatch(i: WatchInput): FundamentalWatch {
  const positives: string[] = [];
  const knownRisks: string[] = [];
  const reasons: string[] = [];
  const fresh = i.freshnessMs != null && i.freshnessMs < WATCH.STALE_MS;
  const volNow = i.volumeUsd ?? 0;
  const totalTx = (i.buys ?? 0) + (i.sells ?? 0);
  const buyShare = totalTx > 0 ? (i.buys ?? 0) / totalTx : null;
  const conc = i.holderTop10;
  const critDrain = i.liqTrend30m != null && i.liqTrend30m <= WATCH.CRITICAL_DRAIN_30M;

  // ── hard rejects (never watchable) ──
  const reject =
    i.anySafetyFail || i.coreSafety === "FAIL" || i.freezeAuthorityActive === true ||
    critDrain || i.sellClass === "CONFIRMED_SELLABILITY_FAIL" ||
    (conc != null && conc >= WATCH.EXTREME_CONCENTRATION) ||
    (i.liquidityUsd != null && i.liquidityUsd < WATCH.MIN_LIQUIDITY_USD / 3) ||
    (i.freshnessMs != null && i.freshnessMs > 60 * 60_000 && volNow < WATCH.DEAD_VOLUME_USD) ||
    // A launch-stage rug signal is a hard stop, not a score adjustment: an active
    // authority or one wallet holding a fifth of the float ends the coin outright.
    i.rugVerdict === "DANGER";

  // ── watchable conditions (§2) ──
  const marketOk = fresh && (i.liquidityUsd ?? 0) >= WATCH.MIN_LIQUIDITY_USD && !critDrain && volNow >= WATCH.DEAD_VOLUME_USD;
  const sellOk = i.sellClass === "SELLABLE" || i.sellClass === "HIGH_IMPACT";
  const concOk = conc == null ? false : conc < WATCH.HIGH_CONCENTRATION;
  const insiderOk = i.insiderPct == null ? false : i.insiderPct < WATCH.HIGH_INSIDER;
  const authOk = !i.mintAuthorityActive && !i.freezeAuthorityActive;
  const coreOk = i.coreSafety === "PASS" || i.coreSafety === "INCOMPLETE"; // sufficiently/near complete
  const watchable = !reject && marketOk && sellOk && concOk && insiderOk && authOk && coreOk;

  // positives / risks
  if (i.liqTrend30m != null && i.liqTrend30m > 0.03) positives.push(`liquidity growing ${pct(i.liqTrend30m)}`);
  if (conc != null && conc < 0.2) positives.push(`low holder concentration ${pct(conc)}`);
  if (i.insiderPct != null && i.insiderPct < 0.2) positives.push(`low insider concentration ${pct(i.insiderPct)}`);
  if (buyShare != null && buyShare > 0.55) positives.push(`buy share ${pct(buyShare)}`);
  if (volNow >= WATCH.DEAD_VOLUME_USD * 6) positives.push("active volume");
  if (i.sellClass === "SELLABLE") positives.push("sellable (route confirmed)");
  if (authOk) positives.push("authorities renounced");

  if (conc != null && conc >= WATCH.HIGH_CONCENTRATION) knownRisks.push(`holder concentration ${pct(conc)}`);
  if (i.insiderPct != null && i.insiderPct >= WATCH.HIGH_INSIDER) knownRisks.push(`insider concentration ${pct(i.insiderPct)}`);
  if (i.mintAuthorityActive) knownRisks.push("mint authority active");
  if (i.freezeAuthorityActive) knownRisks.push("freeze authority active");
  if (i.sellClass === "HIGH_IMPACT") knownRisks.push("high sell price-impact");
  if (critDrain) knownRisks.push(`liquidity draining ${pct(i.liqTrend30m!)}`);
  if (i.deployerExposure != null && i.deployerExposure >= WATCH.MAX_DEPLOYER_EXPOSURE) knownRisks.push(`deployer exposure ${pct(i.deployerExposure)}`);
  for (const b of i.rugBlocking ?? []) knownRisks.push(b);
  const unknownRisks = i.advancedMissing.map((d) => d.replace(/_/g, " "));

  // ── Fundamental Quality Rank (0..100), deterministic weights ──
  let q = 0;
  q += i.coreSafety === "PASS" ? 30 : i.coreSafety === "INCOMPLETE" ? 15 : 0;
  q += i.sellClass === "SELLABLE" ? 15 : i.sellClass === "HIGH_IMPACT" ? 8 : 0;
  if (conc != null) q += clamp((0.6 - conc) / 0.6, 0, 1) * 12;
  if (i.insiderPct != null) q += clamp((0.5 - i.insiderPct) / 0.5, 0, 1) * 12;
  if (i.liquidityUsd != null) q += clamp(i.liquidityUsd / 60_000, 0, 1) * 12;
  if (i.liqTrend30m != null) q += clamp((i.liqTrend30m + 0.1) / 0.3, 0, 1) * 6;
  if (volNow) q += clamp(volNow / 100_000, 0, 1) * 6;
  if (buyShare != null) q += clamp((buyShare - 0.4) / 0.3, 0, 1) * 4;
  if (i.deployerExposure != null) q += clamp((0.5 - i.deployerExposure) / 0.5, 0, 1) * 3;
  q -= unknownRisks.length * 1.5; // advanced unknowns are a real, disclosed drag
  const qualityRank = Math.round(clamp(q));

  const verdict: FundVerdict = reject ? "REJECT" : watchable ? "WATCHABLE" : "OBSERVATION";
  const blocker = i.rugVerdict === "DANGER" ? (i.rugBlocking?.[0] ?? "rug risk")
    : reject ? "hard safety/market failure"
    : !fresh ? "stale market data"
    : (i.liquidityUsd ?? 0) < WATCH.MIN_LIQUIDITY_USD ? "liquidity below minimum"
    : !sellOk ? `sellability ${i.sellClass ?? "unconfirmed"}`
    : !concOk ? "holder concentration too high"
    : !insiderOk ? "insider concentration too high"
    : !authOk ? "authorities not renounced"
    : i.coreSafety !== "PASS" ? "core safety not yet complete"
    : "awaiting entry structure";
  if (watchable) reasons.push("Core Safety sufficient + healthy market data");
  return { verdict, qualityRank, positives, knownRisks, unknownRisks, blocker, reasons };
}

// ── Entry Readiness Rank (0..100) — structure quality, NOT a win probability ──
export function entryReadinessRank(entry: EntryResult, prox: EntryProximity, liquidityUsd: number | null): number {
  let r = 0;
  const stageScore: Record<ProximityStage, number> = {
    ENTRY_CONFIRMED: 45, CONFIRMATION_PENDING: 38, RECLAIM_PENDING: 34, RETEST_PENDING: 32,
    BREAKOUT_PENDING: 28, HIGHER_LOW_FORMING: 24, PULLBACK_FORMING: 18, BASE_FORMING: 12,
    TOO_EXTENDED: 4, NO_STRUCTURE: 0,
  };
  r += stageScore[prox.stage];
  if (entry.rewardToRisk != null) r += clamp(entry.rewardToRisk / 4, 0, 1) * 20; // R:R
  if (entry.estSlippagePct != null) r += clamp((10 - entry.estSlippagePct) / 10, 0, 1) * 12; // low slippage
  if (entry.localInvalidationPrice != null) r += 10; // clear invalidation
  if (liquidityUsd != null) r += clamp(liquidityUsd / 60_000, 0, 1) * 8;
  if (prox.confirmations) r += clamp(prox.confirmations / 20, 0, 1) * 5;
  return Math.round(clamp(r));
}

// ── instantaneous status (worker applies stability + INVALIDATED/EXPIRED) ──
export interface StatusInput {
  fund: FundVerdict;
  coreSafety: CoreSafety;
  prox: ProximityStage;
  entryConfirmedRule: boolean; // ENTRY rule family all PASS
  fresh: boolean;
  acceptableSlippage: boolean;
  /** TIMING: buying into the top of the range / after the impulse already faded. */
  lateEntry?: boolean;
  /** TIMING: the move already happened — up on the day, rolling over on the
   *  shortest horizon that actually exists for this pair's age. */
  spentMove?: boolean;
  /** QUALITY: the coin does not clear the evidence-based tradability floor
   *  (pool depth, volume, turnover, valuation). This is NOT a timing problem, and
   *  reporting it as a "late chase" tells the user the opposite of the truth —
   *  they wait for a pullback that was never the issue. */
  belowQualityFloor?: boolean;
  distributing?: boolean;
}
/**
 * Which ENTRY_READY preconditions are currently false.
 *
 * ENTRY_READY has fired 0 times across 240 real candidates. That is either
 * correct discipline or a structurally unreachable gate, and the two are
 * indistinguishable unless the system reports which condition is binding. This
 * returns exactly that, so "it never fires" can be answered with a number instead
 * of a guess. Diagnostic only — it never changes a status.
 */
export const ENTRY_READY_GATES = [
  "structure_confirmed", "entry_rules_pass", "core_safety_pass",
  "data_fresh", "slippage_ok", "not_late_chase", "move_not_spent",
  "meets_quality_floor", "not_distributing",
] as const;
export type EntryReadyGate = (typeof ENTRY_READY_GATES)[number];

export function entryReadyBlockers(s: StatusInput): EntryReadyGate[] {
  const failed: EntryReadyGate[] = [];
  if (s.prox !== "ENTRY_CONFIRMED") failed.push("structure_confirmed");
  if (!s.entryConfirmedRule) failed.push("entry_rules_pass");
  if (s.coreSafety !== "PASS") failed.push("core_safety_pass");
  if (!s.fresh) failed.push("data_fresh");
  if (!s.acceptableSlippage) failed.push("slippage_ok");
  if (s.lateEntry) failed.push("not_late_chase");
  if (s.spentMove) failed.push("move_not_spent");
  if (s.belowQualityFloor) failed.push("meets_quality_floor");
  if (s.distributing) failed.push("not_distributing");
  return failed;
}

export function deriveStatus(s: StatusInput): ActionStatusV2 {
  if (s.fund === "REJECT") return "REJECTED";
  if (s.prox === "TOO_EXTENDED") return "TOO_EXTENDED";
  if (s.fund === "OBSERVATION") return "DISCOVERED";
  // fund === WATCHABLE from here
  // ENTRY_READY additionally requires that this is not a late chase into
  // distribution. A confirmed structure at the TOP of its range, or with early
  // buyers actively selling, is not an entry — it's the exit liquidity.
  if (s.prox === "ENTRY_CONFIRMED" && s.entryConfirmedRule && s.coreSafety === "PASS" && s.fresh
      && s.acceptableSlippage && !s.lateEntry && !s.spentMove && !s.belowQualityFloor
      && !s.distributing) return "ENTRY_READY";
  // Structure IS confirmed but a final gate (entry rules / core safety / slippage) is
  // still missing → most conditions present, awaiting last confirmation.
  if (s.prox === "ENTRY_CONFIRMED") return "ENTRY_APPROACHING";
  if (["BREAKOUT_PENDING", "RETEST_PENDING", "RECLAIM_PENDING", "CONFIRMATION_PENDING", "HIGHER_LOW_FORMING"].includes(s.prox)) return "ENTRY_APPROACHING";
  if (["BASE_FORMING", "PULLBACK_FORMING"].includes(s.prox)) return "SETUP_FORMING";
  return "FUNDAMENTAL_WATCH";
}

// ── best entry type within the structure (§6) — preference, not momentum-chasing ──
export interface BestEntry { type: string; reason: string; provisional: boolean }
export function bestEntry(prox: ProximityStage, entry: EntryResult): BestEntry {
  const hasInval = entry.localInvalidationPrice != null;
  switch (prox) {
    case "ENTRY_CONFIRMED": return { type: "breakout retest / reclaim hold", reason: "confirmed reclaim with a clear invalidation", provisional: false };
    case "CONFIRMATION_PENDING":
    case "RECLAIM_PENDING":
    case "RETEST_PENDING": return { type: "reclaim / retest", reason: hasInval ? "smallest logical invalidation distance (preferred)" : "reclaim forming", provisional: true };
    case "HIGHER_LOW_FORMING": return { type: "higher-low confirmation", reason: "higher low after impulse — clean invalidation below the low", provisional: true };
    case "BREAKOUT_PENDING": return { type: "breakout hold", reason: "only if chase distance stays low (no chasing momentum)", provisional: true };
    case "PULLBACK_FORMING": return { type: "pullback into range edge", reason: "wait for a higher low or reclaim to confirm", provisional: true };
    case "BASE_FORMING": return { type: "breakout hold from base", reason: hasInval ? "base with a defined low — wait for a held breakout or reclaim" : "base forming; no invalidation level yet", provisional: true };
    case "NO_STRUCTURE": return { type: "none yet", reason: "no structure to base an entry on", provisional: true };
    default: return { type: "none yet", reason: "no structure to base an entry on", provisional: true };
  }
}

// ── provisional plan from REAL levels only (labeled PROVISIONAL until ENTRY_READY) ──
export interface ProvisionalPlan {
  provisional: boolean;
  triggerType: string;
  entryAreaLow: number | null;
  entryAreaHigh: number | null;
  invalidation: number | null;
  maxChase: number | null;
  target: number | null;
  estSlippagePct: number | null;
  requiredConfirmation: string;
  label: string;
}
/** Stages where the trade is a pull-back INTO support, not a break of resistance. */
const PULLBACK_STAGES = new Set<ProximityStage>([
  "HIGHER_LOW_FORMING", "PULLBACK_FORMING", "BASE_FORMING",
]);

export function provisionalPlan(entry: EntryResult, prox: EntryProximity, ready: boolean): ProvisionalPlan {
  const lv = entry.levels;
  const be = bestEntry(prox.stage, entry);

  // The entry area used to be the range HIGH in every case, so a coin that had pulled
  // back was still quoted an entry at the top of its own range — which is exactly why
  // every suggestion looked like it was already extended. The level to buy depends on
  // which trade is being set up:
  //
  //   broke out, retesting   → buy the broken level (resistance became support)
  //   pulling back to a low  → buy the higher low, with the stop just under it
  //
  // On a pull-back the support is the trailing swing low (`invalidation`); the zone sits
  // just above it so the stop has room, and never above the middle of the range.
  const isPullback = PULLBACK_STAGES.has(prox.stage);
  const support = lv.invalidation;
  const width = lv.rangeHigh != null && lv.rangeLow != null ? lv.rangeHigh - lv.rangeLow : null;

  let entryAreaLow: number | null;
  let entryAreaHigh: number | null;
  let maxChase: number | null;
  if (isPullback && support != null && width != null && width > 0) {
    // The zone must sit ABOVE the stop, never on it. Setting entryAreaLow = support
    // put the buy price and the invalidation at the same number, which is a plan to be
    // stopped out at entry. A buffer of a tenth of the range gives the level room to
    // hold while keeping the stop close enough to be worth taking.
    entryAreaLow = support + width * 0.10;
    entryAreaHigh = Math.min(support + width * 0.40, lv.rangeLow != null ? lv.rangeLow + width * 0.5 : Infinity);
    // Chasing a pull-back back up into the range defeats the point of waiting for it.
    maxChase = lv.rangeLow != null ? lv.rangeLow + width * 0.5 : entryAreaHigh;
  } else {
    entryAreaLow = lv.rangeHigh;
    entryAreaHigh = lv.rangeHigh != null ? lv.rangeHigh * 1.03 : null;
    maxChase = lv.rangeHigh != null ? lv.rangeHigh * 1.08 : null;
  }

  return {
    provisional: !ready,
    triggerType: be.type,
    entryAreaLow,
    entryAreaHigh: entryAreaHigh != null && Number.isFinite(entryAreaHigh) ? entryAreaHigh : null,
    invalidation: lv.invalidation,
    maxChase,
    target: lv.target,
    estSlippagePct: entry.estSlippagePct ?? null,
    requiredConfirmation: prox.missing[0] ?? "breakout/reclaim confirmation",
    label: ready ? "ENTRY PLAN" : "PROVISIONAL — NOT AN ENTRY YET",
  };
}

// ── §Late-entry / distribution guard ────────────────────────────────────────
/**
 * Blocks ENTRY_READY when the entry would be a LATE CHASE into distribution —
 * the exact scenario that burns a buyer: the impulse already happened, early
 * buyers are selling into you, and price sits at the top of its own range.
 *
 * Uses only data we actually have (price series + tx aggregates). It does NOT
 * claim to identify *which* wallets are dumping — that needs a paid indexer.
 */
export interface DistributionInput {
  price: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  /** Highest price seen in the structure window. */
  windowHigh: number | null;
  buys: number | null;
  sells: number | null;
  /** Sells/buys in the PREVIOUS window, to detect accelerating selling. */
  prevBuys: number | null;
  prevSells: number | null;
  pairAgeMs: number | null;
  return30m: number | null;
}
export interface DistributionRisk {
  lateEntry: boolean;
  distributing: boolean;
  reasons: string[];
  /** Position in the structure range, 0 = low, 1 = high. */
  rangePosition: number | null;
}

export const DIST = {
  /** Buying above this position in the range is chasing, not entering. */
  MAX_RANGE_POSITION: 0.7,
  /** Sell share above this = net distribution. */
  SELL_SHARE_HIGH: 0.55,
  /** Drawdown from window high beyond this after an impulse = the move is over. */
  FADED_FROM_HIGH: 0.25,
} as const;

export function distributionRisk(i: DistributionInput): DistributionRisk {
  const reasons: string[] = [];
  const { price, rangeLow, rangeHigh, windowHigh } = i;
  const rangePosition =
    price != null && rangeLow != null && rangeHigh != null && rangeHigh > rangeLow
      ? (price - rangeLow) / (rangeHigh - rangeLow)
      : null;

  // 1. Buying into the top of the range is a chase, not an entry.
  let lateEntry = false;
  if (rangePosition != null && rangePosition > DIST.MAX_RANGE_POSITION) {
    lateEntry = true;
    reasons.push(`price at ${(rangePosition * 100).toFixed(0)}% of range (top ${((1 - DIST.MAX_RANGE_POSITION) * 100).toFixed(0)}% is a chase)`);
  }

  // 2. Net sell pressure = someone is distributing into buyers.
  const tx = (i.buys ?? 0) + (i.sells ?? 0);
  const sellShare = tx > 0 ? (i.sells ?? 0) / tx : null;
  let distributing = false;
  if (sellShare != null && sellShare >= DIST.SELL_SHARE_HIGH) {
    distributing = true;
    reasons.push(`net selling — ${(sellShare * 100).toFixed(0)}% of trades are sells`);
  }

  // 3. Selling is ACCELERATING vs the previous window.
  const prevTx = (i.prevBuys ?? 0) + (i.prevSells ?? 0);
  const prevSellShare = prevTx > 0 ? (i.prevSells ?? 0) / prevTx : null;
  if (sellShare != null && prevSellShare != null && sellShare > prevSellShare + 0.1) {
    distributing = true;
    reasons.push(`sell pressure rising (${(prevSellShare * 100).toFixed(0)}% → ${(sellShare * 100).toFixed(0)}%)`);
  }

  // 4. The impulse already faded — buying the retrace of a dead move.
  if (price != null && windowHigh != null && windowHigh > 0) {
    const fade = (windowHigh - price) / windowHigh;
    if (fade > DIST.FADED_FROM_HIGH) {
      lateEntry = true;
      reasons.push(`${(fade * 100).toFixed(0)}% below the window high — impulse already faded`);
    }
  }
  return { lateEntry, distributing, reasons, rangePosition };
}

// ── Evidence-based gates (derived from a 438-pair Dexscreener study) ─────────
/**
 * Thresholds below are MEASURED, not guessed. Study: 438 live Solana pairs,
 * classified by 24h outcome. Base rate of "ran" = 5.5%; 54% of the universe was
 * already DEAD (median 24h volume $10, 4 transactions).
 *
 * See docs/RESEARCH_COIN_STUDY.md for the full table.
 */
export const EVIDENCE = {
  /** Structural: paper valuation vs the pool that has to absorb an exit.
   *  Adding this single check moved precision 44% → 100% in the study. */
  MAX_FDV_TO_LIQUIDITY: 20,
  /** Exit feasibility. Winners' median pool $19.8k–39k; dead $3.8k, dumped $7.1k. */
  /** The dead-zone boundary, measured: below $8k the median peak is 0% — there is
   *  nothing to watch, not merely nothing to trade. Watch and entry share the floor
   *  because a coin below it is not on its way anywhere. */
  MIN_LIQUIDITY_WATCH_USD: 5_000,
  /** Forward-measured boundary, and the same number discovery admits on — a $30k
   *  entry floor above a $20k discovery floor made 20-30k coins permanently
   *  un-enterable, discovered only to be stuck:
   *      liq 8-20k  n=137  median dip -46%  46% halved
   *      liq 20-50k n= 48  median dip -13%  31% halved  */
  MIN_LIQUIDITY_ENTRY_USD: 6_000,
  /** Tradability, not prediction: can an order actually clear?
   *
   *  The old $250,000 floor came from the cross-sectional study and forward data does
   *  not support it — the band it EXCLUDED performed best on median peak:
   *      vol24 <25k    n=125  median peak  +4%   (dead)
   *      vol24 25-100k n=102  median peak +10%
   *      vol24 100-250k n=44  median peak +19%   ← was excluded
   *      vol24 250k-1m  n=49  median peak  +4%
   *  $25k separates dead from live; $250k was excluding live coins.
   *
   *  These absolute floors are about the COIN. Whether YOU can trade it is a
   *  separate question that depends on position size — see tradableAtSize(). */
  MIN_VOL24_WATCH_USD: 1_000,
  MIN_VOL24_ENTRY_USD: 25_000,
  /** Turnover — volume relative to pool depth.
   *  Forward-measured: <0.5x is a parked pool (median peak 0%), and >25x is churn
   *  (median peak 0%, 26% halved). The productive band is in between. */
  MIN_TURNOVER_ENTRY: 1,
  MAX_TURNOVER_ENTRY: 25,
} as const;


/**
 * Can a position of this size actually be traded here?
 *
 * A fixed "$250k of daily volume" floor answers the wrong question. The floor exists so
 * the order does not move the market and can be exited — which is entirely a function of
 * how much is being traded. At €10 a $20k pool is two thousand times the position; at
 * $500 it is forty times. One number cannot serve both.
 */
export const SIZE_LIMITS = {
  /** Position as a share of pool depth. Above this you are the market. */
  MAX_SHARE_OF_POOL: 0.0025,
  /** Position as a share of 24h volume. Above this there is nobody to exit into. */
  MAX_SHARE_OF_VOLUME: 0.005,
} as const;

export function tradableAtSize(
  tradeSizeUsd: number, liquidityUsd: number | null, volume24Usd: number | null,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Number.isFinite(tradeSizeUsd) || tradeSizeUsd <= 0) return { ok: false, reasons: ["no position size given"] };
  if (liquidityUsd == null || volume24Usd == null) return { ok: false, reasons: ["pool depth or volume unknown"] };
  const poolShare = tradeSizeUsd / liquidityUsd;
  const volShare = tradeSizeUsd / Math.max(volume24Usd, 1);
  if (poolShare > SIZE_LIMITS.MAX_SHARE_OF_POOL) {
    reasons.push(`$${tradeSizeUsd} is ${(poolShare * 100).toFixed(2)}% of the pool — too large for this depth`);
  }
  if (volShare > SIZE_LIMITS.MAX_SHARE_OF_VOLUME) {
    reasons.push(`$${tradeSizeUsd} is ${(volShare * 100).toFixed(2)}% of daily volume — thin exit`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface MarketQualityInput {
  liquidityUsd: number | null;
  volume24Usd: number | null;
  fdvUsd: number | null;
  change6h: number | null;
  change24h: number | null;
  change5m: number | null;
  change1h?: number | null;
  /** REQUIRED for correct horizon selection. On a coin younger than a horizon, the
   *  feed reports that horizon as a copy of a shorter one (h24==h6==h1 on a 24-min
   *  coin), so any h6/h24 rule is reading a duplicate, not a trend. */
  ageMinutes?: number | null;
}
export interface MarketQuality {
  /** Passes the exclusion gate → worth watching at all. (study: 96% recall, 3% bad leak) */
  watchable: boolean;
  /** Passes the strict composite gate → tradable quality. (study: 0% bad leak) */
  entryQuality: boolean;
  /** h24 up but the shorter horizons are rolling over = the move already happened. */
  spentMove: boolean;
  /** Which horizon was actually usable for the trend read, given the coin's age. */
  trendHorizon: "m5" | "h1" | "h6" | "none";
  /** True when the feed's long horizons are duplicates of shorter ones (young coin). */
  degenerateHorizons: boolean;
  fdvToLiq: number | null;
  turnover: number | null;
  reasons: string[];
}

export function marketQuality(i: MarketQualityInput): MarketQuality {
  const reasons: string[] = [];
  const liq = i.liquidityUsd ?? 0;
  const vol = i.volume24Usd ?? 0;
  const fdvToLiq = liq > 0 && i.fdvUsd != null ? i.fdvUsd / liq : null;
  const turnover = liq > 0 ? vol / liq : null;

  // ── exclusion gate (decision 1: is this even worth watching?) ──
  let watchable = true;
  if (liq < EVIDENCE.MIN_LIQUIDITY_WATCH_USD) { watchable = false; reasons.push(`pool $${liq.toFixed(0)} below $${EVIDENCE.MIN_LIQUIDITY_WATCH_USD} — exit not feasible`); }
  if (vol < EVIDENCE.MIN_VOL24_WATCH_USD) { watchable = false; reasons.push(`24h volume $${vol.toFixed(0)} — effectively untraded`); }
  if (fdvToLiq != null && fdvToLiq > 50) { watchable = false; reasons.push(`valuation ${fdvToLiq.toFixed(0)}× the pool — paper price`); }

  // ── age-aware horizon selection ──
  // A 24-minute-old pair reports h24 == h6 == h1: the long windows are copies, not
  // history. Judging "trend intact" from a duplicated horizon is false confidence.
  const age = i.ageMinutes ?? null;
  const dupLong = i.change24h != null && i.change6h != null && i.change24h === i.change6h;
  const degenerateHorizons = (age != null && age < 360) || dupLong;
  const trendHorizon: MarketQuality["trendHorizon"] =
    age == null ? (dupLong ? "h1" : "h6")
    : age >= 360 ? "h6"
    : age >= 60 ? "h1"
    : age >= 10 ? "m5"
    : "none";
  const trendChange =
    trendHorizon === "h6" ? i.change6h
    : trendHorizon === "h1" ? (i.change1h ?? i.change6h)
    : trendHorizon === "m5" ? i.change5m
    : null;
  if (degenerateHorizons) {
    reasons.push(`too young for 6h/24h horizons — trend read from ${trendHorizon} instead`);
  }

  // ── spent-move detection, on horizons that actually exist ──
  const ranUp = (i.change24h ?? 0) > 25;
  const spentMove = trendHorizon === "none"
    ? false
    : ranUp && ((trendChange ?? 0) <= 0 || (i.change5m ?? 0) < 0);
  if (spentMove) reasons.push(`ran ${(i.change24h ?? 0).toFixed(0)}% but ${trendHorizon} is rolling over — move likely spent`);

  // ── strict composite gate (decision 2: is it actually entryable?) ──
  const entryQuality =
    liq >= EVIDENCE.MIN_LIQUIDITY_ENTRY_USD &&
    vol >= EVIDENCE.MIN_VOL24_ENTRY_USD &&
    (turnover ?? 0) >= EVIDENCE.MIN_TURNOVER_ENTRY &&
    (turnover ?? 0) <= EVIDENCE.MAX_TURNOVER_ENTRY &&
    (trendChange ?? -1) > 0 && trendHorizon !== "none" &&
    fdvToLiq != null && fdvToLiq <= EVIDENCE.MAX_FDV_TO_LIQUIDITY &&
    !spentMove;
  if (!entryQuality) {
    if (liq < EVIDENCE.MIN_LIQUIDITY_ENTRY_USD) reasons.push(`pool $${liq.toFixed(0)} below the $${EVIDENCE.MIN_LIQUIDITY_ENTRY_USD} entry floor`);
    if (vol < EVIDENCE.MIN_VOL24_ENTRY_USD) reasons.push(`24h volume below the $${EVIDENCE.MIN_VOL24_ENTRY_USD} entry floor`);
    if ((turnover ?? 0) > EVIDENCE.MAX_TURNOVER_ENTRY) reasons.push(`turnover ${turnover?.toFixed(0)}× — churn, not accumulation`);
    if (trendHorizon === "none") reasons.push("too young to establish any trend (<10 min)");
    else if ((trendChange ?? -1) <= 0) reasons.push(`${trendHorizon} trend not intact`);
    if (fdvToLiq != null && fdvToLiq > EVIDENCE.MAX_FDV_TO_LIQUIDITY) reasons.push(`valuation ${fdvToLiq.toFixed(0)}× pool (limit ${EVIDENCE.MAX_FDV_TO_LIQUIDITY}×)`);
  }
  return { watchable, entryQuality, spentMove, trendHorizon, degenerateHorizons, fdvToLiq, turnover, reasons };
}

// ── Exit plan ───────────────────────────────────────────────────────────────
/**
 * What to do AFTER buying — the half of the trade that was missing entirely.
 *
 * Everything until now described how to get in. The forward data says the getting-out
 * is where the money is decided:
 *
 *     median peak  +9.2% at 15 min · +13.8% at 1h · +15.5% at 6h and at 24h
 *     46% of coins in the 8-20k band halve at some point
 *
 * Two thirds of the whole move happens inside fifteen minutes, and after an hour it is
 * finished — h6 and h24 are identical. Holding past that is not patience, it is how the
 * 46% happens. So the plan is: take most of it into the first push, move the stop to
 * break-even once that is banked, and be out on a clock rather than on hope.
 */
export interface ExitInput {
  entryPrice: number | null;
  invalidation: number | null;
  target: number | null;
  /** Milliseconds since the position was opened. */
  heldMs?: number | null;
  /** Current price, when the position is live. */
  price?: number | null;
}

export interface ExitStep {
  at: number;          // price level
  takePct: number;     // share of the position to close here
  label: string;
}

export interface ExitPlan {
  steps: ExitStep[];
  stop: number | null;
  /** Where the stop moves to once the first target is banked. */
  stopAfterFirst: number | null;
  /** Close whatever is left after this, move or no move. */
  timeStopMs: number;
  /** What to do right now, when the position is live. */
  action: string | null;
  reasons: string[];
}

export const EXIT = {
  /** Banked into the first push. Median peak is +9.2% by 15 min — most of the move. */
  FIRST_TAKE: 0.6,
  /** Fraction of the way to target for the first take. */
  FIRST_AT: 0.5,
  /** After an hour the median coin has stopped moving; h6 and h24 are identical. */
  TIME_STOP_MS: 60 * 60_000,
} as const;

export function exitPlan(i: ExitInput): ExitPlan {
  const reasons: string[] = [];
  const { entryPrice, invalidation, target } = i;
  if (entryPrice == null || entryPrice <= 0 || target == null || target <= entryPrice) {
    return { steps: [], stop: invalidation ?? null, stopAfterFirst: null,
             timeStopMs: EXIT.TIME_STOP_MS, action: null,
             reasons: ["no entry/target to plan an exit from"] };
  }
  const first = entryPrice + (target - entryPrice) * EXIT.FIRST_AT;
  const steps: ExitStep[] = [
    { at: first, takePct: EXIT.FIRST_TAKE, label: `neem ${Math.round(EXIT.FIRST_TAKE * 100)}% — de meeste beweging zit in de eerste push` },
    { at: target, takePct: 1 - EXIT.FIRST_TAKE, label: "laat de rest lopen tot het doel" },
  ];
  reasons.push("tweederde van de beweging zit in de eerste 15 minuten");
  reasons.push("na een uur beweegt de mediane coin niet meer — h6 en h24 zijn gelijk");

  // Live position: say the one thing to do now.
  let action: string | null = null;
  const px = i.price ?? null;
  const held = i.heldMs ?? null;
  if (px != null) {
    if (invalidation != null && px <= invalidation) action = "stop geraakt — sluiten";
    else if (px >= target) action = "doel bereikt — sluiten";
    else if (px >= first) action = `neem ${Math.round(EXIT.FIRST_TAKE * 100)}% en zet de stop op break-even`;
    else if (held != null && held >= EXIT.TIME_STOP_MS) action = "een uur voorbij zonder beweging — sluiten";
    else action = "vasthouden";
  }
  return { steps, stop: invalidation ?? null, stopAfterFirst: entryPrice,
           timeStopMs: EXIT.TIME_STOP_MS, action, reasons };
}

// ── Potential score ─────────────────────────────────────────────────────────
/**
 * "Highest potential, least downside" as a number, derived from measured outcomes
 * rather than chosen by hand.
 *
 * Every threshold in this file before now was picked by a person and then defended.
 * This one is not: each weight is the LIFT a condition showed over the base rate in
 * our own forward measurements — how much more often coins with that property became
 * a clean runner (peak >= +25% AND never halved). Lift above 1 helps, below 1 hurts,
 * and roughly 1 is noise no matter how sensible the factor sounds.
 *
 * Measured 2026-08-23 on 1,045 graded outcomes at the h1 horizon across 509 coins.
 * Base rate: 20% clean.
 *
 * Two results contradicted assumptions that had been in this codebase for weeks:
 *
 *   fdv/liq BELOW 2x scored 0.41 — the worst valuation bucket, not the best. A coin
 *   whose market cap barely exceeds its own pool has nowhere to go; most of what it
 *   is worth IS the liquidity. The productive band is 5-12x.
 *
 *   HIGHER_LOW_FORMING scored 1.49, the highest lift of any factor measured. The
 *   pull-back-into-support setup earns its place on evidence, not on chart lore.
 *
 * Re-derive with the query in docs/CANONICAL_ARCHITECTURE.md whenever the sample
 * grows; a weight that is no longer true is worse than no weight at all.
 */
export interface LiftFactor {
  /** Which observable this reads. */ factor: string;
  /** Human label for the UI. */ label: string;
  /** Measured lift over the base rate. */ lift: number;
  /** Sample size behind the measurement — small n is reported, never hidden. */ n: number;
}

export const POTENTIAL_BASE_RATE = 0.20;
export const POTENTIAL_MEASURED_AT = "2026-08-23";

/** Buckets are [inclusive lower bound, lift, n, label]; the first match wins. */
const LIFTS = {
  turnover: [
    [15, 0.97, 140, "turnover >15×"],
    [4, 1.43, 271, "turnover 4–15× — actief verhandeld"],
    [1, 1.13, 237, "turnover 1–4×"],
    [0, 0.36, 297, "turnover <1× — nauwelijks handel"],
  ],
  fdvToLiq: [
    [12, 0.67, 63, "waardering >12× de pool"],
    [5, 1.43, 236, "waardering 5–12× — ruimte om te bewegen"],
    [2, 0.97, 438, "waardering 2–5×"],
    [0, 0.41, 208, "waardering <2× — de pool ís de coin"],
  ],
  liquidityUsd: [
    [40_000, 1.13, 235, "diepe pool"],
    [15_000, 1.02, 326, "pool 15–40k"],
    [8_000, 0.97, 244, "pool 8–15k"],
    [0, 0.41, 140, "pool <8k — te dun"],
  ],
  /**
   * Measured WITHIN the 150k ceiling, so these lifts answer the question that is
   * actually being asked: given that we only trade under 150k, where under 150k?
   *
   * At h6, 2x rate by band (n=760): <25k 9%, 25-75k 14%, 75-150k 12%; base 11.2%.
   * Drawdown moves the other way — <25k halves 23% of the time against 52% for
   * 25-75k — but the p90 peak (95% vs 135%) says the smallest band is not safer
   * so much as inert. It rarely falls because it rarely moves.
   *
   * Deliberately NOT extrapolated above 150k: those coins are out of the universe,
   * so a lift for them would be a number no one can act on.
   */
  marketCapUsd: [
    [75_000, 1.07, 154, "75–150k — bovenkant van het bereik"],
    [25_000, 1.25, 247, "25–75k — beste band gemeten"],
    [0, 0.80, 359, "<25k — beweegt zelden ver"],
  ],
} as const;

const PROXIMITY_LIFT: Record<string, [number, number, string]> = {
  HIGHER_LOW_FORMING: [1.49, 42, "hogere bodem — sterkste setup gemeten"],
  BASE_FORMING: [1.23, 29, "basis aan het vormen"],
  PULLBACK_FORMING: [0.92, 57, "terugval nog gaande"],
  TOO_EXTENDED: [0.97, 59, "ver boven de basis"],
  NO_STRUCTURE: [0.97, 816, "nog geen structuur"],
};

const ACTIVITY_LIFT: Record<string, [number, number, string]> = {
  REAL: [1.18, 408, "echte handel"],
  THIN: [0.36, 118, "dunne handel"],
  PARKED: [0.15, 67, "geparkeerde pool"],
  DUST_WASH: [0.15, 67, "wash trading"],
};

function bucketLift(table: readonly (readonly [number, number, number, string])[], v: number | null) {
  if (v == null || !Number.isFinite(v)) return null;
  for (const [min, lift, n, label] of table) if (v >= min) return { lift, n, label };
  return null;
}

export interface PotentialInput {
  turnover: number | null;
  fdvToLiq: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  proximity: string | null;
  activity: string | null;
}

export interface PotentialScore {
  /** Estimated chance this becomes a clean runner, as a fraction. */
  estimate: number | null;
  /** How many times the base rate that is. */
  lift: number | null;
  helps: LiftFactor[];
  hurts: LiftFactor[];
  /** Factors we could not read — the estimate is weaker for each. */
  unknown: string[];
}

export function potentialScore(i: PotentialInput): PotentialScore {
  const helps: LiftFactor[] = [];
  const hurts: LiftFactor[] = [];
  const unknown: string[] = [];
  let product = 1;

  const add = (factor: string, r: { lift: number; n: number; label: string } | null) => {
    if (!r) { unknown.push(factor); return; }
    product *= r.lift;
    const f: LiftFactor = { factor, label: r.label, lift: r.lift, n: r.n };
    // Treat near-1 as neither help nor hurt: reporting noise as a reason is how a
    // score starts sounding more certain than it is.
    if (r.lift >= 1.10) helps.push(f);
    else if (r.lift <= 0.90) hurts.push(f);
  };

  add("turnover", bucketLift(LIFTS.turnover, i.turnover));
  add("waardering", bucketLift(LIFTS.fdvToLiq, i.fdvToLiq));
  add("liquiditeit", bucketLift(LIFTS.liquidityUsd, i.liquidityUsd));
  add("grootte", bucketLift(LIFTS.marketCapUsd, i.marketCapUsd));
  const p = i.proximity ? PROXIMITY_LIFT[i.proximity] : undefined;
  add("setup", p ? { lift: p[0], n: p[1], label: p[2] } : null);
  const a = i.activity ? ACTIVITY_LIFT[i.activity] : undefined;
  add("markt", a ? { lift: a[0], n: a[1], label: a[2] } : null);

  // With most factors unreadable the number would be a guess wearing a decimal point.
  // Threshold is 4 of 6 since market cap joined the set — keeping it at 3 would have
  // silently tightened the rule the day a factor was added.
  if (unknown.length >= 4) return { estimate: null, lift: null, helps, hurts, unknown };

  const estimate = Math.max(0, Math.min(1, POTENTIAL_BASE_RATE * product));
  helps.sort((x, y) => y.lift - x.lift);
  hurts.sort((x, y) => x.lift - y.lift);
  return { estimate, lift: product, helps, hurts, unknown };
}
