/**
 * Token-bucket rate limiter. In-memory implementation for Phase 1 (a Redis-backed
 * version with the same interface comes when the worker runs multiple processes).
 * Deterministic and injectable clock/sleep so it is unit-testable without real time.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface RateLimiterOptions {
  /** Sustained requests per minute. */
  ratePerMinute: number;
  /** Max burst (bucket capacity). Defaults to ceil(ratePerMinute/6) or 1. */
  burst?: number;
  clock?: Clock;
}

export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private last: number;
  private readonly clock: Clock;

  constructor(opts: RateLimiterOptions) {
    this.clock = opts.clock ?? realClock;
    this.capacity = Math.max(1, opts.burst ?? Math.max(1, Math.ceil(opts.ratePerMinute / 6)));
    this.refillPerMs = opts.ratePerMinute / 60000;
    this.tokens = this.capacity;
    this.last = this.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.last;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.last = now;
    }
  }

  /** Milliseconds until at least one token is available (0 if available now). */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  /** Acquire a token, waiting (via injected clock) if necessary. */
  async acquire(): Promise<void> {
    for (;;) {
      const wait = this.msUntilAvailable();
      if (wait === 0) {
        this.tokens -= 1;
        return;
      }
      await this.clock.sleep(wait);
    }
  }

  /** Try to acquire without waiting. Returns true if a token was taken. */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
