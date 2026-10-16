import { beforeEach, describe, expect, it } from "vitest";
import { fetchHolders, resetHolderCache, type HolderPayload, type HolderStore, type RugFetch } from "./holderFacts";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const MIN = 60_000;
const M = (n: number) => `Hold${n}`.padEnd(44, "x");

/** a RugCheck report of the shape the lab reads (lib/lab/rugcheck.ts): a pool account of 30%, two real wallets, the creator's balance in raw units */
const report = (over: Record<string, unknown> = {}) => ({
  score_normalised: 10, rugged: false, totalHolders: 900, totalMarketLiquidity: 50_000, graphInsidersDetected: 0, token: { supply: 1_000_000 }, mintAuthority: null, freezeAuthority: null, creatorBalance: 0,
  risks: [], markets: [{ pubkey: "POOL", liquidityA: "POOLTOKENACCOUNT", liquidityB: "POOLSOL", lp: { lpLockedPct: 100 } }], insiderNetworks: [],
  topHolders: [{ address: "POOLTOKENACCOUNT", owner: "POOL", pct: 30 }, { address: "W1", owner: "O1", pct: 5 }, { address: "W2", owner: "O2", pct: 4 }],
  ...over,
});
/** a fake RugCheck: answers per mint, counts the calls */
const rug = (answers: Record<string, ReturnType<typeof report> | "miss" | "limited" | "error"> = {}, fallback: ReturnType<typeof report> | "miss" | "limited" | "error" = report()) => {
  const asked: string[] = [];
  const fn: RugFetch = async (mint) => {
    asked.push(mint);
    const a = answers[mint] ?? fallback;
    return typeof a === "string" ? { status: a } : { status: "ok", json: a };
  };
  return Object.assign(fn, { asked });
};
const memoryStore = (initial: unknown = null) => {
  const saved: HolderPayload[] = [];
  const store: HolderStore = {
    load: async () => initial,
    save: async (p) => {
      saved.push(p);
    },
  };
  return { store, saved };
};

beforeEach(() => resetHolderCache());

describe("who holds a coin, from RugCheck's report", () => {
  it("reads the shares: the pool's own account is not a wallet, the creator's balance is a share of the supply", async () => {
    const f = rug({ [M(1)]: report({ creatorBalance: 250_000, insiderNetworks: [{ currentHolding: 600_000 }, { currentHolding: 390_000 }], risks: [{ name: "Creator history of rugged tokens" }], rugged: true }) });
    const out = await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 });
    const s = out.get(M(1))!;
    expect(s.top1).toBeCloseTo(0.05, 6);
    expect(s.top10).toBeCloseTo(0.09, 6);
    expect(s.insPct).toBeCloseTo(0.99, 6);
    expect(s.creatorPct).toBeCloseTo(0.25, 6);
    expect(s.rugged).toBe(true);
    expect(s.creatorRugged).toBe(true);
  });
  it("keeps what it read for 30 minutes, then reads again", async () => {
    const f = rug();
    await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 });
    await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 29 * MIN });
    expect(f.asked).toHaveLength(1);
    await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 31 * MIN });
    expect(f.asked).toHaveLength(2);
  });
  it("a fact that is late to refresh is still used (up to 6 hours), so a flagged coin does not slip back in", async () => {
    const flagged = report({ insiderNetworks: [{ currentHolding: 990_000 }] });
    const ok = rug({ [M(1)]: flagged });
    await fetchHolders([M(1)], { fetchReport: ok, store: null, gapMs: 0, nowMs: T0 });
    const down = rug({}, "error");
    const later = await fetchHolders([M(1)], { fetchReport: down, store: null, gapMs: 0, nowMs: T0 + 45 * MIN });
    expect(down.asked).toHaveLength(1);
    expect(later.get(M(1))?.insPct).toBeCloseTo(0.99, 6);
    const muchLater = await fetchHolders([M(1)], { fetchReport: down, store: null, gapMs: 0, nowMs: T0 + 7 * 3_600_000 });
    expect(muchLater.has(M(1))).toBe(false);
  });
  it("a coin RugCheck does not know yet is not in the answer (the gate keeps it) and is asked again after ten minutes", async () => {
    const f = rug({}, "miss");
    expect((await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 })).size).toBe(0);
    await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 5 * MIN });
    expect(f.asked).toHaveLength(1);
    await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 11 * MIN });
    expect(f.asked).toHaveLength(2);
  });
  it("a refusal (429) stops every call for 15 seconds, three refused tries in a row for five minutes; what is known is still used", async () => {
    await fetchHolders([M(1)], { fetchReport: rug(), store: null, gapMs: 0, nowMs: T0 });
    const limited = rug({}, "limited");
    const t = T0 + 40 * MIN;
    const a = await fetchHolders([M(1), M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t });
    expect(a.has(M(1))).toBe(true);
    const n1 = limited.asked.length;
    await fetchHolders([M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t + 5_000 });
    expect(limited.asked.length).toBe(n1);
    await fetchHolders([M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t + 16_000 });
    const n2 = limited.asked.length;
    expect(n2).toBeGreaterThan(n1);
    await fetchHolders([M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t + 32_000 });
    const n3 = limited.asked.length;
    expect(n3).toBeGreaterThan(n2);
    // the third refused try in a row: now it is five minutes
    await fetchHolders([M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t + 3 * MIN });
    expect(limited.asked.length).toBe(n3);
    await fetchHolders([M(2)], { fetchReport: limited, store: null, gapMs: 0, nowMs: t + 6 * MIN });
    expect(limited.asked.length).toBeGreaterThan(n3);
  });
  it("one refused burst counts once (the requests already on their way are refused too), and an answer in between starts the count again", async () => {
    const mints = [M(1), M(2), M(3), M(4)];
    const limited = rug({}, "limited");
    const t = T0;
    await fetchHolders(mints, { fetchReport: limited, store: null, gapMs: 0, nowMs: t });
    expect(limited.asked).toHaveLength(4);
    // 16 s later it is allowed again (a burst of four refusals did not count as three tries)
    const ok = rug();
    const out = await fetchHolders(mints, { fetchReport: ok, store: null, gapMs: 0, nowMs: t + 16_000 });
    expect(out.size).toBe(4);
  });
  it("a call reads new coins first and no more than its budget; the next call reads on", async () => {
    const mints = Array.from({ length: 10 }, (_, i) => M(i));
    const f = rug();
    const first = await fetchHolders(mints, { fetchReport: f, store: null, gapMs: 0, nowMs: T0, budget: 4 });
    expect(f.asked).toHaveLength(4);
    expect(first.size).toBe(4);
    const second = await fetchHolders(mints, { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 1000, budget: 4 });
    expect(f.asked).toHaveLength(8);
    expect(second.size).toBe(8);
    expect(new Set(f.asked).size).toBe(8);
  });
  it("never more than 300 calls a minute for the whole instance", async () => {
    const mints = Array.from({ length: 330 }, (_, i) => M(i));
    const f = rug();
    await fetchHolders(mints, { fetchReport: f, store: null, gapMs: 0, nowMs: T0, budget: 330 });
    expect(f.asked).toHaveLength(300);
    await fetchHolders(mints, { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 30_000, budget: 330 });
    expect(f.asked).toHaveLength(300);
    await fetchHolders(mints, { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 61_000, budget: 330 });
    expect(f.asked).toHaveLength(330);
  });
  it("requests start at least a gap apart and never more than four at a time (RugCheck takes 15 in a window of about a second)", async () => {
    const starts: number[] = [];
    let active = 0;
    let most = 0;
    const slow: RugFetch = async () => {
      starts.push(Date.now());
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return { status: "ok", json: report() };
    };
    const mints = Array.from({ length: 8 }, (_, i) => M(i));
    const out = await fetchHolders(mints, { fetchReport: slow, store: null, gapMs: 25, nowMs: T0, deadlineMs: 5_000 });
    expect(out.size).toBe(8);
    expect(most).toBeLessThanOrEqual(4);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20);
  });
  it("two lists asking for the same coin at the same moment make one request", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const slow: RugFetch = async () => {
      n++;
      await gate;
      return { status: "ok", json: report() };
    };
    const a = fetchHolders([M(1)], { fetchReport: slow, store: null, gapMs: 0, nowMs: T0 });
    const b = fetchHolders([M(1)], { fetchReport: slow, store: null, gapMs: 0, nowMs: T0 });
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(n).toBe(1);
    expect(x.has(M(1))).toBe(true);
    expect(y.has(M(1))).toBe(true);
  });
  it("a report that is slow is not waited for beyond the deadline; it lands in the memory anyway", async () => {
    const slow: RugFetch = async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { status: "ok", json: report() };
    };
    const a = await fetchHolders([M(1)], { fetchReport: slow, store: null, gapMs: 0, nowMs: T0, deadlineMs: 10 });
    expect(a.size).toBe(0);
    await new Promise((r) => setTimeout(r, 120));
    const f = rug({}, "error");
    const b = await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 + 1000 });
    expect(f.asked).toHaveLength(0);
    expect(b.has(M(1))).toBe(true);
  });
  it("something that is not a report counts as 'not known yet', and a report with a broken body does not throw", async () => {
    const f = rug({ [M(1)]: { error: "not found" } as never });
    expect((await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 })).size).toBe(0);
  });
  it("without a fake exchange the off switch means nothing is asked at all", async () => {
    expect((await fetchHolders([M(1)], { nowMs: T0 })).size).toBe(0);
  });
});

describe("a program's account is not a wallet (2026-10-16: the coin's own bonding curve held 20 to 25% of many graduates)", () => {
  // real addresses of one live coin: its bonding curve (owned by the pump.fun program), its PumpSwap pool, two wallets
  const CURVE = "5R5rRjwV4d3VB9xfSpNRvxxUeLMvcrAozGMAofQUuJKB";
  const POOL = "EsPEqy84fzxYapAhwX476q1fsWUEsrUeEzSYckuuxon9";
  const WALLET_A = "DgyKfPKr9QW6crYy3MaKhVBLRom1eZPnpu3LZLUW1AuQ";
  const WALLET_B = "Akjewo4wZopMSQ3fKkGkvLiGpfkcunrWk4nDb9MabpXz";
  it("the largest 'holder' is the bonding curve with 20.5% and a pool with 17%: the largest wallet is the 4.3% one", async () => {
    const f = rug({
      [M(1)]: report({
        markets: [], // the pool is not listed as a market (it often is not for the PumpSwap pool of a graduate that also trades elsewhere)
        topHolders: [
          { address: "CURVETOKENACCOUNT", owner: CURVE, pct: 20.5 },
          { address: "POOLTOKENACCOUNT", owner: POOL, pct: 17 },
          { address: "A", owner: WALLET_A, pct: 4.3 },
          { address: "B", owner: WALLET_B, pct: 3.7 },
        ],
      }),
    });
    const s = (await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 })).get(M(1))!;
    expect(s.top1).toBeCloseTo(0.043, 6);
    expect(s.top10).toBeCloseTo(0.08, 6);
  });
  it("a real wallet with 31% still counts", async () => {
    const f = rug({ [M(1)]: report({ topHolders: [{ address: "CURVETOKENACCOUNT", owner: CURVE, pct: 20.5 }, { address: "A", owner: WALLET_A, pct: 31 }] }) });
    const s = (await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 })).get(M(1))!;
    expect(s.top1).toBeCloseTo(0.31, 6);
  });
  it("a holder whose owner cannot be read as an address counts as a wallet (no holder is dropped on a doubt)", async () => {
    const f = rug({ [M(1)]: report({ topHolders: [{ address: "X", owner: "not-an-address", pct: 12 }] }) });
    expect((await fetchHolders([M(1)], { fetchReport: f, store: null, gapMs: 0, nowMs: T0 })).get(M(1))!.top1).toBeCloseTo(0.12, 6);
  });
});

describe("the facts survive a cold start (one small row in the database)", () => {
  it("saves what it read in a compact row, and a fresh instance starts from it without asking", async () => {
    const a = memoryStore();
    await fetchHolders([M(1), M(2)], { fetchReport: rug({ [M(2)]: report({ insiderNetworks: [{ currentHolding: 990_000 }] }) }), store: a.store, gapMs: 0, nowMs: T0 });
    expect(a.saved).toHaveLength(1);
    const row = a.saved[0]!;
    expect(row.v).toBe(1);
    expect(row.n).toBe(2);
    expect(row.c[M(2)]).toEqual([Math.round(T0 / 1000), 0.05, 0.09, 0.99, 0, 0, 0]);
    // the instance is gone; a new one loads the row and does not ask RugCheck
    resetHolderCache();
    const quiet = rug({}, "error");
    const b = await fetchHolders([M(1), M(2)], { fetchReport: quiet, store: memoryStore(JSON.parse(JSON.stringify(row))).store, gapMs: 0, nowMs: T0 + 10 * MIN });
    expect(quiet.asked).toHaveLength(0);
    expect(b.get(M(2))?.insPct).toBeCloseTo(0.99, 6);
  });
  it("writes at most every two minutes", async () => {
    const a = memoryStore();
    await fetchHolders([M(1)], { fetchReport: rug(), store: a.store, gapMs: 0, nowMs: T0 });
    await fetchHolders([M(2)], { fetchReport: rug(), store: a.store, gapMs: 0, nowMs: T0 + 30_000 });
    expect(a.saved).toHaveLength(1);
    await fetchHolders([M(3)], { fetchReport: rug(), store: a.store, gapMs: 0, nowMs: T0 + 3 * MIN });
    expect(a.saved).toHaveLength(2);
    expect(a.saved[1]!.n).toBe(3);
  });
  it("a store that cannot be read or written changes nothing", async () => {
    const broken: HolderStore = {
      load: async () => {
        throw new Error("db down");
      },
      save: async () => {
        throw new Error("db down");
      },
    };
    const out = await fetchHolders([M(1)], { fetchReport: rug(), store: broken, gapMs: 0, nowMs: T0 });
    expect(out.has(M(1))).toBe(true);
  });
  it("facts older than six hours in the row are not used", async () => {
    const old = { v: 1, n: 1, c: { [M(1)]: [Math.round((T0 - 7 * 3_600_000) / 1000), 0.5, 0.9, 0.9, 0, 0, 0] } };
    const f = rug({}, "miss");
    const out = await fetchHolders([M(1)], { fetchReport: f, store: memoryStore(old).store, gapMs: 0, nowMs: T0 });
    expect(out.size).toBe(0);
    expect(f.asked).toHaveLength(1);
  });
});
