/**
 * Dex Screener adapter — POLLING ONLY. No WebSocket/streaming exists (verified in
 * docs/SOURCE_CAPABILITY_AUDIT.md §A). Public REST, no key.
 *
 * Rate budgets from the audit: 60 rpm on profile/boost endpoints; the
 * /latest, /tokens, /token-pairs endpoints are treated conservatively at 300 rpm
 * and back off on 429 (the observed limit is written to source_health by the worker).
 */
import type { SourceAdapter, AdapterResult } from "../types.js";
import { httpGet } from "../http.js";
import { TokenBucketLimiter } from "../rateLimiter.js";

export class DexScreenerAdapter implements SourceAdapter {
  readonly source = "dexscreener" as const;
  readonly mode = "LIVE" as const;
  private readonly profileLimiter = new TokenBucketLimiter({ ratePerMinute: 60 });
  private readonly dataLimiter = new TokenBucketLimiter({ ratePerMinute: 300 });

  constructor(private readonly baseUrl = "https://api.dexscreener.com") {}

  private async get<T>(
    endpoint: string,
    naturalKey: string,
    limiter: TokenBucketLimiter,
  ): Promise<AdapterResult<T>> {
    const res = await httpGet(`${this.baseUrl}${endpoint}`, { limiter });
    return {
      source: this.source,
      endpoint,
      naturalKey,
      observedAt: null, // filled by normalization from payload timestamps
      evidenceStatus: "VERIFIED",
      httpStatus: res.status,
      payload: res.json as T,
    };
  }

  /** Discovery poll: newest token profiles (60 rpm). */
  latestTokenProfiles(): Promise<AdapterResult> {
    return this.get("/token-profiles/latest/v1", "latest-profiles", this.profileLimiter);
  }

  /** Discovery poll: newest boosts — paid-promotion signal for attention correction. */
  latestBoosts(): Promise<AdapterResult> {
    return this.get("/token-boosts/latest/v1", "latest-boosts", this.profileLimiter);
  }

  /** Paid orders (profile/boost/ads) for a specific token. */
  ordersForToken(mint: string, chain = "solana"): Promise<AdapterResult> {
    return this.get(`/orders/v1/${chain}/${mint}`, mint, this.profileLimiter);
  }

  /** Per-candidate refresh: batch token/pair data (comma-separated mints, <=30). */
  tokens(mints: string[], chain = "solana"): Promise<AdapterResult> {
    const key = mints.join(",");
    return this.get(`/tokens/v1/${chain}/${key}`, key, this.dataLimiter);
  }

  /**
   * Search pairs by free-text query.
   *
   * This is how the GRADUATED universe is reached. `token-profiles/latest` returns
   * brand-new launches with a median pool of ~$8K, which no position size can trade;
   * `search?q=pumpswap` returns pump.fun coins that already migrated to PumpSwap,
   * median ~$127K. Measured 2026-08-21: 27 of 30 results cleared the $30K entry floor
   * versus 0 of 6 from token-profiles.
   */
  searchPairs(query: string): Promise<AdapterResult> {
    return this.get(`/latest/dex/search?q=${encodeURIComponent(query)}`, `search:${query}`, this.dataLimiter);
  }

  /** All pools for a mint. */
  tokenPairs(mint: string): Promise<AdapterResult> {
    return this.get(`/token-pairs/v1/solana/${mint}`, mint, this.dataLimiter);
  }

  /** Single pair snapshot. */
  pair(pairId: string): Promise<AdapterResult> {
    return this.get(`/latest/dex/pairs/solana/${pairId}`, pairId, this.dataLimiter);
  }
}
