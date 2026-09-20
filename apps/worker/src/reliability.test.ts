import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./breaker.js";
import { mapLimit } from "./scan.js";
import { nextIntervalMs, workerConfig } from "./wconfig.js";

describe("circuit breaker", () => {
  it("opens after the threshold and half-opens after cooldown", () => {
    let now = 0;
    const b = new CircuitBreaker(3, 1000, () => now);
    expect(b.isOpen).toBe(false);
    b.recordFailure(); b.recordFailure();
    expect(b.isOpen).toBe(false); // 2 < 3
    b.recordFailure();
    expect(b.isOpen).toBe(true); // opened
    now = 500;
    expect(b.isOpen).toBe(true); // still within cooldown
    now = 1001;
    expect(b.isOpen).toBe(false); // half-open trial
    b.recordSuccess();
    expect(b.state).toBe("closed");
  });
});

describe("bounded concurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0, maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(items, 5, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(5);
  });
  it("processes every item once, preserving order", async () => {
    const out = await mapLimit([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });
});

describe("adaptive polling", () => {
  it("scans active states faster than dormant ones", () => {
    expect(nextIntervalMs("ENTRY_READY")).toBeLessThanOrEqual(nextIntervalMs("RESEARCHING"));
    expect(nextIntervalMs("ENTRY_WATCH")).toBeLessThanOrEqual(nextIntervalMs("RESEARCHING"));
    expect(nextIntervalMs("REJECTED")).toBeGreaterThan(workerConfig.researchingIntervalMs);
  });
});
