import { describe, it, expect } from "vitest";

/**
 * Mirrors the systemic-fault heuristic in run.ts. The missing-partition outage
 * produced 25 identical "candidate error" lines every cycle and read as ordinary
 * per-item noise while nothing at all was being written. One coin failing is
 * normal; every coin failing the same way is an outage.
 */
function systemicFault(errors: string[], attempted: number): { systemic: boolean; reason: string; count: number } {
  if (attempted === 0 || errors.length === 0) return { systemic: false, reason: "", count: 0 };
  const tally = new Map<string, number>();
  for (const e of errors) {
    const key = e.replace(/"[^"]*"/g, '"…"').replace(/\b[0-9a-f-]{8,}\b/gi, "…").slice(0, 120);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let top = ""; let n = 0;
  for (const [k, v] of tally) if (v > n) { top = k; n = v; }
  return { systemic: n >= Math.max(3, Math.ceil(attempted * 0.5)), reason: top, count: n };
}

const PARTITION_ERR = 'no partition of relation "prices" found for row';

describe("systemic fault detection", () => {
  it("the real outage: every candidate failing identically is systemic", () => {
    const r = systemicFault(Array(25).fill(PARTITION_ERR), 25);
    expect(r.systemic).toBe(true);
    expect(r.count).toBe(25);
    expect(r.reason).toMatch(/no partition of relation/);
  });

  it("one bad coin among many is NOT an outage", () => {
    expect(systemicFault(["429 rate limited"], 25).systemic).toBe(false);
  });

  it("a few scattered failures stay below the bar", () => {
    expect(systemicFault(["a", "b", "timeout"], 25).systemic).toBe(false);
  });

  it("groups the same fault even when ids and quoted names differ", () => {
    const errs = [
      'no partition of relation "prices" found for row',
      'no partition of relation "liquidity_snapshots" found for row',
      'no partition of relation "transaction_aggregates" found for row',
      'no partition of relation "prices" found for row',
    ];
    const r = systemicFault(errs, 4);
    expect(r.systemic).toBe(true);
    expect(r.count).toBe(4); // quoted table names normalised away
  });

  it("a clean cycle reports no fault", () => {
    expect(systemicFault([], 25).systemic).toBe(false);
  });

  it("an empty cycle cannot be systemic (nothing was attempted)", () => {
    expect(systemicFault([PARTITION_ERR], 0).systemic).toBe(false);
  });

  it("needs at least 3 failures even on a tiny cycle, so a 1-of-1 blip is not an outage", () => {
    expect(systemicFault([PARTITION_ERR], 1).systemic).toBe(false);
    expect(systemicFault(Array(3).fill(PARTITION_ERR), 3).systemic).toBe(true);
  });
});

/**
 * Mirrors the cycle work-assembly in run.ts. Newly discovered mints used to be
 * appended after the due list and the whole thing truncated, so a backlog of 406
 * overdue candidates meant nothing new could ever enter the system — switching the
 * discovery source alone had no visible effect for exactly this reason.
 */
function assembleWork(discovered: string[], due: Array<{ mint: string; id: string }>, cap: number, share = 0.4) {
  const seen = new Set<string>();
  const slots = Math.min(discovered.length, Math.ceil(cap * share));
  const work: Array<{ mint: string; id: string | null }> = [];
  for (const m of discovered.slice(0, slots)) if (!seen.has(m)) { seen.add(m); work.push({ mint: m, id: null }); }
  for (const d of due) { if (work.length >= cap) break; if (!seen.has(d.mint)) { seen.add(d.mint); work.push({ mint: d.mint, id: d.id }); } }
  for (const m of discovered.slice(slots)) { if (work.length >= cap) break; if (!seen.has(m)) { seen.add(m); work.push({ mint: m, id: null }); } }
  return work.slice(0, cap);
}

describe("discovery must never be starved by the backlog", () => {
  const due = (n: number) => Array.from({ length: n }, (_, i) => ({ mint: `old${i}`, id: `id${i}` }));
  const fresh = (n: number) => Array.from({ length: n }, (_, i) => `new${i}`);

  it("the real case: 30 discovered against a 406-deep backlog still get in", () => {
    const w = assembleWork(fresh(30), due(25), 25);
    expect(w.filter((x) => x.id === null).length).toBe(10); // ceil(25 * 0.4)
  });

  it("a full backlog alone cannot fill the entire cycle", () => {
    const w = assembleWork(fresh(30), due(100), 25);
    expect(w.some((x) => x.id === null), "no discovery slot survived").toBe(true);
  });

  it("with nothing new, the backlog uses the whole cycle", () => {
    expect(assembleWork([], due(40), 25).length).toBe(25);
  });

  it("with no backlog, discovery uses the whole cycle", () => {
    expect(assembleWork(fresh(40), [], 25).length).toBe(25);
  });

  it("never exceeds the cycle cap", () => {
    expect(assembleWork(fresh(50), due(50), 25).length).toBe(25);
  });

  it("never processes the same mint twice in one cycle", () => {
    const w = assembleWork(["dup", "new1"], [{ mint: "dup", id: "x" }], 25);
    expect(w.filter((x) => x.mint === "dup").length).toBe(1);
  });
});
