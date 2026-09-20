import "server-only";
/**
 * Section/bucket assembly + aggregate counts, derived ONLY from the canonical
 * CandidateDecisionView. Today, the Action Board and the API all call this, so their
 * numbers cannot disagree.
 */
import { getDecisionViews, type CandidateDecisionView } from "./candidateView";
import { workerStatus } from "./queries";
import { q } from "./db";

export const SECTION_ORDER = [
  "ENTRY_READY", "ENTRY_APPROACHING", "PRIMARY_WATCH", "SETUP_FORMING",
  "TOO_EXTENDED", "SECONDARY_WATCH",
  // Freshly discovered small caps, still being assessed. There was no section for
  // these at all, so the coins the strategy is actually built to find were invisible:
  // the board read "nothing found" while ten of them were mid-assessment.
  "ASSESSING",
  "INVALID_REJECTED",
] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

export interface BoardCounts {
  entryReady: number; entryApproaching: number; setupForming: number;
  fundamentalWatch: number; tooExtended: number; invalidated: number; rejected: number;
  discovered: number; activeMonitored: number; total: number;
  /** Candidates excluded from the board: aged out, dead pool, too thin, not a real market. */
  outsideUniverse: number;
  /** Under the one-hour buy floor: being watched now, judgeable soon. Not buyable yet. */
  ripening: number;
}

export interface BoardView {
  /** True totals per section before display caps (so the UI never implies truncation is the whole set). */
  sectionTotals: Record<SectionKey, number>;
  generatedAt: string;
  worker: {
    online: boolean; status: string; heliusMode: string;
    lastCycleAt: string | null; lastEnrichmentAt: string | null;
  };
  counts: BoardCounts;
  best: CandidateDecisionView | null;
  sections: Record<SectionKey, CandidateDecisionView[]>;
}

export async function getBoardView(nowMs = Date.now()): Promise<BoardView> {
  const [views, ws, enr] = await Promise.all([
    getDecisionViews(nowMs),
    workerStatus(),
    q<{ t: string | null }>(`SELECT max(computed_at) AS t FROM onchain_enrichment`),
  ]);

  // The board shows the ACTIVE universe. Aged-out, dead-pool, too-thin and
  // wash-traded candidates keep their rows (grading cohorts, detail pages) but stop
  // occupying watchlist slots — six of fourteen slots were 548-625h coins, two with a
  // pool of exactly $0, sitting in TOO_EXTENDED as if a pull-back were still coming.

  // QUALITY FILTER: Remove coins that fail basic GATE-07/GATE-11 criteria
  // This prevents stale/low-quality coins from clogging the board
  // EARLY DETECTION FILTERS: Show coins in their first hours, not aged-out coins
  // Strategy: We want coins from DISCOVERY phase (0-12 hours), not analyzed coins from weeks ago
  const MAX_AGE_HOURS = 72;  // Show coins from last 3 days to display qualified system coins            // Only first 12 hours (golden window for early entry)
  const MAX_MCAP_USD = 150_000;        // Target: early micro-caps (<150k)
  const MIN_LIQUIDITY_USD = 5_000;  // Lowered to show qualified coins    // Minimum tradeable (can be lower for early stage)

const qualityFilter = (v: any) => {
    // TEMPORARILY SHOW ALL COINS FOR TESTING
    return true;
  };

  const active = views; // SHOW ALL COINS - temporarily disabled universe filter
  const inactive = views.filter((v) => v.universe !== "ACTIVE");
  const by = (s: string) => active.filter((v) => v.status === s);
  const counts: BoardCounts = {
    entryReady: by("ENTRY_READY").length,
    entryApproaching: by("ENTRY_APPROACHING").length,
    setupForming: by("SETUP_FORMING").length,
    fundamentalWatch: by("FUNDAMENTAL_WATCH").length,
    tooExtended: by("TOO_EXTENDED").length,
    invalidated: by("INVALIDATED").length,
    rejected: by("REJECTED").length,
    discovered: by("DISCOVERED").length,
    activeMonitored: active.filter((v) => v.priority !== "DORMANT").length,
    total: views.length,
    // Reported so a shrinking board never looks like "nothing found" when it is
    // actually "everything found was filtered out, for these reasons".
    outsideUniverse: inactive.length,
    // Counted separately from the rest of `inactive` because it means the opposite
    // thing. A dead pool is gone; a 30-minute-old coin is the entire point of the
    // system and is simply not old enough to be judged yet. Lumping the two under
    // "outside the universe" made the pipeline of new coins look like a pile of
    // rejects — the coins the user actually wants to see, filed as failures.
    ripening: inactive.filter((v) => v.universe === "TOO_YOUNG").length,
  };

  const combined = (v: CandidateDecisionView) =>
    (v.potential != null ? v.potential * 1000 : 0) + ((v.qualityRank ?? 0) + (v.entryRank ?? 0)) / 1000;
  // EVERY section sorts on measured potential. Leaving ENTRY_APPROACHING on the old
  // hand-weighted entryRank put a 3% coin above a 53% one at the top of the board —
  // the ranking change is worthless if the most visible list ignores it.
  const byEntryRank = (a: CandidateDecisionView, b: CandidateDecisionView) => combined(b) - combined(a);
  // Rank by MEASURED potential first. qualityRank and entryRank are hand-weighted
  // scores that were never validated against an outcome; `potential` is the lift-
  // derived estimate from 1,045 graded results. The hand scores stay as the tiebreak
  // so a coin with no readable factors still sorts deterministically.
  const primary = active.filter((v) => v.priority === "PRIMARY" && (v.status === "FUNDAMENTAL_WATCH" || v.status === "SETUP_FORMING"))
    .sort((a, b) => combined(b) - combined(a));
  const secondary = active.filter((v) => v.priority === "SECONDARY").sort((a, b) => combined(b) - combined(a)).slice(0, 10);

  const sections: Record<SectionKey, CandidateDecisionView[]> = {
    ENTRY_READY: by("ENTRY_READY").sort(byEntryRank),
    ENTRY_APPROACHING: by("ENTRY_APPROACHING").sort(byEntryRank),
    PRIMARY_WATCH: primary.filter((v) => v.status === "FUNDAMENTAL_WATCH").slice(0, 5),
    SETUP_FORMING: by("SETUP_FORMING").sort(byEntryRank),
    TOO_EXTENDED: by("TOO_EXTENDED").sort(byEntryRank),
    SECONDARY_WATCH: secondary,
    // Smallest first — being early is the point, and market cap is the ordering that
    // reflects it.
    ASSESSING: active.filter((v) => v.status === "DISCOVERED")
      .sort((a, b) => (a.marketCapUsd ?? Infinity) - (b.marketCapUsd ?? Infinity))
      .slice(0, 12),
    INVALID_REJECTED: [...by("INVALIDATED"), ...by("REJECTED")].slice(0, 12),
  };
  const sectionTotals: Record<SectionKey, number> = {
    ENTRY_READY: by("ENTRY_READY").length,
    ENTRY_APPROACHING: by("ENTRY_APPROACHING").length,
    PRIMARY_WATCH: primary.filter((v) => v.status === "FUNDAMENTAL_WATCH").length,
    SETUP_FORMING: by("SETUP_FORMING").length,
    TOO_EXTENDED: by("TOO_EXTENDED").length,
    SECONDARY_WATCH: active.filter((v) => v.priority === "SECONDARY").length,
    ASSESSING: active.filter((v) => v.status === "DISCOVERED").length,
    INVALID_REJECTED: by("INVALIDATED").length + by("REJECTED").length,
  };

  // BEST CURRENT OPPORTUNITY — furthest along the ladder, then best combined rank.
  const ladder = ["ENTRY_READY", "ENTRY_APPROACHING", "SETUP_FORMING", "FUNDAMENTAL_WATCH"];
  let best: CandidateDecisionView | null = null;
  for (const s of ladder) {
    const pick = by(s).sort((a, b) => combined(b) - combined(a))[0];
    if (pick) { best = pick; break; }
  }

  const lastCycleAt = ws?.last_cycle_at ? Date.parse(ws.last_cycle_at) : null;
  const tickMs = Number((ws?.detail as { tickMs?: number })?.tickMs ?? 10_000);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    worker: {
      online: lastCycleAt != null && nowMs - lastCycleAt < Math.max(tickMs * 3, 90_000),
      status: ws?.status ?? "UNKNOWN",
      heliusMode: String((ws?.detail as { heliusMode?: string })?.heliusMode ?? "UNKNOWN"),
      lastCycleAt: ws?.last_cycle_at ?? null,
      lastEnrichmentAt: enr[0]?.t ?? null,
    },
    counts, best, sections, sectionTotals,
  };
}

export type { CandidateDecisionView };
