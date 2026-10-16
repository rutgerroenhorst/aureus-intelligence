import { describe, expect, it } from "vitest";
import { bundleTtlMs, TTL_NORMAL_MS, TTL_OVER_MS, TTL_WELL_OVER_MS } from "./bundleTtl";

describe("how long the Radar bundle is kept", () => {
  it("a minute while the day's database allowance lasts", () => {
    expect(bundleTtlMs(0, 100)).toBe(TTL_NORMAL_MS);
    expect(bundleTtlMs(99.9, 100)).toBe(TTL_NORMAL_MS);
  });
  it("two minutes once it is used (it was five: the lists froze for the owner on 2026-10-16), five when a quarter over", () => {
    expect(bundleTtlMs(100, 100)).toBe(TTL_OVER_MS);
    expect(bundleTtlMs(124, 100)).toBe(TTL_OVER_MS);
    expect(bundleTtlMs(125, 100)).toBe(TTL_WELL_OVER_MS);
    expect(bundleTtlMs(300, 100)).toBe(TTL_WELL_OVER_MS);
  });
  it("no allowance configured (0) or a number that is not one means no brake", () => {
    expect(bundleTtlMs(500, 0)).toBe(TTL_NORMAL_MS);
    expect(bundleTtlMs(Number.NaN, 100)).toBe(TTL_NORMAL_MS);
  });
});
