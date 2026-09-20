import { describe, it, expect } from "vitest";
import { TokenBucketLimiter, type Clock } from "./rateLimiter.js";
import { HeliusAdapter } from "./adapters/helius.js";
import { BubblemapsAdapter, NotConfiguredError } from "./adapters/bubblemaps.js";
import { FomoAdapter, FomoResolutionError } from "./adapters/fomo.js";
import { idempotencyKey } from "./types.js";

const VALID_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Deterministic fake clock. */
function fakeClock(): Clock & { advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("token bucket rate limiter", () => {
  it("enforces the configured rate over time", async () => {
    const clock = fakeClock();
    // 10 rpm, burst 1 → one token immediately, next after 6000ms.
    const lim = new TokenBucketLimiter({ ratePerMinute: 10, burst: 1, clock });
    expect(lim.tryAcquire()).toBe(true); // burst token
    expect(lim.tryAcquire()).toBe(false); // empty
    expect(lim.msUntilAvailable()).toBe(6000);
    clock.advance(6000);
    expect(lim.tryAcquire()).toBe(true);
  });

  it("acquire waits via injected clock without real delay", async () => {
    const clock = fakeClock();
    const lim = new TokenBucketLimiter({ ratePerMinute: 60, burst: 1, clock });
    await lim.acquire(); // burst
    await lim.acquire(); // must wait ~1000ms of fake time
    expect(clock.now()).toBeGreaterThanOrEqual(1000);
  });
});

describe("Helius adapter degraded mode", () => {
  it("returns UNAVAILABLE (never fabricated) without a key", async () => {
    const helius = new HeliusAdapter({ apiKey: "" });
    expect(helius.mode).toBe("DEGRADED");
    expect(helius.onChainAvailable).toBe(false);
    const r = await helius.mintAuthorities(VALID_MINT);
    expect(r.evidenceStatus).toBe("UNAVAILABLE");
    expect(r.payload).toBeNull();
    expect(r.degradedReason).toMatch(/Safety cannot PASS/);
  });

  it("MOCK mode is clearly labelled, never VERIFIED", async () => {
    const helius = new HeliusAdapter({ mock: true });
    expect(helius.mode).toBe("MOCK");
    const r = await helius.holders(VALID_MINT);
    expect(r.evidenceStatus).toBe("MOCK");
  });

  it("LIVE mode only with a key", () => {
    expect(new HeliusAdapter({ apiKey: "k" }).mode).toBe("LIVE");
  });
});

describe("Bubblemaps adapter", () => {
  it("provides an iframe URL and refuses cluster data without a key", () => {
    const bm = new BubblemapsAdapter({ mode: "iframe" });
    expect(bm.iframeUrl(VALID_MINT)).toContain(VALID_MINT);
    expect(() => bm.clusters(VALID_MINT)).toThrow(NotConfiguredError);
  });
});

describe("FOMO adapter manual resolution", () => {
  const fomo = new FomoAdapter();
  it("resolves an exact mint from content", () => {
    const r = fomo.importPost({ postUrl: "https://fomo/x", content: `buy ${VALID_MINT} now` });
    expect(r.naturalKey).toBe(VALID_MINT);
    expect(r.evidenceStatus).toBe("MANUAL");
  });
  it("throws when no mint is present", () => {
    expect(() => fomo.resolveMint({ postUrl: "u", content: "no address here" })).toThrow(FomoResolutionError);
  });
});

describe("idempotency key", () => {
  it("is stable for the same inputs", () => {
    const a = idempotencyKey("dexscreener", "/x", "mint", "2026-01-01T00:00:00Z");
    const b = idempotencyKey("dexscreener", "/x", "mint", "2026-01-01T00:00:00Z");
    expect(a).toBe(b);
  });
});
