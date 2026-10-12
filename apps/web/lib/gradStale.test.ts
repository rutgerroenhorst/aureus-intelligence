import { describe, it, expect } from "vitest";
import { gradSnapshot, gradAgeText, CHAIN_STALE_AFTER_MIN, GRAD_STALE_AFTER_MIN } from "./gradStale";

const NOW = Date.parse("2026-10-11T21:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("how old the laptop's graduation snapshot is", () => {
  it("is not stale while the laptop keeps pushing (every 3 minutes)", () => {
    expect(gradSnapshot({ source: "laptop", asOf: ago(2) }, NOW)).toEqual({ ageMin: 2, stale: false, source: "laptop" });
    expect(gradSnapshot({ source: "laptop", asOf: ago(GRAD_STALE_AFTER_MIN) }, NOW).stale).toBe(false);
  });
  it("is stale once the stream has been silent for more than 20 minutes, however long", () => {
    expect(gradSnapshot({ source: "laptop", asOf: ago(21) }, NOW).stale).toBe(true);
    expect(gradSnapshot({ source: "laptop", asOf: ago(11.5 * 60) }, NOW)).toEqual({ ageMin: 690, stale: true, source: "laptop" });
  });
  it("holds the site's own chain feed to a shorter leash (it ticks every 3 minutes, no laptop involved)", () => {
    expect(gradSnapshot({ source: "chain", asOf: ago(4) }, NOW)).toEqual({ ageMin: 4, stale: false, source: "chain" });
    expect(gradSnapshot({ source: "chain", asOf: ago(CHAIN_STALE_AFTER_MIN) }, NOW).stale).toBe(false);
    expect(gradSnapshot({ source: "chain", asOf: ago(CHAIN_STALE_AFTER_MIN + 1) }, NOW).stale).toBe(true);
    expect(CHAIN_STALE_AFTER_MIN).toBeLessThan(GRAD_STALE_AFTER_MIN);
  });
  it("says nothing when the stream runs on this database (source local) or there is no time", () => {
    expect(gradSnapshot({ source: "local", asOf: ago(500) }, NOW)).toEqual({ ageMin: null, stale: false, source: null });
    expect(gradSnapshot({ source: "laptop" }, NOW)).toEqual({ ageMin: null, stale: false, source: null });
    expect(gradSnapshot({ source: "laptop", asOf: "nonsense" }, NOW)).toEqual({ ageMin: null, stale: false, source: null });
    expect(gradSnapshot(null, NOW)).toEqual({ ageMin: null, stale: false, source: null });
  });
  it("never goes negative when the clocks differ a little", () => {
    expect(gradSnapshot({ source: "laptop", asOf: ago(-3) }, NOW).ageMin).toBe(0);
  });
  it("writes minutes, hours and days", () => {
    expect(gradAgeText(12)).toBe("12 min");
    expect(gradAgeText(210)).toBe("3.5 h");
    expect(gradAgeText(3000)).toBe("2.1 d");
  });
});
