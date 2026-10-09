/**
 * Simple per-source circuit breaker. After `threshold` consecutive failures the
 * circuit opens for `cooldownMs`; calls are short-circuited until it half-opens.
 * Deterministic (no random) — uses an injected/real clock.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get isOpen(): boolean {
    if (this.openedAt == null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // half-open: allow a trial call
      this.openedAt = null;
      this.failures = this.threshold - 1;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  get state(): "closed" | "open" {
    return this.isOpen ? "open" : "closed";
  }
}
