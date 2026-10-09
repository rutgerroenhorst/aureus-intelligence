/**
 * Pure decision rules shared by every surface. No DB, no clock — unit-testable.
 *
 * §4 canonical blocker: exactly ONE primary blocker, chosen by a fixed priority
 * order. Everything else is a secondary blocker. This makes contradictory cards
 * ("entry confirmed" + "Entry FAIL" + "awaiting structure") impossible.
 */

export interface BlockerInput {
  anySafetyFail: boolean;
  failingRules: string[];
  fresh: boolean;
  sellClass: string | null;
  drainStatus: string;      // OK | FAIL | INCOMPLETE | UNAVAILABLE
  drainSeverity: string;    // normal | warning | critical | pool_gone | stale
  liveness: string;         // ACTIVE | THIN | FROZEN | POOL_GONE | UNKNOWN
  livenessReason: string;
  coreSafety: string;       // PASS | FAIL | INCOMPLETE | NA
  coreMissing: string[];
  coreReason: string;   // precise reason from safetyLayers (names the rules/datasets)
  proximity: string;
  status: string;
  planValid: boolean;
  planInvalidReasons: string[];
  scans: number;
  estSlippagePct: number | null;
}

const CONFIRM_SCANS = 2;

/** Human explanations for why a Safety rule can't resolve yet — the UI must never
 *  show a bare rule ID as the reason a user can't act. */
export const RULE_PLAIN: Record<string, string> = {
  "SAFE-01-CRITICAL-DATA": "critical on-chain datasets still incomplete",
  "SAFE-02-BLACKLIST-FUNDING": "deployer funding reputation not yet established",
  "SAFE-03-INSIDER-CONCENTRATION": "insider concentration not yet measurable",
  "SAFE-04-BUNDLE-CONTAMINATION": "launch-bundle attribution unavailable",
  "SAFE-05-LIQUIDITY-DRAIN": "needs 1h of continuous liquidity history to confirm no drain",
  "SAFE-06-AUTHORITY-SELLABILITY": "mint/freeze authority + sell route not both confirmed",
};
/** Rewrite "Core rules not resolved: SAFE-05-..." into plain language. */
export function humanizeCoreReason(reason: string): string {
  const m = reason.match(/Core rules not resolved: (.+)$/);
  if (!m) return reason;
  const ids = m[1]!.split(",").map((x) => x.trim());
  const parts = ids.map((id) => RULE_PLAIN[id] ?? id);
  return `core safety pending — ${parts.join("; ")}`;
}
const MAX_SLIPPAGE_PCT = 5;

/** Fixed priority order — the first matching rule wins as the PRIMARY blocker. */
export function canonicalBlocker(i: BlockerInput): { primary: string; secondary: string[] } {
  const candidates: Array<[boolean, string]> = [
    // 1. critical Safety FAIL
    [i.anySafetyFail, `critical safety FAIL: ${i.failingRules.join(", ") || "safety rule"}`],
    // 2. dead or frozen market — a rising chart on an abandoned pool is the worst trap
    [i.liveness === "POOL_GONE", "pool liquidity removed — chart is stale, pool is dead"],
    [i.liveness === "FROZEN", i.livenessReason || "market frozen — no new trades landing"],
    // 3. stale market data
    [!i.fresh, "stale market data"],
    // 3. sellability problem
    [i.sellClass === "CONFIRMED_SELLABILITY_FAIL", "confirmed sellability failure"],
    [i.sellClass === "INSUFFICIENT_LIQUIDITY", "insufficient liquidity to sell"],
    [i.sellClass === "NO_ROUTE_RETRY" || i.sellClass === "INDEXING_UNKNOWN", "sell route unconfirmed"],
    // 4. critical liquidity drain
    [i.drainStatus === "FAIL", `critical liquidity drain (${i.drainSeverity.replace(/_/g, " ")})`],
    // 5. Core Safety incomplete
    [i.coreSafety === "INCOMPLETE", i.coreMissing.length
      ? `core safety incomplete — missing: ${i.coreMissing.join(", ")}`
      : (i.coreReason ? humanizeCoreReason(i.coreReason) : "core safety incomplete")],
    // 6. no valid structure
    [i.proximity === "NO_STRUCTURE", "no valid entry structure yet"],
    // 7. overextended / pullback required
    [i.proximity === "TOO_EXTENDED" || i.status === "TOO_EXTENDED", "overextended — pullback required"],
    // 8. plan levels not usable
    [!i.planValid && i.planInvalidReasons.length > 0, `entry levels not usable: ${i.planInvalidReasons[0]}`],
    // 9. confirmation scans missing
    [i.scans < CONFIRM_SCANS && i.status !== "ENTRY_READY", `awaiting confirmation scans (${i.scans}/${CONFIRM_SCANS})`],
    // 10. slippage / R:R failure
    [i.estSlippagePct != null && i.estSlippagePct > MAX_SLIPPAGE_PCT, `slippage ${i.estSlippagePct?.toFixed(1)}% above limit`],
  ];
  const hits = candidates.filter(([cond]) => cond).map(([, label]) => label);
  if (hits.length === 0) {
    return { primary: i.status === "ENTRY_READY" ? "none — entry ready" : "awaiting final confirmation", secondary: [] };
  }
  return { primary: hits[0]!, secondary: hits.slice(1) };
}

/** §7 — priority is a function of status; illegal combinations cannot occur. */
export function watchPriorityFor(status: string, inPrimarySlot: boolean): "CRITICAL" | "PRIMARY" | "SECONDARY" | "OBSERVATION" | "DORMANT" {
  switch (status) {
    case "ENTRY_READY": return "CRITICAL";
    case "ENTRY_APPROACHING": return "PRIMARY";
    case "SETUP_FORMING": return inPrimarySlot ? "PRIMARY" : "SECONDARY";
    case "FUNDAMENTAL_WATCH": return inPrimarySlot ? "PRIMARY" : "SECONDARY";
    case "DISCOVERED": return "OBSERVATION";
    case "REJECTED":
    case "INVALIDATED":
    case "EXPIRED": return "DORMANT";
    default: return "OBSERVATION";
  }
}

/** §8 — persisted next-scan cadence derived from the action status. */
export const CADENCE_MS: Record<string, number> = {
  ENTRY_READY: 7_000,          // 5–10s
  ENTRY_APPROACHING: 12_000,   // 10–15s
  SETUP_FORMING: 15_000,       // 10–20s
  FUNDAMENTAL_WATCH_PRIMARY: 30_000,   // 20–45s
  FUNDAMENTAL_WATCH_SECONDARY: 120_000, // 60–180s
  DISCOVERED: 300_000,         // 2–10m
  TOO_EXTENDED: 30_000,
  REJECTED: 0,                 // dormant
  INVALIDATED: 0,
  EXPIRED: 0,
};

export function cadenceMsFor(status: string, priority: string): number {
  if (status === "FUNDAMENTAL_WATCH" || status === "SETUP_FORMING") {
    if (status === "SETUP_FORMING") return CADENCE_MS.SETUP_FORMING!;
    return priority === "PRIMARY" ? CADENCE_MS.FUNDAMENTAL_WATCH_PRIMARY! : CADENCE_MS.FUNDAMENTAL_WATCH_SECONDARY!;
  }
  return CADENCE_MS[status] ?? CADENCE_MS.DISCOVERED!;
}

/**
 * §5 — TOO_EXTENDED must be structural, never a raw return threshold.
 * A candidate is over-extended only when price has run beyond the level a
 * disciplined entry would still accept (max chase), or sits far above the range
 * top relative to the range's own width.
 */
export interface ExtensionInput {
  price: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  maxChase: number | null;
  return30m: number | null; // context only — never the sole trigger
}
export function isTooExtended(i: ExtensionInput): { extended: boolean; reason: string } {
  const { price, rangeLow, rangeHigh, maxChase } = i;
  if (price == null) return { extended: false, reason: "no price" };
  // Above the maximum acceptable chase → chasing, by definition.
  if (maxChase != null && price > maxChase) {
    return { extended: true, reason: `price above maximum chase (${maxChase.toPrecision(3)})` };
  }
  if (rangeHigh == null || rangeLow == null || rangeHigh <= rangeLow) {
    return { extended: false, reason: "no usable range to measure extension" };
  }
  // Distance above the range top, expressed in range-widths (volatility-relative).
  const width = rangeHigh - rangeLow;
  const above = (price - rangeHigh) / width;
  if (above > 1.0) return { extended: true, reason: `price ${above.toFixed(1)}× range-width above range high` };
  return { extended: false, reason: `within ${above.toFixed(2)}× range-width of range high` };
}

/**
 * Does this candidate still belong on the ACTIVE board?
 *
 * The discovery age window is applied at the door, but nothing re-applied it afterwards,
 * so candidates admitted under the old launch-firehose strategy stayed on the watchlist
 * forever. Six of fourteen board slots were 548–625h-old coins, two of them with a pool
 * of exactly $0 — sitting in TOO_EXTENDED as though a pull-back might still be coming.
 *
 * Nothing is deleted: these rows still back the verdict-grading cohorts and their own
 * detail pages. They are classified out of the active universe, with the reason kept, so
 * the board reflects what is tradeable instead of everything ever seen.
 */
export type UniverseStatus = "ACTIVE" | "POOL_DEAD" | "TOO_THIN" | "TOO_YOUNG" | "AGED_OUT" | "NOT_REAL_MARKET";

const UNIVERSE_MAX_AGE_MS = Number(process.env.DISCOVERY_MAX_AGE_HOURS ?? 48) * 3.6e6;
/**
 * The TRADABILITY floor, deliberately decoupled from the discovery floor.
 *
 * They used to be one env var, which quietly forced a bad trade-off: the only way to
 * OBSERVE thinner pools was to also present them as buyable. So the blind spot stayed —
 * of 299 verdicts in the 25-75k band, exactly ONE had a pool under $6k, because the
 * floor blocked them before they could ever be measured. A filter that rejects
 * everything looks identical to a good one.
 *
 * Discovery may now go lower to gather evidence. This number does not move: nothing
 * under it is ever shown as tradable, so widening observation cannot widen risk.
 */
const UNIVERSE_MIN_LIQUIDITY = Number(process.env.UNIVERSE_MIN_LIQUIDITY_USD ?? 6_000);
/**
 * The minimum age at which a coin may be presented as tradable. Measured on our own
 * forward outcomes at h1:
 *
 *   age <1h    n=258   median peak +11%   median dip -40%   43% HALVED
 *   age 1-6h   n= 75   median peak  +6%   median dip  -4%   13% halved
 *
 * The first hour carries the same upside as the next twenty-three and ten times the
 * downside. This gate used to live ONLY in discovery, which meant "we do not watch it
 * yet" was doing the work of "you must not buy it yet" — two different claims resting
 * on one number. Watching earlier is how a coin becomes judgeable AT one hour instead
 * of at three; buying earlier is just the worst risk profile in the data.
 */
const UNIVERSE_MIN_AGE_MS = Number(process.env.UNIVERSE_MIN_AGE_MINUTES ?? 60) * 60_000;

export function universeStatus(v: {
  liquidityUsd: number | null; pairAgeMs: number | null; activity: string | null;
}): { status: UniverseStatus; reason: string } {
  const liq = v.liquidityUsd ?? 0;
  if (liq <= 500) return { status: "POOL_DEAD", reason: "pool liquidity is gone" };
  if (liq < UNIVERSE_MIN_LIQUIDITY) {
    return { status: "TOO_THIN", reason: `pool $${Math.round(liq).toLocaleString()} below the $${UNIVERSE_MIN_LIQUIDITY.toLocaleString()} universe floor` };
  }
  if (v.pairAgeMs != null && v.pairAgeMs < UNIVERSE_MIN_AGE_MS) {
    return { status: "TOO_YOUNG", reason: `${Math.round(v.pairAgeMs / 60_000)} min oud — onder de ${Math.round(UNIVERSE_MIN_AGE_MS / 60_000)} minuten waarop 43% halveert` };
  }
  if (v.pairAgeMs != null && v.pairAgeMs > UNIVERSE_MAX_AGE_MS) {
    return { status: "AGED_OUT", reason: `${Math.round(v.pairAgeMs / 3.6e6)}h old — past the ${Math.round(UNIVERSE_MAX_AGE_MS / 3.6e6)}h window` };
  }
  if (v.activity === "DUST_WASH" || v.activity === "PARKED") {
    return { status: "NOT_REAL_MARKET", reason: v.activity === "DUST_WASH" ? "wash-traded market" : "pool parked, not traded" };
  }
  return { status: "ACTIVE", reason: "" };
}
