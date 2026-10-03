/**
 * Bubblemaps adapter — iframe evidence link by default. The data/cluster API is
 * gated (paid key we do not hold), so `api` mode is a stub that throws until a key
 * and a verified endpoint exist. We NEVER parse the iframe or fabricate cluster
 * membership; cluster analysis comes from our own Helius-derived holder graph.
 */
import type { SourceAdapter } from "../types.js";

export class NotConfiguredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NotConfiguredError";
  }
}

export class BubblemapsAdapter implements SourceAdapter {
  readonly source = "bubblemaps" as const;
  readonly mode: "DEGRADED" | "LIVE" | "DISABLED";

  constructor(
    private readonly opts: { mode: "iframe" | "api"; apiKey?: string } = { mode: "iframe" },
  ) {
    this.mode =
      opts.mode === "api" ? (opts.apiKey ? "LIVE" : "DISABLED") : "DEGRADED";
  }

  /** An embeddable evidence URL — a picture for the analyst, never parsed as data. */
  iframeUrl(mint: string): string {
    return `https://app.bubblemaps.io/sol/token/${mint}`;
  }

  /** Cluster data — only available with a real API key + verified endpoint. */
  clusters(_mint: string): Promise<never> {
    throw new NotConfiguredError(
      "Bubblemaps data API is not configured (gated). Use iframeUrl() for evidence, " +
        "and rely on aureus_derived clusters from the Helius holder graph.",
    );
  }
}
