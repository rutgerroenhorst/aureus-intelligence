import { describe, it, expect } from "vitest";
import { measureOutcome, buildOutcomeSchedules, type OutcomeSeriesPoint } from "./index.js";

const ANCHOR = 1_753_000_000_000;
const H = 60 * 60_000; // 1h in ms

describe("outcome measurement — anti-look-ahead", () => {
  const series: OutcomeSeriesPoint[] = [
    { atMs: ANCHOR, priceUsd: 1.0, liquidityUsd: 100_000 },
    { atMs: ANCHOR + 30 * 60_000, priceUsd: 2.0, liquidityUsd: 100_000 }, // within 1h → peak
    { atMs: ANCHOR + 2 * H, priceUsd: 10.0, liquidityUsd: 100_000 }, // BEYOND 1h horizon — must be ignored
  ];

  it("ignores data points beyond the horizon", () => {
    const m = measureOutcome({ anchorAtMs: ANCHOR, horizon: "h1", nowMs: ANCHOR + 3 * H, series });
    // MFE must reflect the 2.0 peak inside the window, NOT the 10.0 beyond it.
    expect(m.mfe).toBeCloseTo(1.0, 6); // 2.0/1.0 - 1
    expect(m.windowComplete).toBe(true);
  });

  it("marks window incomplete when now is before the horizon end", () => {
    const m = measureOutcome({ anchorAtMs: ANCHOR, horizon: "h1", nowMs: ANCHOR + 20 * 60_000, series });
    expect(m.windowComplete).toBe(false);
    // Only the anchor point is in-window so far.
    expect(m.mfe).toBeCloseTo(0, 6);
  });

  it("computes return, MFE and MAE within the window", () => {
    const s: OutcomeSeriesPoint[] = [
      { atMs: ANCHOR, priceUsd: 1.0 },
      { atMs: ANCHOR + 10 * 60_000, priceUsd: 1.5 },
      { atMs: ANCHOR + 40 * 60_000, priceUsd: 0.6 },
      { atMs: ANCHOR + 59 * 60_000, priceUsd: 0.8 },
    ];
    const m = measureOutcome({ anchorAtMs: ANCHOR, horizon: "h1", nowMs: ANCHOR + 2 * H, series: s });
    expect(m.ret).toBeCloseTo(-0.2, 6); // 0.8/1.0 - 1
    expect(m.mfe).toBeCloseTo(0.5, 6); // 1.5/1.0 - 1
    expect(m.mae).toBeCloseTo(-0.4, 6); // 0.6/1.0 - 1
  });

  it("labels a liquidity rug", () => {
    const s: OutcomeSeriesPoint[] = [
      { atMs: ANCHOR, priceUsd: 1.0, liquidityUsd: 100_000 },
      { atMs: ANCHOR + 30 * 60_000, priceUsd: 0.2, liquidityUsd: 2_000 },
    ];
    const m = measureOutcome({ anchorAtMs: ANCHOR, horizon: "h1", nowMs: ANCHOR + 2 * H, series: s });
    expect(m.liquidityLossPct).toBeGreaterThan(0.9);
    expect(m.rugLabel).toBe("rug");
  });
});

describe("outcome schedules", () => {
  it("builds all horizons except discovery", () => {
    const s = buildOutcomeSchedules(ANCHOR);
    expect(s.map((x) => x.horizon)).toEqual(["m15", "h1", "h6", "h24", "h72", "d7", "d30"]);
    expect(s[0]!.dueAtMs).toBe(ANCHOR + 15 * 60_000);
  });
});
