import { describe, it, expect } from "vitest";
import { analyzeLiveness, analyzeDeployerSelling, type TxSample } from "./index.js";

const NOW = 1_800_000_000_000;
const poll = (n: number, buys: number, sells: number, vol: number): TxSample =>
  ({ atMs: NOW - (n * 10_000), buys, sells, volumeUsd: vol });

describe("market liveness — 'pretty chart, dead pool'", () => {
  it("liquidity pulled to ~zero → POOL_GONE even with a rising chart", () => {
    // Real pattern: textbook uptrend on the chart, liquidity $0.000002, dead ~20h.
    const r = analyzeLiveness([poll(3, 100, 50, 1000), poll(2, 101, 50, 1010), poll(1, 102, 51, 1020)], 0.000002, NOW);
    expect(r.liveness).toBe("POOL_GONE");
    expect(r.status).toBe("FAIL");
    expect(r.reason).toMatch(/pool is dead/);
  });

  it("identical trade counts across polls → FROZEN, despite fresh timestamps", () => {
    // Dexscreener keeps echoing the last values once trading stops.
    const frozen = [poll(4, 787, 505, 64800), poll(3, 787, 505, 64800), poll(2, 787, 505, 64800), poll(1, 787, 505, 64800)];
    const r = analyzeLiveness(frozen, 18500, NOW);
    expect(r.liveness).toBe("FROZEN");
    expect(r.status).toBe("FAIL");
    expect(r.distinctSamples).toBe(1);
  });

  it("genuinely active market → ACTIVE", () => {
    const live = [poll(4, 780, 500, 60000), poll(3, 787, 505, 64800), poll(2, 795, 511, 67000), poll(1, 802, 519, 69500)];
    const r = analyzeLiveness(live, 31200, NOW);
    expect(r.liveness).toBe("ACTIVE");
    expect(r.status).toBe("OK");
  });

  it("barely-changing market → THIN (not yet a hard fail)", () => {
    const thin = [poll(5, 100, 50, 900), poll(4, 100, 50, 900), poll(3, 100, 50, 900), poll(2, 101, 50, 905), poll(1, 101, 50, 905)];
    const r = analyzeLiveness(thin, 20000, NOW);
    expect(r.liveness).toBe("THIN");
    expect(r.status).toBe("INCOMPLETE");
  });

  it("too few samples → UNKNOWN, never a fabricated pass", () => {
    expect(analyzeLiveness([poll(1, 10, 5, 100)], 20000, NOW).liveness).toBe("UNKNOWN");
  });
});

describe("deployer selling — the launch-rug precursor", () => {
  it("deployer dumping their bag → FAIL with the exact drop", () => {
    // Creator went from 12% of supply to 3% → distributing into buyers.
    const r = analyzeDeployerSelling(0.12, 0.03, NOW);
    expect(r.status).toBe("FAIL");
    expect(r.sold).toBe(true);
    expect(r.dropPct).toBeCloseTo(0.75, 2);
    expect(r.reason).toMatch(/deployer sold/);
  });
  it("stable deployer holding → OK", () => {
    const r = analyzeDeployerSelling(0.08, 0.079, NOW);
    expect(r.status).toBe("OK"); expect(r.sold).toBe(false);
  });
  it("no prior balance → INCOMPLETE (never assume innocence or guilt)", () => {
    expect(analyzeDeployerSelling(null, 0.05, NOW).status).toBe("INCOMPLETE");
  });
  it("deployer that never held anything cannot be 'selling'", () => {
    const r = analyzeDeployerSelling(0, 0, NOW);
    expect(r.status).toBe("OK"); expect(r.sold).toBe(false);
  });
});
