/**
 * Which networks are hot right now, and what is trending on each, from free sources only.
 *
 *   GeckoTerminal   the 20 trending pools of each network (price changes, volume, liquidity, age, trades)
 *   DefiLlama       how much each network's exchanges traded, and how that changed against the week before
 *
 * "Hot" is a description of today, not a forecast. A network ranks high when many of its trending coins (blue chips left out) are
 * already moving, when many of them are new, when its trending coins have gained over the day, and when its exchange volume has
 * held up better than the others' over the week. Each of the four is turned into a rank among the networks and the ranks are averaged,
 * so no single scale (a $2B network against a $30M one) decides it.
 */

import { CHAINS, type ChainInfo } from "./chains";

export interface HotPool {
  chain: string;
  /** the coin's token address (mint on Solana) */
  address: string;
  /** the pool's address, what DexScreener links to */
  pair: string;
  symbol: string;
  name: string;
  dex: string | null;
  ageH: number | null;
  mcap: number | null;
  liq: number | null;
  vol24: number | null;
  vol1: number | null;
  ch1: number | null;
  ch6: number | null;
  ch24: number | null;
  buys1: number | null;
  sells1: number | null;
  /** position in the network's trending list (1 = most trending) */
  rank: number;
}

export interface ChainStats {
  /** trending pools kept after leaving out blue chips and dust */
  n: number;
  up20h6: number;
  up50h24: number;
  young: number;
  medH6: number | null;
  medH24: number | null;
  vol24: number;
  vol1: number;
  /** DEX volume over the last day and how it moved (percent) */
  llama: { vol24: number; change1d: number | null; change7d: number | null } | null;
  /** the network's list could not be read this time */
  error?: string;
}

export interface HotChain {
  id: string;
  label: string;
  fomo: boolean;
  rank: number;
  /** 0 to 100, relative to the other networks in this ranking */
  heat: number;
  stats: ChainStats;
  why: string;
}

export interface HotReport {
  at: string;
  chains: HotChain[];
  pools: Record<string, HotPool[]>;
  note: string;
}

const MAJORS = new Set(["WETH", "ETH", "WBTC", "BTC", "CBBTC", "TBTC", "USDC", "USDT", "DAI", "USDE", "USDS", "USD1", "FDUSD", "BUSD", "USDB", "USDBC", "EURC", "PYUSD", "WBNB", "BNB", "SOL", "WSOL", "STETH", "WSTETH", "CBETH", "WEETH", "WMON", "MON", "JITOSOL", "MSOL"]);
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/** A size that is really known: GeckoTerminal sometimes sends 0 for a market cap it does not have. */
const known = (x: unknown): number | null => {
  const n = num(x);
  return n != null && n > 0 ? n : null;
};

/** One GeckoTerminal pools response (with include=base_token,dex) turned into pools, in the order GeckoTerminal ranked them. */
export function parsePools(chain: string, body: any, nowMs = Date.now()): HotPool[] {
  const inc = new Map<string, any>();
  for (const i of body?.included ?? []) inc.set(i.id, i);
  const out: HotPool[] = [];
  (body?.data ?? []).forEach((p: any, idx: number) => {
    const a = p?.attributes ?? {};
    const baseId = p?.relationships?.base_token?.data?.id as string | undefined;
    const tok = baseId ? inc.get(baseId)?.attributes : null;
    const address = (tok?.address as string | undefined) ?? (baseId ? baseId.replace(/^[^_]+_/, "") : "");
    if (!address || !a.address) return;
    const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
    out.push({
      chain,
      address,
      pair: a.address,
      symbol: String(tok?.symbol ?? a.name?.split(" / ")[0] ?? "?").slice(0, 24),
      name: String(tok?.name ?? "").slice(0, 60),
      dex: (inc.get(p?.relationships?.dex?.data?.id)?.attributes?.name as string | undefined) ?? null,
      ageH: Number.isFinite(created) ? Math.max(0, (nowMs - created) / 3_600_000) : null,
      mcap: known(a.market_cap_usd) ?? known(a.fdv_usd),
      liq: num(a.reserve_in_usd),
      vol24: num(a.volume_usd?.h24),
      vol1: num(a.volume_usd?.h1),
      ch1: num(a.price_change_percentage?.h1),
      ch6: num(a.price_change_percentage?.h6),
      ch24: num(a.price_change_percentage?.h24),
      buys1: num(a.transactions?.h1?.buys),
      sells1: num(a.transactions?.h1?.sells),
      rank: idx + 1,
    });
  });
  return out;
}

/** A coin worth ranking: not a blue chip or a stablecoin, not a giant, with a pool that has at least some money in it. */
export function memecoinLike(p: HotPool, minLiq = 5_000): boolean {
  if (MAJORS.has(p.symbol.toUpperCase())) return false;
  if (p.mcap != null && p.mcap > 2e9) return false;
  return (p.liq ?? 0) >= minLiq;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function statsOf(pools: HotPool[], llama: ChainStats["llama"]): ChainStats {
  const kept = pools.filter((p) => memecoinLike(p));
  const ch6 = kept.map((p) => p.ch6).filter((x): x is number => x != null);
  const ch24 = kept.map((p) => p.ch24).filter((x): x is number => x != null);
  return {
    n: kept.length,
    up20h6: kept.filter((p) => (p.ch6 ?? -1e9) >= 20).length,
    up50h24: kept.filter((p) => (p.ch24 ?? -1e9) >= 50).length,
    young: kept.filter((p) => p.ageH != null && p.ageH < 48).length,
    medH6: median(ch6),
    medH24: median(ch24),
    vol24: kept.reduce((a, p) => a + (p.vol24 ?? 0), 0),
    vol1: kept.reduce((a, p) => a + (p.vol1 ?? 0), 0),
    llama,
  };
}

/** Average rank (1 = best, ties share the average of their positions) of each value, higher is better. */
function ranksHigherBetter(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = avg;
    i = j + 1;
  }
  return out;
}

const sign = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(0)}%`;

function whyOf(s: ChainStats): string {
  if (s.error) return `could not be read this time (${s.error})`;
  const parts: string[] = [];
  if (s.n >= 5) parts.push(`${s.up50h24} of ${s.n} trending coins are up 50%+ today`);
  if (s.young > 0) parts.push(`${s.young} launched in the last 2 days`);
  if (s.llama?.change7d != null) parts.push(`exchange volume ${sign(s.llama.change7d)} in a week`);
  return parts.length ? parts.join("; ") : "little to see";
}

/** Rank the networks. The input order does not matter. */
export function rankChains(items: Array<{ chain: ChainInfo; stats: ChainStats }>): HotChain[] {
  const N = items.length;
  const share = (s: ChainStats, k: number) => (s.n ? k / s.n : 0);
  const ind = [
    items.map((x) => share(x.stats, x.stats.up20h6)),
    items.map((x) => share(x.stats, x.stats.young)),
    items.map((x) => x.stats.medH24 ?? -1e6),
    items.map((x) => x.stats.llama?.change7d ?? -1e6),
  ];
  const ranks = ind.map(ranksHigherBetter);
  const avg = items.map((x, i) => (x.stats.error || x.stats.n === 0 ? N + 1 : ranks.reduce((a, r) => a + r[i]!, 0) / ranks.length));
  const order = items.map((_, i) => i).sort((a, b) => avg[a]! - avg[b]! || share(items[b]!.stats, items[b]!.stats.up20h6) - share(items[a]!.stats, items[a]!.stats.up20h6) || items[b]!.stats.vol1 - items[a]!.stats.vol1);
  return order.map((i, pos) => ({
    id: items[i]!.chain.id,
    label: items[i]!.chain.label,
    fomo: items[i]!.chain.fomo,
    rank: pos + 1,
    heat: N > 1 && avg[i]! <= N ? Math.round((100 * (N - avg[i]!)) / (N - 1)) : 0,
    stats: items[i]!.stats,
    why: whyOf(items[i]!.stats),
  }));
}

const GT_HEADERS = { accept: "application/json;version=20230302", "user-agent": "Aureus-Hot/1.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string>, tries = 2): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(3_000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      /* try once more */
    }
  }
  return null;
}

/**
 * Read every network and rank it. Takes about 15 seconds (GeckoTerminal allows about 30 calls a minute, so the networks are read one
 * after the other). A network whose list cannot be read is ranked last and says so. Throws only when no network could be read at all.
 */
export async function computeHotChains(chains: ChainInfo[] = CHAINS): Promise<HotReport> {
  const llamaP = Promise.all(
    chains.map(async (c) => {
      if (!c.llama) return null;
      const j = await getJson(`https://api.llama.fi/overview/dexs/${c.llama}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, { accept: "application/json" });
      if (!j || num(j.total24h) == null) return null;
      return { vol24: j.total24h as number, change1d: num(j.change_1d), change7d: num(j.change_7d) };
    }),
  );
  const pools: Record<string, HotPool[]> = {};
  const raw: Array<{ chain: ChainInfo; list: HotPool[] | null }> = [];
  for (const c of chains) {
    const body = await getJson(`https://api.geckoterminal.com/api/v2/networks/${c.gt}/trending_pools?page=1&include=base_token,dex`, GT_HEADERS, 3);
    raw.push({ chain: c, list: body?.data ? parsePools(c.id, body) : null });
    await sleep(2_300);
  }
  const llama = await llamaP;
  if (raw.every((r) => !r.list)) throw new Error("no network could be read");
  const items = raw.map((r, i) => {
    const list = r.list ?? [];
    // everything that is not a blue chip or dust, in GeckoTerminal's order: the screen filters further (new and small, or all)
    pools[r.chain.id] = list.filter((p) => memecoinLike(p, 5_000)).slice(0, 20);
    const st = statsOf(list, llama[i] ?? null);
    if (!r.list) st.error = "rate limited or down";
    return { chain: r.chain, stats: st };
  });
  return {
    at: new Date().toISOString(),
    chains: rankChains(items),
    pools,
    note: "Heat describes today, it does not forecast. Blue chips and stablecoins are left out; every network's list is GeckoTerminal's own 'trending' top 20.",
  };
}

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const unreadable = (chains: Array<{ stats?: { error?: string } }>) => chains.filter((c) => c.stats?.error).length;

/**
 * Store a ranking (kind "hotchains" in lab_reports, one row, replaced each time). A ranking in which more networks could not be read than
 * in the stored one does not replace it while the stored one is under half an hour old: a rate-limited round must not make a good list
 * vanish from the screen. Returns whether the new ranking was stored.
 */
export async function saveHotReport(db: Queryable, r: HotReport, keepGoodForMin = 30): Promise<boolean> {
  const old = (await db.query(`SELECT payload->'chains' AS chains, EXTRACT(EPOCH FROM (now() - computed_at)) / 60 AS age_min FROM lab_reports WHERE kind = 'hotchains'`).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (old && Array.isArray(old.chains) && Number(old.age_min) < keepGoodForMin && unreadable(old.chains) < unreadable(r.chains)) return false;
  await db.query(
    `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ('hotchains', now(), $1, $2::jsonb)
     ON CONFLICT (kind) DO UPDATE SET computed_at = now(), n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
    [Object.values(r.pools).reduce((a, l) => a + l.length, 0), JSON.stringify(r)],
  );
  return true;
}
