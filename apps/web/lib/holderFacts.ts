/**
 * Who holds the coins a list is about to show (docs/RED_FLAGS.md, "Holders and wallets"): RugCheck's report of each coin, reduced to the few shares the rules need (lib/redFlags.ts holderRedFlags).
 *
 * RugCheck is free and keyless. Its report is 16 KB for the median coin and up to 2 MB for a coin with an airdrop-sized network of linked wallets; it answered all 98 coins on the live tabs on 2026-10-16
 * (median 56 ms, slowest 2.9 s). Its limit is a window of about a second that takes 15 requests (header x-rate-limit-limit: 15): six workers asking at once got 15 answers and then refusals, so the requests are
 * spaced (one start every 130 ms for the whole instance, 4 at a time). The site asks for itself, but spares it:
 *   - what was read is kept 30 minutes; a coin RugCheck does not know yet is asked again after 10 minutes, a call that failed after one;
 *   - a fact older than 30 minutes is still USED (up to 6 hours) while it is refreshed: a coin that was flagged does not slip back into a list because a refresh is late;
 *   - at most 300 calls a minute for the whole instance and 40 new coins per list; the rest is read on the next refresh (a coin that has not been read is KEPT: failing open);
 *   - a refusal (429) stops every call for 15 seconds, and for 5 minutes when three in a row are refused;
 *   - the facts are also kept in one small row of the database (lab_reports, kind "holders", about 70 bytes a coin), read once when an instance starts and written at most every 2 minutes,
 *     so that a cold start does not begin from nothing (a page opened after hours is judged at once, not after three minutes of reading).
 */
import { rugSnapshot, type RugRow } from "./lab/rugcheck";
import type { HolderState } from "./redFlags";

export type RugFetch = (mint: string) => Promise<{ status: "ok"; json: unknown } | { status: "miss" | "limited" | "error" }>;

/** [read at (epoch seconds), largest wallet, top ten, insider networks, creator, rugged 0/1, creator rugged before 0/1] */
export type Compact = [number, number | null, number | null, number | null, number | null, 0 | 1, 0 | 1];
export interface HolderPayload {
  v: 1;
  n: number;
  c: Record<string, Compact>;
}
export interface HolderStore {
  load(): Promise<unknown>;
  save(payload: HolderPayload): Promise<void>;
}
export interface HolderDeps {
  /** for tests: the exchange of RugCheck's report */
  fetchReport?: RugFetch;
  /** where the facts are kept between instances; null = nowhere (tests); the default is the site's database */
  store?: HolderStore | null;
  nowMs?: number;
  /** the most new reports one call may ask for (default 40) */
  budget?: number;
  /** how long one call waits for the reports it asked for (default 6 s) */
  deadlineMs?: number;
  /** the pause between two requests (default 130 ms, for the whole instance); tests pass 0 */
  gapMs?: number;
}

const FRESH_MS = 30 * 60_000;
const STALE_MS = 6 * 3_600_000;
const MISS_MS = 10 * 60_000;
const ERROR_MS = 60_000;
/** a refusal: stop for this long; after three in a row for the long one */
const BLOCK_SHORT_MS = 15_000;
const BLOCK_LONG_MS = 5 * 60_000;
const SAVE_EVERY_MS = 2 * 60_000;
const KEEP_MS = 12 * 3_600_000;
const PER_MINUTE = 300;
const CONCURRENCY = 4;
const GAP_MS = 130;

/**
 * The holder shares of a RugCheck snapshot (the lab and the Check read the report the same way). The largest wallet and the top ten count wallets only (`top1w`, `top10w`): the largest "holder" of most coins that
 * tripped "one wallet holds 20%" was the coin's own bonding curve or a pool (lib/solanaKeys.ts); a snapshot without those figures says nothing about wallets.
 */
export const holderStateOf = (r: RugRow): HolderState => ({
  top1: r.top1w ?? null,
  top10: r.top10w ?? null,
  insPct: r.insPct,
  creatorPct: r.creatorPct ?? null,
  rugged: r.rugged === true,
  creatorRugged: r.risks.some((x) => /creator history/i.test(x)),
});

const realFetch: RugFetch = async (mint) => {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { headers: { accept: "application/json", "user-agent": "Aureus-Gate/1.0" }, signal: AbortSignal.timeout(6_000) });
    if (res.status === 429) return { status: "limited" };
    if (res.status === 404 || res.status === 400) return { status: "miss" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", json: await res.json() };
  } catch {
    return { status: "error" };
  }
};

const dbStore: HolderStore = {
  async load() {
    const { getPool } = await import("@aureus/db");
    const r = await getPool().query(`SELECT payload FROM lab_reports WHERE kind = 'holders'`);
    return r.rows[0]?.payload ?? null;
  },
  async save(payload) {
    const { getPool } = await import("@aureus/db");
    await getPool().query(
      `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ('holders', now(), $1, $2::jsonb)
       ON CONFLICT (kind) DO UPDATE SET computed_at = now(), n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
      [payload.n, JSON.stringify(payload)],
    );
  },
};

interface Entry {
  /** when the state was read (ms); 0 when there is none */
  at: number;
  /** the earliest moment the coin is looked at again */
  next: number;
  state: HolderState | null;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
let blockedUntil = 0;
let refused = 0;
let nextSlot = 0;
let calls: number[] = [];
let active = 0;
const waiting: Array<() => void> = [];
let loading: Promise<void> | null = null;
let dirty = false;
let lastSave = 0;

/** For tests: forget everything that was kept. */
export function resetHolderCache(): void {
  cache.clear();
  inflight.clear();
  blockedUntil = 0;
  refused = 0;
  nextSlot = 0;
  calls = [];
  active = 0;
  waiting.length = 0;
  loading = null;
  dirty = false;
  lastSave = 0;
}

const acquire = () =>
  new Promise<void>((res) => {
    if (active < CONCURRENCY) {
      active++;
      res();
    } else
      waiting.push(() => {
        active++;
        res();
      });
  });
const release = () => {
  active--;
  waiting.shift()?.();
};
/** one call of the minute's allowance */
const spend = (now: number): boolean => {
  calls = calls.filter((t) => now - t < 60_000);
  if (calls.length >= PER_MINUTE) return false;
  calls.push(now);
  return true;
};
/** one request start every `gap` ms for the whole instance (RugCheck takes 15 in a window of about a second) */
async function pace(gap: number): Promise<void> {
  if (gap <= 0) return;
  const t = Date.now();
  const at = Math.max(t, nextSlot);
  nextSlot = at + gap;
  if (at > t) await new Promise<void>((res) => setTimeout(res, at - t));
}
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), ms)))]).finally(() => timer && clearTimeout(timer));
};
const r3 = (x: number | null): number | null => (x == null ? null : Math.round(x * 1000) / 1000);
const nn = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

async function readOne(mint: string, fetchReport: RugFetch, now: number, gap: number): Promise<void> {
  await acquire();
  try {
    if (now < blockedUntil) return;
    await pace(gap);
    if (now < blockedUntil) return;
    const r = await fetchReport(mint);
    const old = cache.get(mint);
    if (r.status !== "limited") refused = 0;
    if (r.status === "ok") {
      let snap: RugRow | null = null;
      try {
        snap = rugSnapshot(r.json, now / 1000);
      } catch {
        snap = null;
      }
      if (snap) {
        cache.set(mint, { at: now, next: now + FRESH_MS, state: holderStateOf(snap) });
        dirty = true;
      } else cache.set(mint, { at: old?.at ?? 0, next: now + MISS_MS, state: old?.state ?? null });
    } else if (r.status === "miss") cache.set(mint, { at: old?.at ?? 0, next: now + MISS_MS, state: old?.state ?? null });
    else if (r.status === "limited") {
      // requests already on their way when the first refusal came are refused too: count the refusals of separate tries (a try after the pause), not of one burst
      if (now >= blockedUntil) refused++;
      blockedUntil = Math.max(blockedUntil, now + (refused >= 3 ? BLOCK_LONG_MS : BLOCK_SHORT_MS));
    }
    else cache.set(mint, { at: old?.at ?? 0, next: now + ERROR_MS, state: old?.state ?? null });
  } finally {
    release();
  }
}

function ensureLoaded(store: HolderStore | null, now: number): Promise<void> {
  if (!store) return Promise.resolve();
  loading ??= (async () => {
    try {
      const p = (await withTimeout(store.load(), 3_000)) as { v?: number; c?: Record<string, unknown> } | null;
      if (p?.v !== 1 || !p.c || typeof p.c !== "object") return;
      for (const [mint, a] of Object.entries(p.c)) {
        if (cache.has(mint) || !Array.isArray(a) || a.length < 7) continue;
        const at = Number(a[0]) * 1000;
        if (!(at > 0) || now - at > STALE_MS) continue;
        cache.set(mint, { at, next: at + FRESH_MS, state: { top1: nn(a[1]), top10: nn(a[2]), insPct: nn(a[3]), creatorPct: nn(a[4]), rugged: a[5] === 1, creatorRugged: a[6] === 1 } });
      }
    } catch {
      // the database could not be read: start from nothing
    }
  })();
  return loading;
}

function snapshot(now: number): HolderPayload {
  const c: Record<string, Compact> = {};
  for (const [mint, e] of cache) {
    if (!e.state || now - e.at > STALE_MS) continue;
    const s = e.state;
    c[mint] = [Math.round(e.at / 1000), r3(s.top1), r3(s.top10), r3(s.insPct), r3(s.creatorPct), s.rugged ? 1 : 0, s.creatorRugged ? 1 : 0];
  }
  return { v: 1, n: Object.keys(c).length, c };
}

/**
 * mint -> who holds it, for the coins whose holder shares are known (read within the last 6 hours). A coin that is not in the answer has not been read (yet): the caller keeps it.
 * New coins are read first, then the oldest facts; what a call cannot read within its budget or its deadline is read by the next one.
 */
export async function fetchHolders(mints: string[], deps: HolderDeps = {}): Promise<Map<string, HolderState>> {
  // the off switch (HOLDER_FLAGS_LIVE=0, also the tests' default): nothing is asked and nothing is stored, unless a test hands in its own fake exchange
  const off = process.env.HOLDER_FLAGS_LIVE === "0";
  if (off && !deps.fetchReport) return new Map();
  const now = deps.nowMs ?? Date.now();
  const store = deps.store === undefined ? (off ? null : dbStore) : deps.store;
  const fetchReport = deps.fetchReport ?? realFetch;
  await ensureLoaded(store, now);

  const unique = [...new Set(mints.filter(Boolean))];
  const want: Array<{ mint: string; rank: number }> = [];
  const waits: Array<Promise<void>> = [];
  for (const m of unique) {
    const running = inflight.get(m);
    if (running) {
      waits.push(running);
      continue;
    }
    const e = cache.get(m);
    if (!e || now >= e.next) want.push({ mint: m, rank: e ? e.at : 0 });
  }
  want.sort((a, b) => a.rank - b.rank);
  if (now >= blockedUntil) {
    let asked = 0;
    const budget = deps.budget ?? 40;
    for (const w of want) {
      if (asked >= budget || !spend(now)) break;
      asked++;
      const p = readOne(w.mint, fetchReport, now, deps.gapMs ?? GAP_MS).finally(() => inflight.delete(w.mint));
      inflight.set(w.mint, p);
      waits.push(p);
    }
  }
  if (waits.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(waits), new Promise<void>((res) => (timer = setTimeout(res, deps.deadlineMs ?? 6_000)))]);
    if (timer) clearTimeout(timer);
  }

  const out = new Map<string, HolderState>();
  for (const m of unique) {
    const e = cache.get(m);
    if (e?.state && now - e.at <= STALE_MS) out.set(m, e.state);
  }
  if (store && dirty && now - lastSave >= SAVE_EVERY_MS) {
    lastSave = now;
    dirty = false;
    await withTimeout(store.save(snapshot(now)), 3_000).catch(() => {
      dirty = true;
    });
  }
  for (const [m, e] of cache) if (now - e.at > KEEP_MS && now >= e.next) cache.delete(m);
  return out;
}
