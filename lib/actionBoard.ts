/**
 * Deterministic ACTION-BOARD status model.
 *
 * Pure functions only — no DB, no clock side effects (nowMs is passed in) — so the
 * status and ranking are reproducible and unit-testable. This is NOT a new research
 * engine: it re-reads what the existing rules / readiness / enrichment / market
 * pipeline already produced and maps it to a practical trade-watch status.
 *
 * There is NO win-probability, success-score, or confidence-to-profit anywhere here.
 * `rankingScore` is an ordering key for prioritisation ONLY.
 */

export type ActionStatus =
  | "ACTIONABLE_NOW"
  | "WATCH_SAFETY_INCOMPLETE"
  | "WAIT_FOR_ENTRY"
  | "TOO_EXTENDED"
  | "INVALIDATED"
  | "REJECTED";

export type FamilyStatus = "PASS" | "FAIL" | "INCOMPLETE" | "NA";

/** Thresholds — deterministic, tunable in one place. */
export const AB = {
  MIN_LIQUIDITY_USD: 8_000, // below → too thin to consider
  DEAD_LIQUIDITY_USD: 2_500, // below → treat pool as inactive
  STALE_MS: 15 * 60_000, // ≥15m since last price = stale
  AGING_MS: 2 * 60_000, // ≥2m = aging
  EXTREME_CONCENTRATION: 0.75, // top-10 holders → hard risk
  HIGH_CONCENTRATION: 0.55, // top-10 holders → flag
  OVEREXTENDED_30M: 0.4, // +40%/30m with no pullback → too extended
  LIQ_DRAIN_PCT: -0.2, // 30m liquidity change ≤ −20% → draining
  LIQ_FAILURE_PCT: -0.4, // ≤ −40% → confirmed liquidity failure
  DEAD_VOLUME_USD: 1_500, // 30m avg volume below → flow is dead
} as const;

export interface ActionInput {
  nowMs: number;
  // identity / monitoring
  currentState: string;
  monitoringTier: string; // TIER0_DORMANT … TIER4_TRADE
  stopMonitoringReason: string | null;
  downgradeReason: string | null;
  // market
  priceUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null; // latest window
  avgVolume30m: number | null;
  buys: number | null;
  sells: number | null;
  priceAtMs: number | null; // freshness anchor (latest price observation)
  price5mAgo: number | null;
  price15mAgo: number | null;
  price30mAgo: number | null;
  liq5mAgo: number | null;
  liq15mAgo: number | null;
  liq30mAgo: number | null;
  liqAtDiscovery: number | null;
  pairAgeMs: number | null;
  // enrichment / on-chain
  enrichmentStatus: string;
  enrichmentAgeMs: number | null; // age of the on-chain enrichment (freshness)
  holderTop10: number | null; // 0..1
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  missingDatasets: string[]; // dataset keys still INCOMPLETE
  // rule families (aggregated, current)
  safety: FamilyStatus;
  quality: FamilyStatus;
  entry: FamilyStatus;
  entryOverextended: boolean; // ENTRY-02-NOT-OVEREXTENDED == FAIL
  safetyLiquidityDrainFail: boolean; // SAFE-05-LIQUIDITY-DRAIN == FAIL
}

export interface ActionResult {
  status: ActionStatus;
  rankingScore: number;
  rankingReasons: string[];
  positives: string[];
  risks: string[];
  blocker: string;
  entryTrigger: string;
  invalidation: string;
  chaseStatus: string;
  waitingConfirmed: string[];
  waitingOpen: string[];
  safetySummary: string;
  qualitySummary: string;
  entrySummary: string;
  freshness: "fresh" | "aging" | "stale" | "none";
  priceChange: { m5: number | null; m15: number | null; m30: number | null };
  liqTrend: { m5: number | null; m15: number | null; m30: number | null; sinceDiscovery: number | null };
  liqTrendPct: number | null; // 30m — kept for back-compat
  buyShare: number | null; // buys / (buys + sells)
  buySellRatio: number | null; // buys / sells
  volTrend: "active" | "weak" | "dead" | "unknown";
  rankingBreakdown: Array<{ label: string; points: number }>;
}

function pctChange(now: number | null, then: number | null): number | null {
  if (now == null || then == null || then === 0) return null;
  return (now - then) / then;
}

function freshnessOf(nowMs: number, atMs: number | null): ActionResult["freshness"] {
  if (atMs == null) return "none";
  const s = nowMs - atMs;
  if (s < AB.AGING_MS) return "fresh";
  if (s < AB.STALE_MS) return "aging";
  return "stale";
}

function tierRank(tier: string): number {
  const m: Record<string, number> = { TIER4_TRADE: 4, TIER3_WATCH: 3, TIER2_ENRICHMENT: 2, TIER1_LOW: 1, TIER0_DORMANT: 0 };
  return m[tier] ?? 1;
}

function familyText(s: FamilyStatus, incompleteNote: string): string {
  if (s === "PASS") return "PASS";
  if (s === "FAIL") return "FAIL";
  if (s === "NA") return "n/a";
  return `INCOMPLETE — ${incompleteNote}`;
}

/**
 * The deterministic decision. Order matters: hard failures first, then invalidation,
 * then extension, then the positive ladder. A candidate can only be ACTIONABLE_NOW
 * when Entry is a confirmed PASS AND Safety is a confirmed PASS — because without a
 * candle/range trigger Entry can never PASS, ACTIONABLE_NOW stays empty by construction
 * rather than by a lowered bar.
 */
export function computeAction(i: ActionInput): ActionResult {
  const fresh = freshnessOf(i.nowMs, i.priceAtMs);
  const m5 = pctChange(i.priceUsd, i.price5mAgo);
  const m15 = pctChange(i.priceUsd, i.price15mAgo);
  const m30 = pctChange(i.priceUsd, i.price30mAgo);
  // Liquidity trend across explicit horizons (30m is the primary decision input).
  const liq5 = pctChange(i.liquidityUsd, i.liq5mAgo);
  const liq15 = pctChange(i.liquidityUsd, i.liq15mAgo);
  const liqTrend = pctChange(i.liquidityUsd, i.liq30mAgo);
  const liqDisc = pctChange(i.liquidityUsd, i.liqAtDiscovery);
  const totalTx = (i.buys ?? 0) + (i.sells ?? 0);
  const buyShare = totalTx > 0 ? (i.buys ?? 0) / totalTx : null; // share of buys
  const buySellRatio = (i.sells ?? 0) > 0 ? (i.buys ?? 0) / (i.sells ?? 1) : (i.buys ?? 0) > 0 ? Infinity : null;
  const conc = i.holderTop10;
  const volNow = i.avgVolume30m ?? i.volumeUsd;
  const volTrend: ActionResult["volTrend"] =
    volNow == null ? "unknown" : volNow < AB.DEAD_VOLUME_USD ? "dead" : volNow < AB.DEAD_VOLUME_USD * 6 ? "weak" : "active";
  // Momentum: how many of the three horizons are negative.
  const negHorizons = [m5, m15, m30].filter((x) => x != null && x < 0).length;
  const allNeg = m5 != null && m15 != null && m30 != null && m5 < 0 && m15 < 0 && m30 < 0;
  const liqContracting = liqTrend != null && liqTrend < -0.02;
  const enrStale = i.enrichmentAgeMs != null && i.enrichmentAgeMs > 30 * 60_000;

  const positives: string[] = [];
  const risks: string[] = [];
  const rankingReasons: string[] = [];

  // ── positives / risks (shared) ──
  if (liqTrend != null && liqTrend > 0.03) positives.push(`Liquidity growing ${fmtPct(liqTrend)} (30m)`);
  if (conc != null && conc < 0.2) positives.push(`Low holder concentration ${fmtPct(conc)}`);
  if (buyShare != null && buyShare > 0.55) positives.push(`Buy share ${fmtRatioPct(buyShare)}`);
  if (volTrend === "active") positives.push("Active volume");
  if (fresh === "fresh") positives.push("Data fresh");

  if (allNeg) risks.push(`Price declining across 5m/15m/30m (${fmtPct(m5)} / ${fmtPct(m15)} / ${fmtPct(m30)})`);
  else if (negHorizons >= 2) risks.push(`Weak momentum — ${negHorizons}/3 horizons negative`);
  if (liqContracting && (liqTrend == null || liqTrend > AB.LIQ_DRAIN_PCT)) risks.push(`Liquidity contracting ${fmtPct(liqTrend)} (30m)`);
  if (conc != null && conc >= AB.HIGH_CONCENTRATION) risks.push(`Elevated holder concentration ${fmtRatioPct(conc)}`);
  if (i.mintAuthorityActive) risks.push("Mint authority active — supply can inflate");
  if (i.freezeAuthorityActive) risks.push("Freeze authority active — transfers can be frozen");
  if (liqTrend != null && liqTrend <= AB.LIQ_DRAIN_PCT) risks.push(`Liquidity draining ${fmtPct(liqTrend)} (30m)`);
  if (enrStale) risks.push("On-chain enrichment stale (>30m)");
  if (fresh === "stale") risks.push("Market data stale");
  if (i.missingDatasets.length) risks.push(`UNKNOWN RISK — missing on-chain: ${i.missingDatasets.join(", ")}`);

  const safetySummary = familyText(i.safety, "critical on-chain data unavailable (UNKNOWN RISK)");
  const qualitySummary = familyText(i.quality, "insufficient confirmations");
  const entrySummary = familyText(i.entry, "no confirmed trigger (needs price structure)");

  // ── deterministic status ladder ──
  let status: ActionStatus;
  let blocker: string;
  let entryTrigger: string;
  let invalidation: string;
  let chaseStatus = "No chase — prepare only";

  const rejected =
    i.currentState === "REJECTED" ||
    i.stopMonitoringReason != null ||
    tierRank(i.monitoringTier) === 0 ||
    i.safety === "FAIL" ||
    i.freezeAuthorityActive === true ||
    (conc != null && conc >= AB.EXTREME_CONCENTRATION) ||
    (i.liquidityUsd != null && i.liquidityUsd < AB.DEAD_LIQUIDITY_USD) ||
    (liqTrend != null && liqTrend <= AB.LIQ_FAILURE_PCT) ||
    (fresh === "stale" && volTrend === "dead");

  const invalidated =
    !rejected &&
    ((liqTrend != null && liqTrend <= AB.LIQ_DRAIN_PCT) ||
      i.safetyLiquidityDrainFail ||
      i.downgradeReason != null ||
      (m30 != null && m30 <= -0.35 && volTrend !== "active"));

  const overextended =
    !rejected && !invalidated && (i.entryOverextended || (m30 != null && m30 >= AB.OVEREXTENDED_30M));

  if (rejected) {
    status = "REJECTED";
    blocker = rejectReason(i, conc, liqTrend, fresh, volTrend);
    entryTrigger = "—";
    invalidation = "Already invalidated / hard failure";
    chaseStatus = "REJECTED — do not monitor";
  } else if (invalidated) {
    status = "INVALIDATED";
    blocker =
      liqTrend != null && liqTrend <= AB.LIQ_DRAIN_PCT
        ? `Liquidity draining ${fmtPct(liqTrend)}`
        : i.downgradeReason ?? "Setup conditions expired (structure/volume/safety)";
    entryTrigger = "Setup void — re-qualify from scratch";
    invalidation = "Already invalidated";
    chaseStatus = "DO NOT CHASE — setup void";
  } else if (overextended) {
    status = "TOO_EXTENDED";
    blocker = `Overextended ${m30 != null ? fmtPct(m30) + "/30m" : "vs base"} — no pullback yet`;
    entryTrigger = "Pullback → higher-low → reclaim on holding volume";
    invalidation = "Vertical continuation into thinning liquidity, or trend break";
    chaseStatus = "DO NOT CHASE";
  } else if (i.entry === "PASS") {
    // Entry trigger confirmed → gate only on Safety.
    if (i.safety === "PASS") {
      status = "ACTIONABLE_NOW";
      blocker = "None — trigger + safety confirmed";
      entryTrigger = "Confirmed entry trigger";
      invalidation = "Loss of trigger level / liquidity break";
    } else {
      status = "WATCH_SAFETY_INCOMPLETE";
      blocker = "Entry trigger ready, but Safety is UNKNOWN RISK (on-chain incomplete)";
      entryTrigger = "Trigger ready — awaiting safety enrichment";
      invalidation = "Safety FAIL on enrichment / liquidity break";
    }
  } else {
    status = "WAIT_FOR_ENTRY";
    blocker =
      i.entry === "INCOMPLETE"
        ? "No confirmed entry trigger (needs price structure: base/retest/reclaim)"
        : "Awaiting entry confirmation";
    entryTrigger = waitTrigger(m30, liqTrend, buyShare);
    invalidation = "Liquidity −20% from here, net-sell flip, or base breakdown";
  }

  // ── ranking (prioritisation ONLY; no win-probability) — additive breakdown ──
  const statusWeight: Record<ActionStatus, number> = {
    ACTIONABLE_NOW: 1000,
    WATCH_SAFETY_INCOMPLETE: 820,
    WAIT_FOR_ENTRY: 700,
    TOO_EXTENDED: 480,
    INVALIDATED: 120,
    REJECTED: 0,
  };
  const bd: Array<{ label: string; points: number }> = [];
  const add = (label: string, points: number) => { if (points !== 0) bd.push({ label, points: Math.round(points * 10) / 10 }); };

  add(`status:${status}`, statusWeight[status]);
  add(`tier ${i.monitoringTier.replace(/_.*/, "")}`, tierRank(i.monitoringTier) * 12);
  add(fresh === "fresh" ? "data fresh" : fresh === "aging" ? "data aging" : "data stale", fresh === "fresh" ? 30 : fresh === "aging" ? 10 : -40);
  if (i.liquidityUsd != null) add("liquidity level", Math.min(i.liquidityUsd / 1000, 60));
  // Volume/buy weight is deliberately capped LOW so they cannot outweigh deterioration.
  if (volNow != null) add("volume level", Math.min(volNow / 20000, 25));
  if (buyShare != null) add("buy share", (buyShare - 0.5) * 40);
  // Datasets present (of implemented set).
  const okDatasets = 8 - i.missingDatasets.length;
  if (okDatasets > 0) add("datasets present", okDatasets * 3);

  // ── deterministic PENALTIES ──
  // multi-horizon price decline (each negative horizon hurts ~4× a positive one helps)
  for (const [lbl, v] of [["5m", m5], ["15m", m15], ["30m", m30]] as const) {
    if (v != null) add(`price ${lbl}`, v < 0 ? v * 160 : v * 25);
  }
  if (allNeg) add("momentum deterioration (all horizons ↓)", -45);
  // liquidity contraction (penalise the worse of 30m / since-discovery)
  const worstLiq = [liqTrend, liqDisc].filter((x): x is number => x != null && x < 0).sort((a, b) => a - b)[0];
  if (worstLiq != null) add("liquidity contraction", worstLiq * 180);
  else if (liqTrend != null && liqTrend > 0) add("liquidity growth", Math.min(liqTrend * 100, 30));
  // concentration
  if (conc != null && conc > 0.5) add("holder concentration", -(conc - 0.5) * 150);
  else if (conc != null && conc >= AB.HIGH_CONCENTRATION) add("moderate concentration", -10);
  // overextension
  if (m30 != null && m30 >= AB.OVEREXTENDED_30M) add("overextension", -(m30 - AB.OVEREXTENDED_30M) * 60);
  // no confirmed structure trigger
  if (i.entry !== "PASS") add("no entry structure", -60);
  // incomplete critical safety
  if (i.safety !== "PASS") add("safety incomplete (UNKNOWN RISK)", -40);
  // stale enrichment
  if (enrStale) add("enrichment stale", -25);

  const score = Math.round(bd.reduce((s, x) => s + x.points, 0) * 10) / 10;

  // top human-readable ranking reasons (deterministic order)
  if (status === "TOO_EXTENDED") rankingReasons.push(`Too extended ${m30 != null ? fmtPct(m30) + "/30m" : ""}`.trim());
  if (allNeg) rankingReasons.push("Penalised: declining across all horizons");
  else if (liqContracting) rankingReasons.push(`Penalised: liquidity contracting ${fmtPct(liqTrend)}`);
  if (positives[0]) rankingReasons.push(positives[0]);
  if (positives[1]) rankingReasons.push(positives[1]);
  if (status === "WAIT_FOR_ENTRY") rankingReasons.push("Waiting on entry-trigger confirmation");
  if (status === "WATCH_SAFETY_INCOMPLETE") rankingReasons.push("Waiting only on safety enrichment");
  if (rankingReasons.length === 0) rankingReasons.push(blocker);

  // ── waiting checklist ── (a NEGATIVE trend is never "stable / growing")
  const waitingConfirmed: string[] = [];
  const waitingOpen: string[] = [];
  if (fresh !== "stale" && fresh !== "none") waitingConfirmed.push("Market data fresh"); else waitingOpen.push("Fresh market data");
  if (i.liquidityUsd != null && i.liquidityUsd >= AB.MIN_LIQUIDITY_USD) waitingConfirmed.push("Liquidity above minimum"); else waitingOpen.push("Liquidity above minimum");
  if (liqTrend != null && liqTrend >= -0.02) waitingConfirmed.push(`Liquidity stable / growing (${fmtPct(liqTrend)} 30m)`);
  else waitingOpen.push(`Liquidity stabilising (${liqTrend != null ? fmtPct(liqTrend) : "?"} 30m, still contracting)`);
  if (negHorizons === 0 && m30 != null) waitingConfirmed.push("Price holding / rising"); else waitingOpen.push(`Momentum recovery (${negHorizons}/3 horizons down)`);
  if (buyShare != null && buyShare >= 0.5) waitingConfirmed.push(`Buy share positive (${fmtRatioPct(buyShare)})`); else waitingOpen.push("Buyer pressure recovery");
  if (volTrend === "active") waitingConfirmed.push("Volume active"); else waitingOpen.push("Volume expansion");
  if (i.entry === "PASS") waitingConfirmed.push("Entry trigger confirmed"); else waitingOpen.push("Entry trigger (retest/reclaim) not confirmed");
  if (i.safety === "PASS") waitingConfirmed.push("Safety confirmed"); else waitingOpen.push("Safety enrichment complete (deployer/insider/bundle/sellability)");

  return {
    status, rankingScore: score, rankingReasons, rankingBreakdown: bd, positives, risks, blocker, entryTrigger, invalidation, chaseStatus,
    waitingConfirmed, waitingOpen, safetySummary, qualitySummary, entrySummary, freshness: fresh,
    priceChange: { m5, m15, m30 }, liqTrend: { m5: liq5, m15: liq15, m30: liqTrend, sinceDiscovery: liqDisc },
    liqTrendPct: liqTrend, buyShare, buySellRatio, volTrend,
  };
}

function waitTrigger(m30: number | null, liqTrend: number | null, buyShare: number | null): string {
  if (m30 != null && m30 > 0.15) return "Pullback then higher-low reclaim (no range data to fix a level yet)";
  if (liqTrend != null && liqTrend > 0.03 && buyShare != null && buyShare > 0.55) return "Base + volume-expansion breakout that holds";
  return "Establish a base, then breakout/reclaim on expanding volume";
}

/** Ratio/share as a plain unsigned percentage (0.593 → "59.3%"). */
function fmtRatioPct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

function rejectReason(i: ActionInput, conc: number | null, liqTrend: number | null, fresh: string, volTrend: string): string {
  if (i.currentState === "REJECTED") return "State machine: REJECTED";
  if (i.stopMonitoringReason) return i.stopMonitoringReason;
  if (i.safety === "FAIL") return "Critical Safety rule FAILED";
  if (i.freezeAuthorityActive) return "Freeze authority active — unacceptable sellability risk";
  if (conc != null && conc >= AB.EXTREME_CONCENTRATION) return `Extreme holder concentration ${fmtPct(conc)}`;
  if (i.liquidityUsd != null && i.liquidityUsd < AB.DEAD_LIQUIDITY_USD) return "Liquidity effectively gone";
  if (liqTrend != null && liqTrend <= AB.LIQ_FAILURE_PCT) return `Confirmed liquidity failure ${fmtPct(liqTrend)}`;
  if (tierRankZero(i.monitoringTier)) return "Dormant / inactive pool";
  if (fresh === "stale" && volTrend === "dead") return "Stale data + dead volume — inactive";
  return "Hard failure";
}
function tierRankZero(t: string): boolean { return t === "TIER0_DORMANT"; }

function fmtPct(v: number): string {
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(p >= 10 || p <= -10 ? 0 : 1)}%`;
}

export const ACTION_LABEL: Record<ActionStatus, string> = {
  ACTIONABLE_NOW: "ACTIONABLE NOW",
  WATCH_SAFETY_INCOMPLETE: "WATCH · SAFETY UNKNOWN",
  WAIT_FOR_ENTRY: "WAIT FOR ENTRY",
  TOO_EXTENDED: "TOO EXTENDED",
  INVALIDATED: "INVALIDATED",
  REJECTED: "REJECTED",
};

/** Which visible bucket a status renders in (A/B/C/D). */
export function bucketOf(s: ActionStatus): "A" | "B" | "C" | "D" {
  if (s === "ACTIONABLE_NOW") return "A";
  if (s === "WAIT_FOR_ENTRY" || s === "WATCH_SAFETY_INCOMPLETE") return "B";
  if (s === "TOO_EXTENDED") return "C";
  return "D";
}

// ── Serializable view types (shared by server data layer + client UI) ────────
export interface BoardCandidate {
  id: string;
  candidateCode: string;
  symbol: string | null;
  name: string | null;
  mint: string;
  pool: string | null;
  currentState: string;
  monitoringTier: string;
  enrichmentStatus: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  holderTop10: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  pairAgeMs: number | null;
  priceAtMs: number | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  action: ActionResult;
  safetyDetail?: SafetyDetail;
  watch?: WatchDetail;
}

/** Two-decision view: is this a good coin (fundamentals) + when is the entry (proximity). */
export interface WatchDetail {
  status: string; // DISCOVERED..ENTRY_READY / TOO_EXTENDED / INVALIDATED / REJECTED / EXPIRED
  proximity: string; // NO_STRUCTURE..ENTRY_CONFIRMED
  fundVerdict: string; // WATCHABLE | OBSERVATION | REJECT
  qualityRank: number | null; // fundamental quality (NOT win probability)
  entryRank: number | null; // entry readiness (NOT win probability)
  priority: "PRIMARY" | "SECONDARY" | "OBSERVATION";
  sinceMs: number | null; // time in current status
  scans: number | null; // confirming scans
  trend: string; // NEW | RISING | STABLE | FALLING
  prevStatus: string | null;
  positives: string[];
  waiting: string[]; // what Aureus is waiting for
  confirmed: string[];
  blocker: string;
  bestEntryType: string | null;
  plan: {
    provisional: boolean; label: string; triggerType: string;
    entryAreaLow: number | null; entryAreaHigh: number | null;
    invalidation: number | null; maxChase: number | null; target: number | null;
    estSlippagePct: number | null; requiredConfirmation: string;
  } | null;
}

export const V2_SECTIONS = ["ENTRY_READY", "ENTRY_APPROACHING", "PRIMARY_WATCH", "SETUP_FORMING", "TOO_EXTENDED", "SECONDARY_WATCH", "INVALID_REJECTED"] as const;
export type V2Section = (typeof V2_SECTIONS)[number];

export interface SafetyDetail {
  core: string; // CORE SAFETY: PASS | FAIL | INCOMPLETE | NA
  coreBlocker: string;
  advanced: string; // ADVANCED ON-CHAIN: COMPLETE | INCOMPLETE | UNKNOWN
  deployer: string | null;
  insiderPct: number | null;
  bundle: string | null;
  sellability: string | null;
  sellClass: string | null;
  liquidityDrain: string | null;
  authorities: string | null;
  knownRisks: string[];
  unknownRisks: string[];
}

export interface BoardData {
  generatedAt: string;
  worker: {
    online: boolean;
    status: string;
    heliusMode: string;
    lastCycleAt: string | null;
    lastEnrichmentAt: string | null;
    activeMonitored: number;
  };
  counts: {
    actionable: number; wait: number; tooExtended: number; invalidatedRejected: number;
    fundamentalWatch: number; setupForming: number; entryApproaching: number; entryReady: number;
  };
  best: BoardCandidate | null;
  buckets: { A: BoardCandidate[]; B: BoardCandidate[]; C: BoardCandidate[]; D: BoardCandidate[] };
  /** New two-decision sections, in display order (§9). */
  sections: Record<V2Section, BoardCandidate[]>;
}
