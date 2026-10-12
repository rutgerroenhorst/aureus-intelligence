import { describe, it, expect } from "vitest";
import migrationTx from "./__fixtures__/pump-migration-tx.json";
import {
  MIGRATION_AUTHORITY,
  NOTHING_SEEN,
  PUMP_PROGRAM,
  creatorBuyOf,
  curveOf,
  foldReading,
  migrationOf,
  readingFromDex,
  readingFromJupiter,
  readingsOf,
  runFeed,
  type DueRow,
  type FeedDeps,
  type FeedLog,
  type FeedStore,
  type JupToken,
  type NewGraduate,
} from "./graduateFeed";

const MINT = "7rQWpUY5AxGPuncR1y2NtZv76gAm9DeHUaGRgq2tpump"; // NVIDIA, a real instant graduation of 2026-10-12 (the fixture is its migration transaction)

describe("reading a migration off the chain (a real transaction)", () => {
  it("finds the coin and the second it graduated", () => {
    const m = migrationOf(migrationTx)!;
    expect(m.mint).toBe(MINT);
    expect(new Date(m.t * 1000).toISOString()).toBe("2026-10-12T08:33:11.000Z");
  });
  it("finds the bonding curve: the owner of the coin's tokens before the migration", () => {
    expect(curveOf(migrationTx, MINT)!.startsWith("2QZSuV")).toBe(true);
    expect(curveOf(migrationTx, "someOtherMint")).toBeNull();
  });
  it("is not fooled: a failed transaction, another program, another authority, or a coin that is not in the balances", () => {
    const clone = () => JSON.parse(JSON.stringify(migrationTx));
    const failed = clone();
    failed.meta.err = { InstructionError: [1, "x"] };
    expect(migrationOf(failed)).toBeNull();
    const other = clone();
    other.transaction.message.instructions[1].programId = "SomeOtherProgram11111111111111111111111111111";
    expect(migrationOf(other)).toBeNull();
    const authority = clone();
    authority.transaction.message.instructions[1].accounts[1] = "NotTheMigrationAuthority1111111111111111111";
    expect(migrationOf(authority)).toBeNull();
    const nobalance = clone();
    nobalance.meta.postTokenBalances = [];
    nobalance.meta.preTokenBalances = [];
    expect(migrationOf(nobalance)).toBeNull();
    expect(migrationOf(null)).toBeNull();
    expect(PUMP_PROGRAM).toBe(migrationTx.transaction.message.instructions[1].programId);
    expect(MIGRATION_AUTHORITY).toBe(migrationTx.transaction.message.instructions[1].accounts[1]);
  });
});

describe("what the creator bought", () => {
  const create = (spentSol: number, mint = MINT) => ({
    meta: { err: null, fee: 5000, preBalances: [100e9], postBalances: [100e9 - spentSol * 1e9 - 5000] },
    transaction: { message: { instructions: [{ programId: PUMP_PROGRAM, accounts: [mint, "x"] }] } },
  });
  it("is what left the creator's wallet less the fee, the rent and pump.fun's 1%", () => {
    // measured on the real coins: 86.077 SOL out was an 85.005 SOL buy, 10.007 SOL out a 9.877 SOL buy
    expect(creatorBuyOf(create(86.077), MINT)).toBeCloseTo(85.2, 1);
    expect(creatorBuyOf(create(10.007), MINT)).toBeCloseTo(9.89, 1);
  });
  it("is null when this is not the coin's creation, or failed", () => {
    expect(creatorBuyOf(create(5, "AnotherMint"), MINT)).toBeNull();
    expect(creatorBuyOf({ ...create(5), meta: { err: "x", fee: 0, preBalances: [1], postBalances: [1] } }, MINT)).toBeNull();
    expect(creatorBuyOf({ meta: { err: null }, transaction: { message: { instructions: [] } } }, MINT)).toBeNull();
  });
  it("never goes below zero", () => {
    expect(creatorBuyOf(create(0.001), MINT)).toBe(0);
  });
});

describe("readings", () => {
  const jup: JupToken = {
    id: MINT,
    usdPrice: 0.0004444588847012148,
    liquidity: 27798.149146589963,
    mcap: 443274.9040081172,
    stats5m: { priceChange: 15.671237003931646, numBuys: 550, numSells: 423 },
    stats1h: { priceChange: 15.671237003931646, numBuys: 550, numSells: 423 },
    stats6h: { priceChange: 15.671237003931646, numBuys: 550, numSells: 423 },
    stats24h: { priceChange: 15.671237003931646, numBuys: 550, numSells: 423 },
  };
  it("turns Jupiter's token into the compact reading the tab reads", () => {
    expect(readingFromJupiter(jup, 1000)).toEqual([1000, 0.000444459, 27798, 443275, [15.7, 15.7, 15.7, 15.7], [550, 550, 550, 550], [423, 423, 423, 423]]);
  });
  it("does the same for DexScreener's pair, and leaves out what is missing", () => {
    expect(readingFromDex({ priceUsd: "0.0021", liquidity: { usd: 9000.4 }, fdv: 21000, priceChange: { m5: 1.25, h1: -3 }, txns: { m5: { buys: 4, sells: 2 }, h1: { buys: 30, sells: 20 } } }, 5)).toEqual([5, 0.0021, 9000, 21000, [1.3, -3, null, null], [4, 30, null, null], [2, 20, null, null]]);
  });
  it("folds a reading in: the first one is kept, the peak liquidity and highest price move up only, and 'one hour' is the first reading 55 to 100 minutes in", () => {
    const m = 10_000;
    const at = (min: number, p: number, liq: number) => [m + min * 60, p, liq, p * 1e9, [0, 0, 0, 0], [1, 1, 1, 1], [1, 1, 1, 1]] as Parameters<typeof foldReading>[1];
    let seen = { ...NOTHING_SEEN };
    const log: FeedLog = {};
    const apply = (min: number, p: number, liq: number, dm?: number | null) => {
      const patch = foldReading(seen, at(min, p, liq), m, dm);
      Object.assign(log, patch);
      seen = { peakLiq: log.k?.[2] ?? null, hiP: log.h?.[1] ?? null, hasF: log.f != null, hasO: log.o != null, n: log.n ?? 0 };
      return patch;
    };
    const first = apply(1, 1, 30_000, 7);
    expect(Object.keys(first).sort()).toEqual(["dm", "f", "h", "k", "l", "n"]);
    const second = apply(4, 0.8, 20_000);
    expect(Object.keys(second).sort()).toEqual(["l", "n"]); // lower price, lower liquidity, not the first, not at one hour: only the newest
    const third = apply(30, 1.5, 35_000);
    expect(Object.keys(third).sort()).toEqual(["h", "k", "l", "n"]);
    const hour = apply(60, 0.9, 12_000);
    expect(Object.keys(hour).sort()).toEqual(["l", "n", "o"]);
    expect(Object.keys(apply(70, 0.7, 11_000)).sort()).toEqual(["l", "n"]); // only the first reading in the window counts
    expect(log).toMatchObject({ n: 5, dm: 7 });
    expect(log.f![1]).toBe(1);
    expect(log.k![2]).toBe(35_000);
    expect(log.h![1]).toBe(1.5);
    expect(log.o![1]).toBe(0.9);
    expect(log.l![1]).toBe(0.7);
  });
  it("turns a record back into readings, oldest first, without the same moment twice", () => {
    const log: FeedLog = { f: [100, 1, 30_000, 5], k: [100, 1, 30_000, 5], h: [300, 2, 20_000, 9], o: [400, 1.1, 10_000, 4], l: [500, 0.9, 9_000, 3, [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]] };
    const r = readingsOf(log);
    expect(r.map((x) => x.t)).toEqual([100, 300, 400, 500]);
    expect(r[3]).toMatchObject({ pc: [1, 2, 3, 4], b: [5, 6, 7, 8], s: [9, 10, 11, 12] });
    expect(r[0]!.pc).toBeUndefined();
    expect(readingsOf(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------- a tick, with the chain, Jupiter and the database in memory

const NOW = 2_000_000;
const tx = (mint: string, t: number) => {
  const c = JSON.parse(JSON.stringify(migrationTx));
  c.blockTime = t;
  c.transaction.message.instructions[1].accounts[2] = mint;
  for (const b of [...c.meta.postTokenBalances, ...c.meta.preTokenBalances]) if (b.mint === MINT) b.mint = mint;
  return c;
};
const jt = (id: string, o: Partial<JupToken> = {}): JupToken => ({ id, name: `Coin ${id.slice(0, 3)}`, symbol: id.slice(0, 3).toUpperCase(), launchpad: "pump.fun", createdAt: new Date((NOW - 3000) * 1000).toISOString(), totalSupply: 1e9, usdPrice: 0.001, liquidity: 20_000, mcap: 100_000, dev: "DEV" + id.slice(0, 3), audit: { devMints: 3 }, ...o });

function setup(opts: { sig?: string | null; list?: Array<{ signature: string; err?: unknown }> | null; txs?: Record<string, any>; jup?: Record<string, JupToken>; dex?: Record<string, any>; known?: string[]; due?: DueRow[]; curve?: Record<string, Array<{ signature: string }> | null> } = {}) {
  const inserted: NewGraduate[] = [];
  const patches: Parameters<FeedStore["patch"]>[0] = [];
  const finished: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  let pruned = 0;
  const store: FeedStore = {
    claim: async () => true,
    state: async () => ({ sig: opts.sig ?? null }),
    known: async (m) => new Set(m.filter((x) => (opts.known ?? []).includes(x))),
    insert: async (g) => {
      inserted.push(g);
      return true;
    },
    due: async () => opts.due ?? [],
    patch: async (r) => void patches.push(...r),
    finish: async (r) => void finished.push(r),
    fail: async () => undefined,
    prune: async () => void pruned++,
  };
  const deps: FeedDeps = {
    sigs: async (until) => {
      calls.push(`sigs(${until})`);
      return opts.list === undefined ? [] : opts.list === null ? null : opts.list.map((s) => ({ err: null, ...s }));
    },
    tx: async (sig) => {
      calls.push(`tx(${sig})`);
      return opts.txs?.[sig] ?? null;
    },
    curveSigs: async (c) => {
      calls.push(`curve(${c.slice(0, 6)})`);
      return opts.curve?.[c] ?? null;
    },
    jupiter: async (m) => {
      calls.push(`jupiter(${m.length})`);
      return new Map(m.filter((x) => opts.jup?.[x]).map((x) => [x, opts.jup![x]!]));
    },
    dex: async (m) => {
      calls.push(`dex(${m.length})`);
      return new Map(m.filter((x) => opts.dex?.[x]).map((x) => [x, opts.dex![x]]));
    },
    now: () => NOW,
    log: () => undefined,
  };
  return { store, deps, inserted, patches, finished, calls, pruned: () => pruned };
}

describe("a tick of the feed", () => {
  const A = "AAAaaaAAAaaaAAAaaaAAAaaaAAAaaaAAAaaaAAAapump";
  const B = "BBBbbbBBBbbbBBBbbbBBBbbbBBBbbbBBBbbbBBBbpump";

  it("writes a new graduation with what Jupiter knows, and reads the creating transaction only for a graduation within 2 minutes of the launch", async () => {
    const quick = jt(A, { createdAt: new Date((NOW - 1000 - 30) * 1000).toISOString() }); // 30 seconds from launch to graduation
    const slow = jt(B, { createdAt: new Date((NOW - 2000 - 3 * 3600) * 1000).toISOString() });
    const curveOwner = curveOf(tx(A, NOW - 1000), A)!;
    const create = { meta: { err: null, fee: 5000, preBalances: [200e9], postBalances: [200e9 - 86.077e9 - 5000] }, transaction: { message: { instructions: [{ programId: PUMP_PROGRAM, accounts: [A] }] } } };
    const s = setup({
      list: [{ signature: "sigB" }, { signature: "sigA" }], // newest first, as the chain lists them
      txs: { sigA: tx(A, NOW - 1000), sigB: tx(B, NOW - 500), sigCreate: create },
      jup: { [A]: quick, [B]: slow },
      curve: { [curveOwner]: [{ signature: "sigLater" }, { signature: "sigCreate" }] },
    });
    s.deps.tx = ((orig) => async (sig: string) => (sig === "sigLater" ? null : orig(sig)))(s.deps.tx);
    const r = await runFeed(s.deps, s.store, 7);
    expect(r).toMatchObject({ ok: true, migrations: 2, added: 2, creatorBuys: 1, refreshed: 0 });
    const a = s.inserted.find((g) => g.mint === A)!;
    expect(a).toMatchObject({ migratedS: NOW - 1000, symbol: "AAA", mayhem: false, creator: "DEVAAA", signature: "sigA" });
    expect(a.createToMigrateMin).toBeCloseTo(0.5, 1);
    expect(a.devBuySol).toBeCloseTo(85.2, 1);
    expect(a.facts).toMatchObject({ n: 1, dm: 3 });
    const b = s.inserted.find((g) => g.mint === B)!;
    expect(b.devBuySol).toBeNull();
    expect(b.createToMigrateMin).toBeGreaterThan(170);
    expect(s.calls.filter((c) => c.startsWith("curve("))).toHaveLength(1); // not for the slow one
    expect(s.finished[0]).toMatchObject({ sig: "sigB" }); // the next tick starts after the newest migration read
  });

  it("counts a coin once when searchers sent its migration several times (the first copy is the graduation), and reads its creating transaction once", async () => {
    const quick = jt(A, { createdAt: new Date((NOW - 1000 - 10) * 1000).toISOString() });
    const curveOwner = curveOf(tx(A, NOW - 1000), A)!;
    const s = setup({
      list: [{ signature: "s3" }, { signature: "s2" }, { signature: "s1" }], // newest first: the same coin three times within two seconds
      txs: { s1: tx(A, NOW - 1000), s2: tx(A, NOW - 999), s3: tx(A, NOW - 998) },
      jup: { [A]: quick },
      curve: { [curveOwner]: null },
    });
    const r = await runFeed(s.deps, s.store, 1);
    expect(r).toMatchObject({ migrations: 1, added: 1 });
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({ migratedS: NOW - 1000, signature: "s1" });
    expect(s.calls.filter((c) => c.startsWith("curve("))).toHaveLength(1);
    expect(s.finished[0]).toMatchObject({ sig: "s3" }); // all three were read: the next tick starts after the newest
  });

  it("recognises Mayhem Mode by its 2 billion supply, and does not insert a coin it already has", async () => {
    const s = setup({ list: [{ signature: "s1" }, { signature: "s2" }], txs: { s1: tx(A, NOW - 100), s2: tx(B, NOW - 200) }, jup: { [A]: jt(A, { totalSupply: 2e9 }), [B]: jt(B) }, known: [B] });
    await runFeed(s.deps, s.store, 1);
    expect(s.inserted.map((g) => g.mint)).toEqual([A]);
    expect(s.inserted[0]!.mayhem).toBe(true);
  });

  it("falls back to DexScreener for a coin Jupiter does not know yet, and keeps the row without numbers when neither knows it", async () => {
    const s = setup({
      list: [{ signature: "s1" }, { signature: "s2" }],
      txs: { s1: tx(A, NOW - 100), s2: tx(B, NOW - 200) },
      jup: {},
      dex: { [A]: { baseToken: { address: A, name: "Dex name", symbol: "DEX" }, priceUsd: "0.002", liquidity: { usd: 15_000 }, marketCap: 50_000 } },
    });
    await runFeed(s.deps, s.store, 1);
    const a = s.inserted.find((g) => g.mint === A)!;
    expect(a).toMatchObject({ name: "Dex name", symbol: "DEX", createToMigrateMin: null });
    expect(a.facts?.l?.[2]).toBe(15_000);
    const b = s.inserted.find((g) => g.mint === B)!;
    expect(b).toMatchObject({ symbol: null, facts: null });
  });

  it("skips transactions that failed on chain, stops at one it cannot read (nothing after it is lost), and says where to start next time", async () => {
    const s = setup({
      sig: "old",
      list: [{ signature: "s3" }, { signature: "s2" }, { signature: "s1", err: { InstructionError: [0, "x"] } }],
      txs: { s2: tx(A, NOW - 200) /* s3 cannot be read */ },
      jup: { [A]: jt(A) },
    });
    const r = await runFeed(s.deps, s.store, 1);
    expect(r).toMatchObject({ migrations: 1, added: 1, unreadable: 1 });
    expect(s.finished[0]).toMatchObject({ sig: "s2" }); // s3 stays for the next tick
    expect(s.calls).toContain("sigs(old)");
  });

  it("still refreshes the coins that are due when the chain cannot be asked, and keeps where it was", async () => {
    const due: DueRow = { mint: A, migratedS: NOW - 600, peakLiq: 20_000, hiP: 0.001, hasF: true, hasO: false, n: 3, needsMeta: false };
    const s = setup({ sig: "keep", list: null, jup: { [A]: jt(A, { liquidity: 30_000, usdPrice: 0.002 }) }, due: [due] });
    const r = await runFeed(s.deps, s.store, 1);
    expect(r).toMatchObject({ ok: false, error: "the chain could not be asked", refreshed: 1 });
    expect(s.finished[0]).toMatchObject({ sig: "keep" });
    expect(Object.keys(s.patches[0]!.facts).sort()).toEqual(["dm", "h", "k", "l", "n"]);
    expect(s.patches[0]!.facts.n).toBe(4);
  });

  it("fills in the name of a coin that was first seen before Jupiter knew it", async () => {
    const due: DueRow = { mint: A, migratedS: NOW - 300, peakLiq: null, hiP: null, hasF: false, hasO: false, n: 0, needsMeta: true };
    const s = setup({ jup: { [A]: jt(A, { totalSupply: 2e9 }) }, due: [due] });
    await runFeed(s.deps, s.store, 1);
    expect(s.patches[0]!.meta).toMatchObject({ symbol: "AAA", mayhem: true, creator: "DEVAAA" });
    expect(s.patches[0]!.facts.f).toBeDefined();
  });

  it("does not read a coin twice in one tick (a new graduation that is also due), and prunes once an hour", async () => {
    const due: DueRow = { mint: A, migratedS: NOW - 100, peakLiq: null, hiP: null, hasF: false, hasO: false, n: 0, needsMeta: false };
    const s = setup({ list: [{ signature: "s1" }], txs: { s1: tx(A, NOW - 100) }, jup: { [A]: jt(A) }, due: [due] });
    const r = await runFeed(s.deps, s.store, 40); // 40 is a multiple of 20
    expect(r).toMatchObject({ added: 1, refreshed: 0 });
    expect(s.patches).toHaveLength(0);
    expect(s.pruned()).toBe(1);
    const t = setup({});
    await runFeed(t.deps, t.store, 41);
    expect(t.pruned()).toBe(0);
  });

  it("starts from the last few migrations when it has never run, and keeps its work to 30 transactions a tick", async () => {
    const list = Array.from({ length: 45 }, (_, i) => ({ signature: `s${45 - i}` })); // newest first
    const txs: Record<string, any> = {};
    for (let i = 1; i <= 45; i++) txs[`s${i}`] = tx(`M${String(i).padStart(2, "0")}${"x".repeat(38)}pump`, NOW - 1000 + i);
    const s = setup({ list, txs });
    const r = await runFeed(s.deps, s.store, 1);
    expect(r.migrations).toBe(30);
    expect(s.finished[0]).toMatchObject({ sig: "s30" });
    expect(s.calls[0]).toBe("sigs(null)");
  });
});
