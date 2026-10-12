import { beforeEach, describe, expect, it } from "vitest";
import { buildGraduates, currentGraduates, resetGraduatesMemo } from "./graduates";
import type { FeedLog } from "./graduateFeed";

const NOW_S = Math.floor(Date.now() / 1000);
const mint = (c: string) => c.repeat(43) + "p";

const rd = (ageMin: number, p: number, liq: number, mcap = liq * 5): [number, number, number, number] => [NOW_S - 3600 + ageMin * 60, p, liq, mcap];
const last = (ageMin: number, p: number, liq: number, pc: number[], b: number, s: number): FeedLog["l"] => [...rd(ageMin, p, liq), pc, [b, b, b, b], [s, s, s, s]] as FeedLog["l"];

interface Row {
  mint: string;
  symbol: string | null;
  name: string | null;
  migrated_s: number;
  create_to_migrate_min: number | null;
  initial_buy_sol: number | null;
  mayhem: boolean | null;
  creator_launches_72h: number | null;
  note: string | null;
  via: "chain" | "stream";
  facts: FeedLog | null;
}
const row = (o: Partial<Row> & { mint: string }): Row => ({ symbol: o.mint.slice(0, 3).toUpperCase(), name: "Coin", migrated_s: NOW_S - 3600, create_to_migrate_min: 200, initial_buy_sol: null, mayhem: false, creator_launches_72h: null, note: null, via: "chain", facts: null, ...o });

function fakeDb(rows: Row[], extra: { pushed?: { payload: unknown; computed_at: string } | null; finished?: string | null; readings?: any[] } = {}) {
  return {
    query: async (text: string) => {
      if (/FROM pump_graduates g/.test(text)) return { rows };
      if (/kind = 'lanes'/.test(text)) return { rows: [] };
      if (/source = 'watch'/.test(text)) return { rows: extra.readings ?? [] };
      if (/source = 'rugcheck'/.test(text)) return { rows: [] };
      if (/FROM scan_lease WHERE name = 'grad-feed'/.test(text)) return { rows: extra.finished ? [{ last_finished: extra.finished }] : [] };
      if (/kind = 'gradlist'/.test(text)) return { rows: extra.pushed ? [extra.pushed] : [] };
      return { rows: [] };
    },
  };
}

describe("the Graduations list built from the chain feed's records", () => {
  const born = row({ mint: mint("A"), create_to_migrate_min: 0.1, initial_buy_sol: null, facts: { f: rd(1, 1, 30_000), l: last(5, 1.2, 28_000, [4, 4, 4, 4], 300, 200) } });
  const fast = row({ mint: mint("B"), create_to_migrate_min: 1.6, initial_buy_sol: 9.9, facts: { f: rd(1, 1, 8_000), k: rd(1, 1, 8_000), l: last(5, 2.5, 7_900, [180, 180, 180, 180], 49, 66), dm: 12 } });
  const drained = row({ mint: mint("C"), facts: { f: rd(1, 1, 40_000), k: rd(1, 1, 40_000), l: last(20, 0.05, 1_500, [-95, -95, -95, -95], 10, 400) } });
  const mayhem = row({ mint: mint("D"), mayhem: true, facts: { f: rd(1, 1, 20), l: last(5, 1, 25, [0, 0, 0, 0], 1, 0) } });
  const calm = row({ mint: mint("E"), create_to_migrate_min: 240, facts: { f: rd(1, 1, 22_000), k: rd(1, 1, 22_000), l: last(10, 1.3, 25_000, [6, 6, 6, 6], 120, 90) } });
  const finished = new Date(Date.now() - 2 * 60_000).toISOString();

  it("classifies like the stream's rows: born hidden (even when its creating transaction could not be read), drained and Mayhem hidden, the standing ones worth a look", async () => {
    const g = await buildGraduates(fakeDb([born, fast, drained, mayhem, calm], { finished }));
    const by = Object.fromEntries(g.candidates.map((c) => [c.mint[0], c]));
    expect(g.source).toBe("chain");
    expect(g.asOf).toBe(finished);
    expect(by.A).toMatchObject({ kind: "born", healthy: false, hiddenWhy: "born" });
    expect(by.C).toMatchObject({ kind: "organic", healthy: false, hiddenWhy: "drained", drained: true });
    expect(by.D).toMatchObject({ kind: "mayhem", healthy: false });
    expect(by.B).toMatchObject({ kind: "organic", healthy: true, hiddenWhy: null });
    expect(by.E).toMatchObject({ kind: "organic", healthy: true });
  });

  it("fills the card from the newest reading: liquidity, market cap, price change, trades, and what it did since the first reading", async () => {
    const g = await buildGraduates(fakeDb([fast], { finished }));
    const c = g.candidates[0]!;
    expect(c).toMatchObject({ liq: 7_900, mcap: 39_500, change1h: 180, change5m: 180, buys1h: 49, sells1h: 66, devBuySol: 9.9 });
    expect(c.sinceFirst).toBeCloseTo(2.5, 5);
    expect(c.peakMultiple).toBeCloseTo(2.5, 5);
    expect(c.readingAgeMin).toBeGreaterThanOrEqual(54);
  });

  it("warns about a graduation within 2 minutes and about a creator who has minted many tokens", async () => {
    const g = await buildGraduates(fakeDb([fast], { finished }));
    const flags = g.candidates[0]!.flags.join(" | ");
    expect(flags).toContain("graduated within 2 minutes of launch");
    expect(flags).toContain("serial creator (12 tokens minted)");
    expect(flags).toContain("creator bought 10 SOL at launch");
  });

  it("is local (no feed note) for the stream's own rows, and reads only 6 hours of the chain's", async () => {
    const stream = row({ mint: mint("S"), via: "stream", initial_buy_sol: 85, create_to_migrate_min: 0.2 });
    const g = await buildGraduates(fakeDb([stream]));
    expect(g.source).toBe("local");
    expect(g.asOf).toBeUndefined();
    expect(g.candidates[0]).toMatchObject({ kind: "born" });
  });
});

describe("which list the hosted site shows", () => {
  beforeEach(() => resetGraduatesMemo());
  const chainRows = [row({ mint: mint("B"), create_to_migrate_min: 1.6, initial_buy_sol: 9.9, facts: { f: rd(1, 1, 8_000), l: last(5, 1, 8_000, [1, 1, 1, 1], 5, 5) } })];
  const finished = new Date(Date.now() - 60_000).toISOString();
  const pushedAt = (min: number) => ({ payload: { at: "x", candidates: [{ mint: "PUSHED", symbol: "PUSH", ageMin: 5, flags: [] }], summary: [], lab: null, source: "laptop" }, computed_at: new Date(Date.now() - min * 60_000).toISOString() });

  it("shows the laptop's snapshot while the laptop is awake and pushing (it knows who bought what at launch)", async () => {
    const g = await currentGraduates(fakeDb(chainRows, { finished, pushed: pushedAt(3) }));
    expect(g.source).toBe("laptop");
    expect(g.candidates[0]!.mint).toBe("PUSHED");
  });
  it("shows the site's own chain feed once the laptop's snapshot is more than 20 minutes old", async () => {
    const g = await currentGraduates(fakeDb(chainRows, { finished, pushed: pushedAt(45) }));
    expect(g.source).toBe("chain");
    expect(g.candidates[0]!.mint).toBe(mint("B"));
  });
  it("shows the chain feed when the laptop never pushed anything", async () => {
    const g = await currentGraduates(fakeDb(chainRows, { finished, pushed: null }));
    expect(g.source).toBe("chain");
  });
  it("falls back to an old snapshot only when there is nothing else, as before", async () => {
    const g = await currentGraduates(fakeDb([], { pushed: pushedAt(600) }));
    expect(g.source).toBe("laptop");
  });
  it("on the laptop the stream's own rows win over everything", async () => {
    const stream = [row({ mint: mint("S"), via: "stream", create_to_migrate_min: 100 })];
    const g = await currentGraduates(fakeDb(stream, { pushed: pushedAt(1) }));
    expect(g.source).toBe("local");
  });
});
