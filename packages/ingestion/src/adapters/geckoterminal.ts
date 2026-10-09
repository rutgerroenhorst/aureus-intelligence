/**
 * GeckoTerminal adapter — VERIFICATION + OHLCV source, not a discovery firehose.
 * Free public tier is 10 req/min (verified, audit §B), so a hard 10 rpm limiter
 * with burst 1 is enforced and calls are meant to be made on-demand per pool.
 * No key required. Requires a versioned Accept header.
 */
import type { SourceAdapter, AdapterResult } from "../types.js";
import { httpGet } from "../http.js";
import { TokenBucketLimiter } from "../rateLimiter.js";

const ACCEPT = "application/json;version=20230302";

export class GeckoTerminalAdapter implements SourceAdapter {
  readonly source = "geckoterminal" as const;
  readonly mode = "LIVE" as const;
  // Hard cap at the free-tier limit; burst 1 to avoid 429 storms.
  private readonly limiter = new TokenBucketLimiter({ ratePerMinute: 10, burst: 1 });

  constructor(private readonly baseUrl = "https://api.geckoterminal.com/api/v2") {}

  private async get<T>(endpoint: string, naturalKey: string): Promise<AdapterResult<T>> {
    const res = await httpGet(`${this.baseUrl}${endpoint}`, {
      limiter: this.limiter,
      headers: { Accept: ACCEPT },
    });
    return {
      source: this.source,
      endpoint,
      naturalKey,
      observedAt: null,
      evidenceStatus: "VERIFIED",
      httpStatus: res.status,
      payload: res.json as T,
    };
  }

  /** Secondary verification of newly created pools. */
  newPools(): Promise<AdapterResult> {
    return this.get("/networks/solana/new_pools", "solana-new-pools");
  }

  /** Pool detail incl. reserve_in_usd — second source for liquidity. */
  pool(poolAddress: string): Promise<AdapterResult> {
    return this.get(`/networks/solana/pools/${poolAddress}`, poolAddress);
  }

  /** OHLCV for Entry Engine structure detection. timeframe: minute|hour|day. */
  ohlcv(poolAddress: string, timeframe: "minute" | "hour" | "day"): Promise<AdapterResult> {
    return this.get(
      `/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}`,
      `${poolAddress}:${timeframe}`,
    );
  }
}
