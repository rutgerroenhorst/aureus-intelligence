import { describe, it, expect } from "vitest";
import { aucTest, bhFdr, bootMeanCi, calibration, fisherExact, fitLogistic, predictLogistic, quantileEdges, binOf, rng, wilson } from "./stats";
import { cleanObs, flagPhantoms, heldPeak, holdRule, firstHeldIndex, ladderNet, medianGap, type Obs } from "./paths";
import { buildOutcome, classify, forwardLabels } from "./outcomes";
import { primaryTag, siteFamily, tagsFor } from "./narrative";
import { buildFeatures, fmtValue } from "./features";
import { calibrate, pickTau } from "./reports/live";
import type { Row } from "./reports/common";

/** A path with one reading every `gap` seconds from the given prices; liquidity optional. */
const path = (prices: number[], gap = 300, liq?: number[]): Obs[] => prices.map((p, i) => ({ t: 1_000_000 + i * gap, p, liq: liq ? liq[i]! : 20_000 }));

describe("stats", () => {
  it("Wilson interval brackets the rate and handles zero", () => {
    const w = wilson(3, 100);
    expect(w.p).toBeCloseTo(0.03, 5);
    expect(w.lo).toBeLessThan(0.03);
    expect(w.hi).toBeGreaterThan(0.03);
    expect(wilson(0, 50).lo).toBe(0);
  });
  it("Fisher exact matches a textbook table", () => {
    // the classic tea-tasting table: p (two-sided) = 0.4857
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
    expect(fisherExact(9, 254, 12, 1123)).toBeLessThan(0.02);
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 5);
  });
  it("AUC is 1 for perfect separation, 0.5 for identical scores, handles ties and small samples", () => {
    expect(aucTest([5, 6, 7, 8, 9], [1, 2, 3, 4, 0.5])!.auc).toBe(1);
    expect(aucTest([1, 1, 1, 1, 1], [1, 1, 1, 1, 1])!.auc).toBe(0.5);
    expect(aucTest([1, 2], [1, 2, 3, 4, 5])).toBeNull();
    const r = aucTest(Array.from({ length: 60 }, (_, i) => i + 10), Array.from({ length: 200 }, (_, i) => i / 10));
    expect(r!.auc).toBeGreaterThan(0.9);
    expect(r!.p).toBeLessThan(0.001);
    expect(r!.lo).toBeLessThan(r!.auc);
  });
  it("BH false-discovery adjustment is monotone and never below the raw p", () => {
    const ps = [0.001, 0.04, 0.03, 0.5, 0.2];
    const q = bhFdr(ps);
    q.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(ps[i]!));
    expect(q[0]).toBeCloseTo(0.005, 5);
    expect(Math.max(...q)).toBeLessThanOrEqual(1);
  });
  it("logistic regression recovers a separating feature and is judged by predictions", () => {
    const rand = rng(7);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 600; i++) {
      const a = rand() * 4 - 2;
      const noise = rand() * 4 - 2;
      X.push([a, noise]);
      y.push(rand() < 1 / (1 + Math.exp(-(2 * a - 0.5))) ? 1 : 0);
    }
    const m = fitLogistic(X, y)!;
    expect(m.converged).toBe(true);
    expect(m.coef[0]!).toBeGreaterThan(Math.abs(m.coef[1]!) * 3);
    const preds = X.map((x) => predictLogistic(m, x));
    const t = aucTest(preds.filter((_, i) => y[i] === 1), preds.filter((_, i) => y[i] === 0))!;
    expect(t.auc).toBeGreaterThan(0.75);
    const cal = calibration(preds, y, 5);
    expect(cal.length).toBe(5);
    expect(cal[4]!.observed).toBeGreaterThan(cal[0]!.observed);
  });
  it("bins and bootstrap behave", () => {
    const e = quantileEdges([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(e.length).toBe(3);
    expect(binOf(0, e)).toBe(0);
    expect(binOf(100, e)).toBe(3);
    const ci = bootMeanCi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 200, 3);
    expect(ci.lo).toBeLessThan(5.5);
    expect(ci.hi).toBeGreaterThan(5.5);
  });
});

describe("phantom readings", () => {
  const liq = Array(12).fill(20_000);
  it("flags a liquidity-and-price spike that falls back, and leaves a real re-rating alone", () => {
    const prices = Array(12).fill(1);
    const spikeP = [...prices.slice(0, 8), 600, 600, 1, 1];
    const spikeL = [...liq.slice(0, 8), 27_000_000, 27_000_000, 20_000, 20_000];
    const flagged = flagPhantoms(path(spikeP, 20, spikeL));
    expect(flagged.slice(8, 10)).toEqual([true, true]);
    expect(flagged.filter(Boolean).length).toBe(2);
    // a coin that really re-rated and stays up is not a glitch
    const stayP = [...prices.slice(0, 8), 25, 26, 25, 27];
    const stayL = [...liq.slice(0, 8), 600_000, 610_000, 590_000, 600_000];
    expect(flagPhantoms(path(stayP, 20, stayL)).some(Boolean)).toBe(false);
    expect(cleanObs(path(spikeP, 20, spikeL)).phantoms).toBe(2);
  });
});

describe("held peaks and time to a multiple", () => {
  it("a one-reading spike is not held; a level seen for half an hour is", () => {
    const spike = path([1, 1, 1, 9, 1, 1, 1, 1, 1, 1, 1, 1], 300);
    expect(heldPeak(spike, holdRule(300))!.level).toBeLessThan(2);
    const held = path([1, 1, 1, 4, 4.2, 4.1, 4, 4.3, 4.1, 4, 3.9, 1], 300);
    expect(heldPeak(held, holdRule(300))!.level).toBeGreaterThanOrEqual(3.9);
    expect(firstHeldIndex(held, 3, holdRule(300))).toBe(3);
    expect(firstHeldIndex(spike, 3, holdRule(300))).toBeNull();
  });
  it("coins scanned every 20 minutes need two readings, not three", () => {
    const sparse = path([1, 1, 3, 3.1, 3, 1], 1200);
    expect(holdRule(medianGap(sparse)).minObs).toBe(2);
    expect(heldPeak(sparse, holdRule(medianGap(sparse)))!.level).toBeGreaterThanOrEqual(3);
  });
});

describe("exit ladder", () => {
  it("stops out at -50% and pays costs; sells a quarter at 2x", () => {
    const down = path([1, 0.9, 0.7, 0.45, 0.3], 300);
    expect(ladderNet(down, 0)!).toBeCloseTo(0.45 * 0.95, 3);
    const up = path([1, 1.5, 2.1, 2.2, 2.0, 1.6, 1.0], 300);
    const net = ladderNet(up, 0)!;
    // 25% fills at exactly 2x; the high is 2.2, so the 40% trailing stop sits at 1.32 and sells the rest at the 1.0 it is seen at
    expect(net).toBeCloseTo((0.25 * 2 + 0.75 * 1.0) * 0.95, 3);
  });
});

describe("outcome classes", () => {
  const ctx = { now: 1_000_000 + 200 * 3600, trackingEnded: false };
  const hours = (h: number, gap = 600) => Array.from({ length: Math.floor((h * 3600) / gap) + 1 }, (_, i) => i);
  it("calls a held 12x a moonshot and a 4x a runner, and never demotes them", () => {
    const rise = hours(30).map((i) => (i < 20 ? 1 : i < 120 ? 12 : 0.4));
    expect(classify(buildOutcome(path(rise, 600), ctx)!)).toBe("MOONSHOT");
    const run = hours(30).map((i) => (i < 20 ? 1 : i < 60 ? 4 : 0.3));
    expect(classify(buildOutcome(path(run, 600), ctx)!)).toBe("RUNNER");
  });
  it("tells a rug, a dump, a bleed and a zombie apart", () => {
    const n = hours(30).length;
    const rugP = hours(30).map((i) => (i < 10 ? 1 : 0.05));
    const rugL = hours(30).map((i) => (i < 10 ? 20_000 : 300));
    expect(classify(buildOutcome(path(rugP, 600, rugL), ctx)!)).toBe("RUG");
    const dump = hours(30).map((i) => (i < 12 ? 1 - i * 0.03 : 0.45 + (i % 3) * 0.01));
    expect(classify(buildOutcome(path(dump, 600), ctx)!)).toBe("DUMP");
    const bleed = Array.from({ length: n }, (_, i) => 1 - (0.7 * i) / n);
    expect(classify(buildOutcome(path(bleed, 600), ctx)!)).toBe("BLEED");
    const zombie = Array.from({ length: n }, (_, i) => 0.95 + 0.02 * Math.sin(i));
    expect(classify(buildOutcome(path(zombie, 600), ctx)!)).toBe("ZOMBIE");
    const young = hours(3).map(() => 1);
    expect(classify(buildOutcome(path(young, 600), ctx)!)).toBe("OPEN");
  });
  it("marks a coin the scanner stopped following as censored", () => {
    const p = path(hours(3).map(() => 1), 600);
    expect(buildOutcome(p, { now: 1_000_000 + 100 * 3600, trackingEnded: true })!.censored).toBe(true);
    expect(buildOutcome(p, { now: 1_000_000 + 100 * 3600, trackingEnded: false })!.censored).toBe(false);
  });
});

describe("forward labels", () => {
  const rule = holdRule(600);
  it("fills a label only once the whole window has been seen, so decided coins are not full of winners", () => {
    const jump = path([1, 1.1, 2.4, 2.5, 2.6, 2.5, 2.4, 2.5, 2.6, 2.5], 600);
    const f = forwardLabels(jump, 0, { rule })!;
    expect(f.peak72).toBeGreaterThan(2); // it did double ...
    expect(f.go2).toBeNull(); // ... but 72 h are not covered, and "no" could not be told apart from "not yet" for the others
    expect(f.collapse6).toBeNull(); // 6 h are not covered either (the path is 90 minutes)
    expect(f.ev).toBeNull();
  });
  it("decides every label once 72 hours have been seen", () => {
    const flat = Array.from({ length: 12 * 80 }, (_, i) => 1 + 0.01 * Math.sin(i));
    const a = forwardLabels(path(flat, 300), 0, { rule: holdRule(300) })!;
    expect(a.go2).toBe(false);
    expect(a.collapse6).toBe(false);
    expect(a.collapse24).toBe(false);
    expect(a.fwd24).not.toBeNull();
    expect(a.fwd72).not.toBeNull();
    expect(a.ev).not.toBeNull();
    const up = flat.map((p, i) => (i > 100 ? 2.6 : p));
    expect(forwardLabels(path(up, 300), 0, { rule: holdRule(300) })!.go2).toBe(true);
    const down = flat.map((p, i) => (i > 20 ? 0.3 : p));
    const d = forwardLabels(path(down, 300), 0, { rule: holdRule(300) })!;
    expect(d.collapse6).toBe(true);
    expect(d.collapse24).toBe(true);
    expect(d.ev!).toBeLessThan(0.6); // stopped out
  });
  it("applies the same meaning of 'held' to scanner readings and to hourly candles on one path", () => {
    const t0 = 1_000_000;
    const scans = Array.from({ length: 20 }, (_, i) => ({ t: t0 + i * 300, p: 1, liq: 20_000 }));
    const hourly = [3, 3.1, 3, 1].map((p, i) => ({ t: t0 + 20 * 300 + (i + 1) * 3600, p, liq: null as number | null }));
    const mixed = [...scans, ...hourly];
    const peak = heldPeak(mixed, "auto");
    expect(peak!.level).toBeGreaterThanOrEqual(3); // two hourly closes at 3x in a row count as held
    const spike = [...scans, { t: t0 + 20 * 300 + 3600, p: 9, liq: null as number | null }, { t: t0 + 20 * 300 + 7200, p: 1, liq: null as number | null }];
    expect(heldPeak(spike, "auto")!.level).toBeLessThan(2);
  });
});

describe("narrative tags", () => {
  it("tags AI, tools, animals and people from the name, and ecosystems from the site", () => {
    expect(tagsFor("Super Intelligence", "SI")).toContain("ai_agent");
    expect(tagsFor("Hot Bot", "HOTBOT")).toContain("product");
    expect(tagsFor("DarkSwap", "DARK")).toContain("tool");
    expect(tagsFor("Sitting Dog", "SDOG")).toContain("animal");
    expect(tagsFor("Trump coin", "TRUMP")).toContain("person");
    expect(tagsFor("Plain", "PLN")).toEqual([]);
    expect(tagsFor("Monark", "MONARK", "https://agents.clawpump.tech/marketplace")).toContain("eco:clawpump");
    expect(siteFamily("https://www.usepaid.app/t/x")).toBe("usepaid.app");
    expect(primaryTag(["tool", "ai_agent"])).toBe("ai_agent");
    expect(primaryTag([])).toBe("other");
  });
});

describe("features", () => {
  it("computes path and market features only from what was known at that moment", () => {
    const clean = path([1, 1.5, 2, 1.2, 1.0, 0.9], 3600, [10_000, 12_000, 15_000, 11_000, 9_000, 8_000]);
    const f = buildFeatures({
      tau: 5, clean, idx: 5, first: { t0: clean[0]!.t, p0: 1, liq0: 10_000 },
      pay: { pc_m5: -1, pc_h1: -10, pc_h6: -55, pc_h24: 20, v_m5: 10, v_h1: 800, v_h6: 40_000, v_h24: 50_000, b_m5: 1, s_m5: 2, b_h1: 30, s_h1: 70, b_h6: 600, s_h6: 800,
        b_h24: 900, s_h24: 1200, liq: 8_000, mcap: 40_000, fdv: 40_000, price: 0.9, boosts: 0, dex: "pumpswap", quote: "SOL", n_web: 1, n_soc: 0, site: null, created_ms: (clean[0]!.t - 3600) * 1000 },
      enr: { top1: 0.04, top5: 0.2, insider: 0.1, top10: 0.3 }, tags: ["ai_agent", "product"],
    });
    expect(f.mult).toBeCloseTo(0.9, 5);
    expect(f.run).toBeCloseTo(2, 5);
    expect(f.dd).toBeCloseTo(0.45, 5);
    expect(f.hrs_since_high).toBeCloseTo(3, 5);
    expect(f.liq_mcap).toBeCloseTo(0.2, 5);
    expect(f.liq_vs_first).toBeCloseTo(0.8, 5);
    expect(f.buy_share_h1).toBeCloseTo(0.3, 5);
    expect(f.vol_decay).toBeCloseTo(800 / (40_000 / 6), 5);
    expect(f.tag_ai).toBe(1);
    expect(f.tag_animal).toBe(0);
    expect(f.dex_pumpswap).toBe(1);
    expect(f.age_h).toBeCloseTo(5, 5);
    expect(f.pair_age_h).toBeCloseTo(6, 5);
    expect(f.organic_score).toBeNull();
    expect(fmtValue("pct", 12.4)).toBe("+12%");
    expect(fmtValue("usd", 12_300)).toBe("$12.3K");
    expect(fmtValue("frac", 0.456)).toBe("46%");
  });
});

describe("live odds", () => {
  it("only uses a checked moment close to the coin's age (within a factor of two)", () => {
    expect(pickTau(20, [6])).toBeNull(); // a 6 h model says nothing about a 20 h coin
    expect(pickTau(20, [12, 24])).toBe(24);
    expect(pickTau(0.4, [1])).toBeNull(); // too new
    expect(pickTau(2, [1, 3])).toBe(3);
    expect(pickTau(5, [])).toBeNull();
  });

  it("shows what happened to coins with the same score, never a number more extreme than anything observed", () => {
    // 300 coins; the feature 'liq' separates them: high liq -> goes. Labels are noisy so the extreme score is not a sure thing.
    const r = rng(11);
    const rows: Row[] = [];
    for (let i = 0; i < 300; i++) {
      const liq = 1000 + Math.floor(r() * 90000);
      const goes = r() < 0.05 + 0.5 * (liq / 91000);
      rows.push({ coin: {} as never, tau: 6, t0: i, f: { liq, mcap: liq * 4, trades_h1: 10 + Math.floor(r() * 400), vol_liq_h1: r() * 3 } as never, y: { go2: goes, collapse24: !goes } as never });
    }
    const c = calibrate(rows, "go2", 6);
    expect(c).not.toBeNull();
    expect(c!.bins.length).toBeGreaterThanOrEqual(4);
    const rates = c!.bins.map((b) => b.p);
    // the top group does better than the bottom one, and nothing exceeds what the data contains
    expect(rates[rates.length - 1]!).toBeGreaterThan(rates[0]!);
    expect(Math.max(...rates)).toBeLessThanOrEqual(1);
    expect(c!.bins.reduce((a, b) => a + b.n, 0)).toBeLessThanOrEqual(300);
  });
});
