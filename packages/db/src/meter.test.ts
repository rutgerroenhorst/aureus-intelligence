import { beforeEach, describe, expect, it } from "vitest";
import { flushUsage, meterAdd, meterDue, meterPending, meterReset, USAGE_FLUSH_AT_BYTES, USAGE_FLUSH_EVERY_MS } from "./index.js";

/** A database that only remembers what it was asked. */
const fakeDb = (fail = false) => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (fail) throw new Error("connection terminated");
      return { rows: [] };
    },
  };
};

describe("the usage meter", () => {
  beforeEach(() => meterReset());

  it("counts bytes, ignores nonsense, and says when it is time to write down", () => {
    expect(meterPending()).toBe(0);
    meterAdd(1000);
    meterAdd(-5);
    meterAdd(0);
    expect(meterPending()).toBe(1000);
    expect(meterDue(Date.now())).toBe(false);
    // a quiet process writes down after a while, a busy one after a lot
    expect(meterDue(Date.now() + USAGE_FLUSH_EVERY_MS + 1)).toBe(true);
    meterAdd(USAGE_FLUSH_AT_BYTES);
    expect(meterDue(Date.now())).toBe(true);
  });

  it("adds what was counted to today's row, once, and starts again from zero", async () => {
    const db = fakeDb();
    meterAdd(123_456);
    expect(await flushUsage(db)).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.params).toEqual([123_456]);
    expect(db.calls[0]!.text).toContain("usage:egress:");
    expect(meterPending()).toBe(0);
    expect(await flushUsage(db)).toBe(false);
    expect(db.calls).toHaveLength(1);
  });

  it("keeps the count when the database cannot be reached, and writes it down next time", async () => {
    const broken = fakeDb(true);
    meterAdd(5_000);
    expect(await flushUsage(broken)).toBe(false);
    expect(meterPending()).toBe(5_000);
    meterAdd(1_000);
    const ok = fakeDb();
    expect(await flushUsage(ok)).toBe(true);
    expect(ok.calls[0]!.params).toEqual([6_000]);
  });
});
