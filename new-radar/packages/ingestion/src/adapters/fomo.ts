/**
 * FOMO adapter — MANUAL IMPORT ONLY. No public API; automated scraping is
 * prohibited until permission/terms are established (audit §E). This adapter
 * accepts a user-provided post URL/content and requires it to resolve to an EXACT
 * mint address before it produces a social observation (evidenceStatus MANUAL).
 */
import type { SourceAdapter, AdapterResult } from "../types.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface FomoManualInput {
  postUrl: string;
  content?: string;
  /** Explicit mint provided by the user, or to be extracted from content. */
  mint?: string;
}

export class FomoResolutionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "FomoResolutionError";
  }
}

export class FomoAdapter implements SourceAdapter {
  readonly source = "fomo" as const;
  readonly mode = "DEGRADED" as const; // manual only

  /** Resolve an exact mint from explicit input or the post content. */
  resolveMint(input: FomoManualInput): string {
    if (input.mint && BASE58.test(input.mint.trim())) return input.mint.trim();
    const text = input.content ?? "";
    const candidates = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [];
    const valid = candidates.filter((c) => BASE58.test(c));
    if (valid.length === 1) return valid[0]!;
    if (valid.length === 0) {
      throw new FomoResolutionError("No exact mint address found in FOMO post; manual mint required.");
    }
    throw new FomoResolutionError(
      `Ambiguous: ${valid.length} address-like strings found. Provide the exact mint explicitly.`,
    );
  }

  /** Produce a MANUAL social observation for a resolved mint. */
  importPost(input: FomoManualInput): AdapterResult {
    const mint = this.resolveMint(input);
    return {
      source: this.source,
      endpoint: "manual-import",
      naturalKey: mint,
      observedAt: null,
      evidenceStatus: "MANUAL",
      httpStatus: null,
      payload: { mint, postUrl: input.postUrl, content: input.content ?? null },
    };
  }
}
