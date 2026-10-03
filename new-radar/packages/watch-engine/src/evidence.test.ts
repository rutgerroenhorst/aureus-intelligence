import { describe, it, expect } from "vitest";
import { marketQuality, EVIDENCE, deriveStatus, entryReadyBlockers, tradableAtSize, exitPlan, potentialScore, POTENTIAL_BASE_RATE } from "./index.js";

/** Cases mirror real rows from the 438-pair study (docs/RESEARCH_COIN_STUDY.md). */
describe("evidence-based market quality", () => {
  const mq = (o = {}) => marketQuality({
    liquidityUsd: 39_000, volume24Usd: 676_000, fdvUsd: 249_000,
    change6h: 12, change24h: 140, change5m: 1, ...o,
  });

  it("a study RAN_HARD profile passes both gates", () => {
    const r = mq();
    expect(r.watchable).toBe(true);
    expect(r.entryQuality).toBe(true);
    expect(r.fdvToLiq).toBeCloseTo(6.4, 1);
  });

  it("DEAD profile (median vol24 $10, liq $3.8k) is not watchable", () => {
    const r = mq({ liquidityUsd: 3_800, volume24Usd: 10, change24h: 0, change6h: 0 });
    expect(r.watchable).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/untraded|exit not feasible/);
  });

  it("DUMPED profile (liq $7.1k) is watchable but never entry quality", () => {
    // This used to assert `watchable === false`, which only held because the old $15k
    // watch floor happened to exclude it. Depth is not the reason a dumped coin is a
    // bad trade, and leaning on the wrong gate hid that: at $7.1k against $181k of
    // volume the pool turns over 25x, which is churn, and THAT is what disqualifies it.
    const r = mq({ liquidityUsd: 7_100, volume24Usd: 181_000, change24h: -40 });
    expect(r.watchable).toBe(true);
    expect(r.entryQuality).toBe(false);
    expect(r.turnover!).toBeGreaterThan(EVIDENCE.MAX_TURNOVER_ENTRY);
    expect(r.reasons.join(" ")).toMatch(/churn, not accumulation/);
  });

  it("a genuinely dead pool is still excluded on depth", () => {
    expect(mq({ liquidityUsd: 3_200, volume24Usd: 400 }).watchable).toBe(false);
  });

  it("paper valuation (fdv 60x pool) is excluded outright", () => {
    const r = mq({ fdvUsd: 39_000 * 60 });
    expect(r.watchable).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/paper price/);
  });

  it("fdv 25x pool is watchable but NOT entry quality (the 44%→100% filter)", () => {
    const r = mq({ fdvUsd: 39_000 * 25 });
    expect(r.watchable).toBe(true);
    expect(r.entryQuality).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/× pool/);
  });

  it("spent move: up on the day, rolling over on 6h → blocked", () => {
    const r = mq({ change24h: 120, change6h: -5 });
    expect(r.spentMove).toBe(true);
    expect(r.entryQuality).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/move likely spent/);
  });

  it("thin turnover (volume below 2x pool) is not entry quality", () => {
    expect(mq({ liquidityUsd: 400_000, volume24Usd: 300_000 }).entryQuality).toBe(false);
  });

  // ── age-aware horizons ────────────────────────────────────────────────────
  // Real capture, ROCK, 24 minutes old: the feed reported h24 == h6 == h1 == +161%
  // and vol h24 == h6 == h1 == $500,404. Reading "6h trend intact" off that is
  // reading a copy of the 24-minute number, not six hours of history.
  describe("degenerate horizons on young pairs (ROCK, 24 min)", () => {
    const rock = (o = {}) => marketQuality({
      liquidityUsd: 41_120, volume24Usd: 500_404, fdvUsd: 161_837,
      change24h: 161, change6h: 161, change1h: 161, change5m: 25.3,
      ageMinutes: 24, ...o,
    });

    it("flags the long horizons as duplicates and says so", () => {
      const r = rock();
      expect(r.degenerateHorizons).toBe(true);
      expect(r.reasons.join(" ")).toMatch(/too young for 6h\/24h horizons/);
    });

    it("reads the trend from m5, the only horizon that exists at 24 min", () => {
      expect(rock().trendHorizon).toBe("m5");
    });

    it("a rolling-over 5m on a young pair is a spent move, not an intact trend", () => {
      const r = rock({ change5m: -4 });
      expect(r.spentMove).toBe(true);
      expect(r.entryQuality).toBe(false);
    });

    it("under 10 minutes there is no usable trend horizon at all", () => {
      const r = rock({ ageMinutes: 6 });
      expect(r.trendHorizon).toBe("none");
      expect(r.entryQuality).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/too young to establish any trend/);
      expect(r.spentMove).toBe(false); // absence of data is not evidence of a top
    });

    it("between 1h and 6h the trend comes from h1, not the duplicated h6", () => {
      const r = rock({ ageMinutes: 90, change1h: -8, change5m: -2 });
      expect(r.trendHorizon).toBe("h1");
      expect(r.entryQuality).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/h1 trend not intact/);
    });

    it("past 6h the horizons are real again and h6 is used", () => {
      const r = rock({ ageMinutes: 700, change6h: 12, change24h: 140 });
      expect(r.degenerateHorizons).toBe(false);
      expect(r.trendHorizon).toBe("h6");
    });

    it("without an age, identical h24/h6 alone is enough to distrust h6", () => {
      const r = marketQuality({
        liquidityUsd: 41_120, volume24Usd: 500_404, fdvUsd: 161_837,
        change24h: 161, change6h: 161, change1h: 161, change5m: 25.3,
      });
      expect(r.degenerateHorizons).toBe(true);
      expect(r.trendHorizon).toBe("h1");
    });
  });

  it("thresholds are the measured ones, not ad-hoc", () => {
    expect(EVIDENCE.MAX_FDV_TO_LIQUIDITY).toBe(20);
    // Both floors were re-derived from FORWARD outcomes rather than inherited from the
    // cross-sectional study. $20k is where the halving rate drops (46% -> 31%) and is
    // the same number discovery admits on; the old $30k left 20-30k coins discovered
    // but permanently un-enterable. $25k of volume separates dead from live — the old
    // $250k was excluding the band with the highest median peak.
    expect(EVIDENCE.MIN_LIQUIDITY_ENTRY_USD).toBe(6_000);
    expect(EVIDENCE.MIN_VOL24_ENTRY_USD).toBe(25_000);
  });

  it("the entry floor never sits above the discovery floor", () => {
    // Otherwise the pipeline admits coins it can never promote.
    const discoveryFloor = Number(process.env.DISCOVERY_MIN_LIQUIDITY_USD ?? 6_000);
    expect(EVIDENCE.MIN_LIQUIDITY_ENTRY_USD).toBeLessThanOrEqual(discoveryFloor);
  });

  it("a spent move cannot reach ENTRY_READY", () => {
    const base = { fund: "WATCHABLE" as const, coreSafety: "PASS" as const, prox: "ENTRY_CONFIRMED" as const,
      entryConfirmedRule: true, fresh: true, acceptableSlippage: true };
    expect(deriveStatus({ ...base })).toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, lateEntry: true })).not.toBe("ENTRY_READY");
  });
});

// ── ENTRY_READY gate diagnostics ─────────────────────────────────────────────
// ENTRY_READY has fired 0 times across 240 real candidates. Whether that is
// discipline or an unreachable gate is unanswerable unless the system reports
// which condition is binding — and that report is only trustworthy if it cannot
// disagree with the decision it describes.
describe("entryReadyBlockers mirrors deriveStatus exactly", () => {
  const ready = {
    fund: "WATCHABLE" as const, coreSafety: "PASS" as const, prox: "ENTRY_CONFIRMED" as const,
    entryConfirmedRule: true, fresh: true, acceptableSlippage: true,
    lateEntry: false, distributing: false,
  };

  it("an ENTRY_READY candidate has no blockers", () => {
    expect(deriveStatus(ready)).toBe("ENTRY_READY");
    expect(entryReadyBlockers(ready)).toEqual([]);
  });

  it("reports exactly the one condition that is false", () => {
    expect(entryReadyBlockers({ ...ready, coreSafety: "INCOMPLETE" })).toEqual(["core_safety_pass"]);
    expect(entryReadyBlockers({ ...ready, fresh: false })).toEqual(["data_fresh"]);
    expect(entryReadyBlockers({ ...ready, distributing: true })).toEqual(["not_distributing"]);
    expect(entryReadyBlockers({ ...ready, lateEntry: true })).toEqual(["not_late_chase"]);
    expect(entryReadyBlockers({ ...ready, acceptableSlippage: false })).toEqual(["slippage_ok"]);
    expect(entryReadyBlockers({ ...ready, entryConfirmedRule: false })).toEqual(["entry_rules_pass"]);
  });

  it("reports every failing condition, not just the first", () => {
    const b = entryReadyBlockers({ ...ready, coreSafety: "INCOMPLETE", fresh: false, distributing: true });
    expect(b).toContain("core_safety_pass");
    expect(b).toContain("data_fresh");
    expect(b).toContain("not_distributing");
    expect(b).toHaveLength(3);
  });

  // The binding property: empty blockers ⟺ ENTRY_READY. If these could ever
  // disagree, the diagnostic would explain a decision the engine did not make.
  it("blockers are empty if and only if the status is ENTRY_READY", () => {
    const bools = [true, false];
    let readyCount = 0;
    for (const entryConfirmedRule of bools)
      for (const fresh of bools)
        for (const acceptableSlippage of bools)
          for (const lateEntry of bools)
            for (const distributing of bools)
              for (const coreSafety of ["PASS", "INCOMPLETE"] as const)
                for (const prox of ["ENTRY_CONFIRMED", "BASE_FORMING"] as const) {
                  const s = { fund: "WATCHABLE" as const, coreSafety, prox,
                              entryConfirmedRule, fresh, acceptableSlippage, lateEntry, distributing };
                  const isReady = deriveStatus(s) === "ENTRY_READY";
                  expect(entryReadyBlockers(s).length === 0, JSON.stringify(s)).toBe(isReady);
                  if (isReady) readyCount++;
                }
    expect(readyCount).toBe(1); // exactly one of the 128 combinations is entry-ready
  });
});

// Splitting the conflated gate must change the REPORTED REASON without changing
// which candidates qualify. If the ENTRY_READY set moved, this would be a silent
// threshold change dressed up as a readability fix.
describe("splitting late-chase from the quality floor changes reasons, not outcomes", () => {
  const base = {
    fund: "WATCHABLE" as const, coreSafety: "PASS" as const, prox: "ENTRY_CONFIRMED" as const,
    entryConfirmedRule: true, fresh: true, acceptableSlippage: true, distributing: false,
  };

  it("each of the three now blocks independently, as the conflated flag did", () => {
    expect(deriveStatus({ ...base, lateEntry: true })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, spentMove: true })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, belowQualityFloor: true })).not.toBe("ENTRY_READY");
  });

  it("the OLD conflated flag and the NEW split flags accept exactly the same set", () => {
    for (const lateEntry of [true, false])
      for (const spentMove of [true, false])
        for (const belowQualityFloor of [true, false]) {
          const split = deriveStatus({ ...base, lateEntry, spentMove, belowQualityFloor });
          const conflated = deriveStatus({ ...base, lateEntry: lateEntry || spentMove || belowQualityFloor });
          expect(split, JSON.stringify({ lateEntry, spentMove, belowQualityFloor })).toBe(conflated);
        }
  });

  it("a thin pool is reported as a quality-floor miss, NOT as a late chase", () => {
    const b = entryReadyBlockers({ ...base, lateEntry: false, spentMove: false, belowQualityFloor: true });
    expect(b).toEqual(["meets_quality_floor"]);
    expect(b).not.toContain("not_late_chase");
  });

  it("a genuine top-of-range chase is still reported as a late chase", () => {
    expect(entryReadyBlockers({ ...base, lateEntry: true, belowQualityFloor: false }))
      .toEqual(["not_late_chase"]);
  });
});

// Forward-measured on our own candidates (h1). Extreme turnover is not enthusiasm —
// it is churn, and it performed as badly as a parked pool:
//   turnover <0.5x  n=53  median peak  0%
//   turnover 2-8x   n=94  median peak +15%
//   turnover >25x   n=35  median peak  0%   26% halved
describe("turnover is a band, not a floor", () => {
  const mq = (o = {}) => marketQuality({
    liquidityUsd: 40_000, volume24Usd: 400_000, fdvUsd: 200_000,
    change6h: 12, change24h: 60, change5m: 1, ...o,
  });

  it("a productive turnover passes", () => {
    expect(mq().turnover).toBeCloseTo(10, 0);
    expect(mq().entryQuality).toBe(true);
  });

  it("churn above the band fails, and says why", () => {
    // $40k pool doing $2m — 50x. Volume without accumulation.
    const r = mq({ volume24Usd: 2_000_000 });
    expect(r.entryQuality).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/churn, not accumulation/);
  });

  it("a parked pool still fails the floor", () => {
    expect(mq({ volume24Usd: 8_000 }).entryQuality).toBe(false);
  });

  it("the band matches what was measured, not a round number", () => {
    expect(EVIDENCE.MIN_TURNOVER_ENTRY).toBe(1);
    expect(EVIDENCE.MAX_TURNOVER_ENTRY).toBe(25);
  });
});

// A fixed "$250k of daily volume" floor answers the wrong question. The floor exists so
// the order does not move the market and can be exited — entirely a function of size.
describe("tradability scales with position size", () => {
  const pool = 20_000, vol = 60_000;

  it("a few euros trades comfortably in a $20k pool", () => {
    const r = tradableAtSize(10, pool, vol);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("$500 in the same pool is too large, and says which limit it broke", () => {
    const r = tradableAtSize(500, pool, vol);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/% of the pool/);
  });

  it("the same $500 is fine once the pool is deep enough", () => {
    expect(tradableAtSize(500, 400_000, 1_000_000).ok).toBe(true);
  });

  it("a deep pool with no volume still fails — depth is not an exit", () => {
    const r = tradableAtSize(500, 400_000, 20_000);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/thin exit/);
  });

  it("unknown depth or volume is never treated as tradeable", () => {
    expect(tradableAtSize(10, null, vol).ok).toBe(false);
    expect(tradableAtSize(10, pool, null).ok).toBe(false);
  });

  it("a zero or garbage size is not tradeable", () => {
    expect(tradableAtSize(0, pool, vol).ok).toBe(false);
    expect(tradableAtSize(NaN, pool, vol).ok).toBe(false);
  });

  // The volume floor now reflects what forward outcomes actually showed: $25k
  // separates dead from live, and $250k was excluding the best-performing band.
  it("the volume floor is the measured boundary, not the inherited one", () => {
    expect(EVIDENCE.MIN_VOL24_ENTRY_USD).toBe(25_000);
  });
});

// The half of the trade that did not exist. Forward data: median peak +9.2% at 15 min,
// +13.8% at 1h, +15.5% at both 6h and 24h — after an hour the median coin has stopped
// moving. Meanwhile 46% of the 8-20k band halves. Holding past the hour is how that
// happens.
describe("exit plan", () => {
  const base = { entryPrice: 100, invalidation: 90, target: 130 };

  it("takes most of the position into the first push", () => {
    const p = exitPlan(base);
    expect(p.steps[0]!.at).toBe(115);            // halfway to target
    expect(p.steps[0]!.takePct).toBe(0.6);
    expect(p.steps[1]!.at).toBe(130);
  });

  it("the stop moves to break-even once the first take is banked", () => {
    expect(exitPlan(base).stopAfterFirst).toBe(100);
  });

  it("closes on a clock, not on hope", () => {
    expect(exitPlan(base).timeStopMs).toBe(60 * 60_000);
  });

  it("tells a live position the one thing to do now", () => {
    expect(exitPlan({ ...base, price: 95 }).action).toBe("vasthouden");
    expect(exitPlan({ ...base, price: 118 }).action).toMatch(/neem 60%/);
    expect(exitPlan({ ...base, price: 131 }).action).toMatch(/doel bereikt/);
    expect(exitPlan({ ...base, price: 89 }).action).toMatch(/stop geraakt/);
  });

  it("the time stop fires even while the position is green but going nowhere", () => {
    const p = exitPlan({ ...base, price: 104, heldMs: 61 * 60_000 });
    expect(p.action).toMatch(/een uur voorbij/);
  });

  it("a hit stop outranks the time stop — the loss is closed first", () => {
    const p = exitPlan({ ...base, price: 88, heldMs: 90 * 60_000 });
    expect(p.action).toMatch(/stop geraakt/);
  });

  it("without a usable target it plans nothing rather than inventing levels", () => {
    expect(exitPlan({ entryPrice: 100, invalidation: 90, target: null }).steps).toEqual([]);
    expect(exitPlan({ entryPrice: 100, invalidation: 90, target: 95 }).steps).toEqual([]);
  });

  it("with no live price there is no action, only the plan", () => {
    expect(exitPlan(base).action).toBeNull();
  });
});

// Every weight here is a measured lift over the 20% base rate, not a chosen number.
// 1,045 graded outcomes at h1 across 509 coins, measured 2026-08-23.
describe("potential score is derived, not designed", () => {
  const best = { turnover: 8, fdvToLiq: 7, liquidityUsd: 50_000, marketCapUsd: 50_000,
                 proximity: "HIGHER_LOW_FORMING", activity: "REAL" };
  const worst = { turnover: 0.2, fdvToLiq: 1.2, liquidityUsd: 5_000, marketCapUsd: 10_000,
                  proximity: "NO_STRUCTURE", activity: "PARKED" };

  it("the best measured combination lands well above the base rate", () => {
    const r = potentialScore(best);
    expect(r.estimate!).toBeGreaterThan(POTENTIAL_BASE_RATE * 2);
    expect(r.hurts).toEqual([]);
  });

  it("the worst measured combination lands far below it", () => {
    const r = potentialScore(worst);
    expect(r.estimate!).toBeLessThan(POTENTIAL_BASE_RATE / 4);
    expect(r.helps).toEqual([]);
  });

  it("a parked pool is the single most damaging factor measured", () => {
    const r = potentialScore({ ...best, activity: "PARKED" });
    expect(r.hurts[0]!.factor).toBe("markt");
    expect(r.hurts[0]!.lift).toBeLessThan(0.2);
  });

  // Both contradict assumptions that sat in this codebase for weeks.
  it("valuation BELOW 2x pool hurts — it is not the safe end", () => {
    const r = potentialScore({ ...best, fdvToLiq: 1.5 });
    expect(r.hurts.some((h) => h.factor === "waardering")).toBe(true);
  });

  it("a higher low is the strongest positive factor measured", () => {
    const withHL = potentialScore(best).estimate!;
    const without = potentialScore({ ...best, proximity: "NO_STRUCTURE" }).estimate!;
    expect(withHL).toBeGreaterThan(without);
  });

  it("reports the sample size behind each factor rather than hiding it", () => {
    for (const f of potentialScore(best).helps) expect(f.n).toBeGreaterThan(0);
  });

  it("near-1 lifts are reported as neither help nor hurt", () => {
    // turnover >15x measured 0.97 — noise, and noise must not read as a reason.
    const r = potentialScore({ ...best, turnover: 20 });
    expect(r.helps.some((h) => h.factor === "turnover")).toBe(false);
    expect(r.hurts.some((h) => h.factor === "turnover")).toBe(false);
  });

  it("refuses to produce a number when most factors are unreadable", () => {
    const r = potentialScore({ turnover: null, fdvToLiq: null, liquidityUsd: null,
                               marketCapUsd: null, proximity: null, activity: null });
    expect(r.estimate).toBeNull();
    expect(r.unknown.length).toBeGreaterThanOrEqual(4);
  });

  it("scores the band that measured best higher than the band that measured worst", () => {
    // 25-75k over <25k, measured at h6 within the 150k ceiling (n=606). The smallest
    // band halves less often but its p90 peak is 95% against 135% — it is inert, not safe.
    const mid = potentialScore({ ...best, marketCapUsd: 48_000 }).estimate!;
    const tiny = potentialScore({ ...best, marketCapUsd: 12_000 }).estimate!;
    expect(mid).toBeGreaterThan(tiny);
  });

  it("never returns an estimate outside 0..1", () => {
    for (const c of [best, worst, { ...best, turnover: 1e9 }, { ...worst, liquidityUsd: 0 }]) {
      const e = potentialScore(c).estimate;
      if (e != null) { expect(e).toBeGreaterThanOrEqual(0); expect(e).toBeLessThanOrEqual(1); }
    }
  });
});
