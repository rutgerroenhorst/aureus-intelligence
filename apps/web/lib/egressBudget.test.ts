import { describe, expect, it } from "vitest";
import { EGRESS_DAY_MAX_MB, EGRESS_DAY_MIN_MB, EGRESS_USE_MB, rollingUse, todaysBudgetMb, utcDay } from "./egressBudget";

const MB = 1048576;
const NOW = Date.UTC(2026, 9, 16, 16, 40); // 2026-10-16 16:40 UTC
const row = (day: string, mb: number, kind: "egress" | "egress-estimate" = "egress") => ({ name: `usage:${kind}:${day}`, bytes: mb * MB });

describe("the rolling month: 31 days together may add up to 4,500 MB, a day gets what the 30 before it left (max 200, min 40)", () => {
  it("counts the days before today and today separately, from every kind of row (counted days and estimates), and nothing else", () => {
    const u = rollingUse(
      [
        row("2026-10-15", 114),
        row("2026-10-14", 117),
        row("2026-10-13", 128),
        row("2026-10-13", 415, "egress-estimate"),
        row("2026-10-16", 106),
        { name: "usage:2026-10-16", bytes: 139_009 * MB }, // the CPU row of the same day must not be read as data
        { name: "cloud-scan", bytes: 5 * MB },
      ],
      NOW,
    );
    expect(u.todayMb).toBeCloseTo(106, 6);
    expect(u.prevMb).toBeCloseTo(114 + 117 + 128 + 415, 6);
    expect(u.byDay["2026-10-13"]).toBeCloseTo(543, 6);
  });
  it("the window is 31 days: today and the 30 before it; older days drop out", () => {
    expect(utcDay(NOW)).toBe("2026-10-16");
    const rows = [row("2026-09-16", 900), row("2026-09-15", 900), row("2026-10-01", 50)];
    // 31 days ending 2026-10-16 begin on 2026-09-16
    expect(rollingUse(rows, NOW).prevMb).toBeCloseTo(950, 6);
    expect(rollingUse([row("2026-09-15", 900)], NOW).prevMb).toBe(0);
  });
  it("nothing used before: a day gets the most (200 MB), never the whole month", () => {
    expect(todaysBudgetMb(0)).toBe(EGRESS_DAY_MAX_MB);
  });
  it("what the earlier days left is carried: a quiet month leaves the allowance at the most, a busy one lowers it", () => {
    expect(todaysBudgetMb(1_000)).toBe(200);
    expect(todaysBudgetMb(4_000)).toBe(200);
    expect(todaysBudgetMb(EGRESS_USE_MB - 150)).toBe(150);
    expect(todaysBudgetMb(EGRESS_USE_MB - 60)).toBe(60);
  });
  it("a month that is used up still lets the site breathe (40 MB), also when the days before went over", () => {
    expect(todaysBudgetMb(EGRESS_USE_MB)).toBe(EGRESS_DAY_MIN_MB);
    expect(todaysBudgetMb(EGRESS_USE_MB + 700)).toBe(EGRESS_DAY_MIN_MB);
    expect(todaysBudgetMb(Number.NaN)).toBe(EGRESS_DAY_MAX_MB);
  });
  it("the owner's case on 2026-10-16: five metered days, three days before the meter, the backups of 10-13 (estimates): 1,406 MB used, so the allowance is the most, 200 MB", () => {
    const rows = [
      row("2026-10-11", 108), row("2026-10-12", 133), row("2026-10-13", 128), row("2026-10-14", 117), row("2026-10-15", 114),
      row("2026-10-08", 130, "egress-estimate"), row("2026-10-09", 130, "egress-estimate"), row("2026-10-10", 130, "egress-estimate"), row("2026-10-13", 415, "egress-estimate"),
      row("2026-10-16", 106),
    ];
    const u = rollingUse(rows, NOW);
    expect(Math.round(u.prevMb)).toBe(108 + 133 + 128 + 117 + 114 + 390 + 415);
    expect(todaysBudgetMb(u.prevMb)).toBe(200);
  });
  it("no 31 days can add up to more than the window plus one day's overshoot: using the full allowance every day ends at the window", () => {
    // simulate: every day uses exactly its allowance, starting with 1,400 MB already in the window
    const days: number[] = Array.from({ length: 30 }, () => 1_400 / 30);
    let worst = 0;
    for (let d = 0; d < 200; d++) {
      const prev = days.slice(-30).reduce((a, x) => a + x, 0);
      const today = todaysBudgetMb(prev);
      days.push(today);
      worst = Math.max(worst, days.slice(-31).reduce((a, x) => a + x, 0));
    }
    expect(worst).toBeLessThanOrEqual(EGRESS_USE_MB + EGRESS_DAY_MIN_MB);
  });
});
