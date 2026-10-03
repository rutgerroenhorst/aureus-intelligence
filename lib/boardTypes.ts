// Type-only definitions for the board view interface
// Used by mocked frontend pages that don't require database connections

export type SectionKey =
  | "ENTRY_READY" | "ENTRY_APPROACHING" | "PRIMARY_WATCH" | "SETUP_FORMING"
  | "TOO_EXTENDED" | "SECONDARY_WATCH" | "ASSESSING" | "INVALID_REJECTED";

export interface BoardCounts {
  entryReady: number; entryApproaching: number; setupForming: number;
  fundamentalWatch: number; tooExtended: number; invalidated: number; rejected: number;
  discovered: number; activeMonitored: number; total: number;
  outsideUniverse: number;
  ripening: number;
}

export interface BoardView {
  sectionTotals: Record<SectionKey, number>;
  generatedAt: string;
  worker: {
    online: boolean; status: string; heliusMode: string;
    lastCycleAt: string | null; lastEnrichmentAt: string | null;
  };
  counts: BoardCounts;
  best: any | null;
  sections: Record<SectionKey, any[]>;
}
