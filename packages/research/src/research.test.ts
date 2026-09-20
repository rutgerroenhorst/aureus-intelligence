import { describe, it, expect } from "vitest";
import { computePaperTracking, computeResearchSummary, mean, median, winrate, welchSignificance, type SeriesPoint } from "./index.js";

const A = 1_753_000_000_000;
const min = (n: number) => n * 60_000;

describe("paper tracking", () => {
  const series: SeriesPoint[] = [
    { atMs: A, price: 1.0, liquidityUsd: 100_000, volumeUsd: 5_000 },
    { atMs: A + min(15), price: 1.5, liquidityUsd: 110_000, volumeUsd: 8_000 },
    { atMs: A + min(45), price: 0.7, liquidityUsd: 90_000, volumeUsd: 4_000 },
    { atMs: A + min(120), price: 3.0, liquidityUsd: 200_000, volumeUsd: 20_000 }, // 2h — beyond 1h
  ];

  it("computes return / drawdown / runup per horizon (anti-look-ahead)", () => {
    const pts = computePaperTracking(series, A, A + min(300));
    const h1 = pts.find((p) => p.horizon === "h1")!;
    // within 1h: points at 0,15,45m (prices 1.0,1.5,0.7). last=0.7 → return -0.3
    expect(h1.returnPct).toBeCloseTo(-0.3, 6);
    expect(h1.maxRunupPct).toBeCloseTo(0.5, 6);   // 1.5
    expect(h1.maxDrawdownPct).toBeCloseTo(-0.3, 6); // 0.7
    expect(h1.windowComplete).toBe(true);
    // the 3.0 spike at 2h must NOT leak into the 1h horizon
    expect(h1.maxRunupPct).toBeLessThan(2);
  });

  it("marks incomplete windows", () => {
    const pts = computePaperTracking(series, A, A + min(30));
    expect(pts.find((p) => p.horizon === "h1")!.windowComplete).toBe(false);
    expect(pts.find((p) => p.horizon === "d7")!.windowComplete).toBe(false);
  });
});

describe("research summary", () => {
  it("computes peak, drawdown, growth and detects a rug", () => {
    const series: SeriesPoint[] = [
      { atMs: A, price: 1.0, liquidityUsd: 100_000, volumeUsd: 10_000 },
      { atMs: A + min(30), price: 2.0, liquidityUsd: 120_000, volumeUsd: 30_000 },
      { atMs: A + min(60), price: 0.05, liquidityUsd: 3_000, volumeUsd: 1_000 }, // liq collapse
    ];
    const s = computeResearchSummary(series, A, A + min(120));
    expect(s.peakReturnPct).toBeCloseTo(1.0, 6); // 2.0
    expect(s.maxDrawdownPct).toBeCloseTo(-0.95, 6); // 0.05
    expect(s.isRug).toBe(true); // liq 3k < 10% of 100k
    expect(s.liquidityGrowthPct).toBeCloseTo(0.2, 6); // max 120k
  });

  it("does not flag a healthy token as a rug", () => {
    const series: SeriesPoint[] = [
      { atMs: A, price: 1.0, liquidityUsd: 100_000 },
      { atMs: A + min(60), price: 1.2, liquidityUsd: 130_000 },
    ];
    expect(computeResearchSummary(series, A, A + min(120)).isRug).toBe(false);
  });
});

describe("stats", () => {
  it("mean / median / winrate", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([1, 3, 2, 4])).toBe(2.5);
    expect(winrate([-0.1, 0.2, 0.5, -0.3])).toBe(0.5);
  });
  it("significance is honest about small samples", () => {
    const r = welchSignificance([0.1, 0.2], [-0.1, -0.2]);
    expect(r.significant).toBe(false);
    expect(r.note).toMatch(/insufficient/);
  });
  it("flags a clear large-sample difference", () => {
    const a = Array.from({ length: 30 }, () => 1.0);
    const b = Array.from({ length: 30 }, () => 0.0);
    const r = welchSignificance(a, b);
    // zero within-group variance → se 0 → t null → not significant (honest, avoids div-by-zero)
    expect(r.diff).toBe(1);
    const a2 = Array.from({ length: 30 }, (_, i) => 1.0 + (i % 3) * 0.01);
    const b2 = Array.from({ length: 30 }, (_, i) => 0.0 + (i % 3) * 0.01);
    expect(welchSignificance(a2, b2).significant).toBe(true);
  });
});
