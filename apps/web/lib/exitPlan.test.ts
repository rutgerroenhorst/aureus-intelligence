import { describe, it, expect } from "vitest";
import { planCheck } from "./exitPlan";

describe("example exit plan on a journal trade", () => {
  it("does nothing while the trade has not reached 2x and has not fallen to -50%", () => {
    const c = planCheck(1.6, 0.8, 1.2);
    expect(c.rungsHit).toEqual([]);
    expect(c.stopped).toBe(false);
    expect(c.planValue).toBeCloseTo(1.2); // still all held
    expect(c.holdValue).toBeCloseTo(1.2);
  });

  it("stops out at -50% before any sale", () => {
    const c = planCheck(1.3, 0.4, 0.45);
    expect(c.stopped).toBe(true);
    expect(c.planValue).toBeCloseTo(0.5);
  });

  it("sells a quarter at each rung and trails the rest 40% below the peak", () => {
    // peaked at 5.5x: rungs 2x and 5x were hit; trailing stop at 3.3x; now 4.0x so the rest is still held
    const up = planCheck(5.5, 0.9, 4.0);
    expect(up.rungsHit).toEqual([2, 5]);
    expect(up.locked).toBeCloseTo(0.25 * 2 + 0.25 * 5);
    expect(up.remaining).toBeCloseTo(0.5);
    expect(up.stopLevel).toBeCloseTo(3.3);
    expect(up.stopped).toBe(false);
    expect(up.planValue).toBeCloseTo(1.75 + 0.5 * 4.0);
    // the same trade after it fell to 2.1x: the trailing stop (3.3x) was passed, the rest is sold at its level, holding is worth less
    const down = planCheck(5.5, 0.9, 2.1);
    expect(down.stopped).toBe(true);
    expect(down.planValue).toBeCloseTo(1.75 + 0.5 * 3.3);
    expect(down.planValue).toBeGreaterThan(down.holdValue);
  });

  it("never lets the plan beat the peak it could have sold at", () => {
    const c = planCheck(12, 1, 11.5);
    expect(c.rungsHit).toEqual([2, 5, 10]);
    expect(c.planValue).toBeLessThanOrEqual(12);
  });
});
