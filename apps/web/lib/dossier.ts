/**
 * The coin dossier: everything free sources can say about one coin, gathered at the moment you ask, with every source reported
 * on its own (a source that is rate limited says so; the rest of the page still works).
 *
 *   DexScreener  price, liquidity, volume, trades, paid profile / boosts / ads (orders)
 *   Jupiter      organic score, holders, unique traders, organic volume, launchpad, developer
 *   RugCheck     score and risks, insider networks, liquidity lock, top holders (with insider flags), creator's other coins
 *   GeckoTerminal  hourly price history (often rate limited from shared addresses)
 *   the lab      lesson, lane, odds of similar coins, what pump.fun's stream knew, your own entry
 */

import { getPool } from "@aureus/db";
import { aiNameWide, tagsFor } from "@/lib/lab/narrative";

const HEADERS = { accept: "application/json", "user-agent": "Aureus-Dossier/1.0" };
export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: res.status === 429 ? "rate limited" : `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 80) };
  }
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

export interface Dossier {
  mint: string;
  at: string;
  sources: Record<string, "ok" | string>;
  market: null | {
    symbol: string | null; name: string | null; priceUsd: number | null; mcap: number | null; fdv: number | null; liquidity: number | null;
    volume: Record<string, number | null>; buys: Record<string, number | null>; sells: Record<string, number | null>; change: Record<string, number | null>;
    pairCreatedAt: number | null; dex: string | null; pair: string | null; quote: string | null; site: string | null; socials: string[]; image: string | null; boostsActive: number;
  };
  paid: null | { profile: number | null; cto: number | null; ads: number[]; boosts: Array<[number, number]> };
  jupiter: null | { organic: number | null; organicLabel: string | null; holders: number | null; launchpad: string | null; verified: boolean | null; topHoldersPct: number | null; devPct: number | null; devMints: number | null; devMigrations: number | null; mintOff: boolean | null; freezeOff: boolean | null; h1: Record<string, number | null>; h24: Record<string, number | null> };
  rugcheck: null | {
    score: number | null; risks: Array<{ name: string; level: string | null; description: string | null }>; rugged: boolean; lpLockedPct: number | null; totalHolders: number | null; liquidity: number | null;
    insidersDetected: number | null; insiderNetworks: Array<{ size: number; type: string | null; holdingPct: number | null }>; insiderHoldingPct: number | null;
    creator: string | null; creatorPct: number | null; creatorTokens: number | null; topHolders: Array<{ owner: string; pct: number; insider: boolean }>; top10Pct: number | null;
    mintAuthority: boolean; freezeAuthority: boolean; detectedAt: string | null; launchpad: string | null;
  };
  chart: null | { candles: Array<[number, number, number, number, number, number]> };
  lab: {
    lesson: null | { lane: string; cls: string; status: string; firstSeenAt: number; firstMcap: number | null; peakHeld: number | null; minMult: number | null; tags: string[] };
    odds: null | { go2: { p: number; k: number; n: number } | null; collapse24: { p: number; k: number; n: number } | null; zone: string | null; flags: string[]; ageH: number };
    watch: null | { lane: string; reason: string; firstSeenAt: number; active: boolean; polls: number };
    pump: null | { createToMigrateMin: number | null; initialBuySol: number | null; mayhem: boolean | null; creatorLaunches72h: number | null };
    entry: null | { enteredAt: string; entryMcap: number; peakMultiple: number; multiplier: number; tab: string | null };
  };
  narrative: { tags: string[]; aiName: boolean };
}

/** Pull what matters out of RugCheck's long report. */
function rugSummary(r: any, supplyHint: number | null): NonNullable<Dossier["rugcheck"]> {
  const holders = ((r.topHolders ?? []) as Array<{ owner?: string; address?: string; pct?: number; insider?: boolean }>).map((h) => ({ owner: String(h.owner ?? h.address ?? ""), pct: num(h.pct) ?? 0, insider: Boolean(h.insider) }));
  const markets = (r.markets ?? []) as Array<{ lp?: { lpLockedPct?: number } }>;
  const locked = markets.map((m) => num(m.lp?.lpLockedPct)).filter((x): x is number => x != null);
  const creatorBal = num(r.creatorBalance);
  const supply = num(r.token?.supply) ?? supplyHint;
  const nets = ((r.insiderNetworks ?? []) as Array<{ size?: number; type?: string; currentHolding?: number }>).map((n) => ({
    size: num(n.size) ?? 0, type: n.type ?? null, holdingPct: supply && num(n.currentHolding) != null ? (num(n.currentHolding)! / supply) * 100 : null,
  }));
  return {
    score: num(r.score_normalised) ?? num(r.score),
    risks: ((r.risks ?? []) as Array<{ name?: string; level?: string; description?: string }>).map((x) => ({ name: String(x.name ?? "risk"), level: x.level ?? null, description: x.description ?? null })),
    rugged: r.rugged === true,
    lpLockedPct: locked.length ? Math.max(...locked) : null,
    totalHolders: num(r.totalHolders),
    liquidity: num(r.totalMarketLiquidity),
    insidersDetected: num(r.graphInsidersDetected),
    insiderNetworks: nets.slice(0, 6),
    insiderHoldingPct: holders.filter((h) => h.insider).reduce((a, h) => a + h.pct, 0),
    creator: r.creator ?? null,
    creatorPct: creatorBal != null && supply ? (creatorBal / supply) * 100 : null,
    creatorTokens: Array.isArray(r.creatorTokens) ? r.creatorTokens.length : null,
    topHolders: holders.slice(0, 10),
    top10Pct: holders.length ? holders.slice(0, 10).reduce((a, h) => a + h.pct, 0) : null,
    mintAuthority: r.mintAuthority != null,
    freezeAuthority: r.freezeAuthority != null,
    detectedAt: r.detectedAt ?? null,
    launchpad: r.launchpad?.name ?? null,
  };
}

async function labFacts(mint: string): Promise<Dossier["lab"]> {
  const empty: Dossier["lab"] = { lesson: null, odds: null, watch: null, pump: null, entry: null };
  const pool = getPool();
  const q = (text: string) => pool.query(text, [mint]).then((r) => r.rows).catch(() => [] as any[]);
  const [lesson, watch, pump, entry, live] = await Promise.all([
    q(`SELECT lane, outcome, status, EXTRACT(EPOCH FROM first_seen_at)::float8 AS seen, first_mcap::float8 AS first_mcap, tags FROM lab_coins WHERE mint = $1`),
    q(`SELECT lane, reason, EXTRACT(EPOCH FROM first_seen_at)::float8 AS seen, active, polls FROM lab_watch WHERE mint = $1`),
    q(`SELECT create_to_migrate_min, initial_buy_sol, mayhem, creator_launches_72h FROM pump_graduates WHERE mint = $1`),
    q(`SELECT entered_at, entry_mcap_usd, last_mcap_usd, peak_mcap_usd, tab_name FROM my_trades WHERE mint = $1 ORDER BY entered_at DESC LIMIT 1`),
    pool.query(`SELECT payload FROM lab_reports WHERE kind = 'live'`).then((r) => r.rows).catch(() => [] as any[]),
  ]);
  const out = { ...empty };
  if (lesson[0]) {
    const o = lesson[0].outcome ?? {};
    out.lesson = { lane: lesson[0].lane, cls: o.cls ?? "OPEN", status: lesson[0].status, firstSeenAt: lesson[0].seen, firstMcap: num(lesson[0].first_mcap), peakHeld: num(o.peakHeld?.all), minMult: num(o.minMult?.h72), tags: lesson[0].tags ?? [] };
  }
  if (watch[0]) out.watch = { lane: watch[0].lane, reason: watch[0].reason, firstSeenAt: watch[0].seen, active: watch[0].active, polls: watch[0].polls };
  if (pump[0]) out.pump = { createToMigrateMin: num(pump[0].create_to_migrate_min), initialBuySol: num(pump[0].initial_buy_sol), mayhem: pump[0].mayhem, creatorLaunches72h: num(pump[0].creator_launches_72h) };
  if (entry[0]) {
    const e = Number(entry[0].entry_mcap_usd) || 1;
    out.entry = { enteredAt: new Date(entry[0].entered_at).toISOString(), entryMcap: e, peakMultiple: Math.max(Number(entry[0].peak_mcap_usd) || e, Number(entry[0].last_mcap_usd) || e) / e, multiplier: (Number(entry[0].last_mcap_usd) || e) / e, tab: entry[0].tab_name };
  }
  const c = ((live[0]?.payload?.coins ?? []) as Array<any>).find((x) => x.mint === mint);
  if (c) out.odds = { go2: c.go2 ?? null, collapse24: c.collapse24 ?? null, zone: c.zone ?? null, flags: c.flags ?? [], ageH: c.ageH };
  return out;
}

const cache = new Map<string, { at: number; value: Dossier }>();
let windowStart = 0;
let windowCount = 0;

/** Build the dossier (cached 45 s per coin; at most 40 builds a minute per server instance, so a public address cannot be used to burn API quotas). */
export async function buildDossier(mint: string): Promise<Dossier | { error: string }> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 45_000) return hit.value;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  if (++windowCount > 40) return { error: "Too many dossiers requested just now; try again in a minute." };

  const [dex, orders, jup, rug] = await Promise.all([
    getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`),
    getJson(`https://api.dexscreener.com/orders/v1/solana/${mint}`),
    getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`),
    getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {}, 20_000),
  ]);
  const sources: Dossier["sources"] = { dexscreener: dex.ok ? "ok" : dex.error, orders: orders.ok ? "ok" : orders.error, jupiter: jup.ok ? "ok" : jup.error, rugcheck: rug.ok ? "ok" : rug.error };

  const pairs = dex.ok && Array.isArray(dex.json) ? (dex.json as any[]).filter((p) => p?.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)) : [];
  const p = pairs[0];
  const market: Dossier["market"] = p
    ? {
        symbol: p.baseToken?.symbol ?? null, name: p.baseToken?.name ?? null, priceUsd: num(p.priceUsd), mcap: num(p.marketCap) ?? num(p.fdv), fdv: num(p.fdv), liquidity: num(p.liquidity?.usd),
        volume: { m5: num(p.volume?.m5), h1: num(p.volume?.h1), h6: num(p.volume?.h6), h24: num(p.volume?.h24) },
        buys: { m5: num(p.txns?.m5?.buys), h1: num(p.txns?.h1?.buys), h6: num(p.txns?.h6?.buys), h24: num(p.txns?.h24?.buys) },
        sells: { m5: num(p.txns?.m5?.sells), h1: num(p.txns?.h1?.sells), h6: num(p.txns?.h6?.sells), h24: num(p.txns?.h24?.sells) },
        change: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) },
        pairCreatedAt: num(p.pairCreatedAt), dex: p.dexId ?? null, pair: p.pairAddress ?? null, quote: p.quoteToken?.symbol ?? null,
        site: p.info?.websites?.[0]?.url ?? null, socials: ((p.info?.socials ?? []) as Array<{ type?: string; url?: string }>).map((s) => s.url ?? s.type ?? "").filter(Boolean), image: p.info?.imageUrl ?? null, boostsActive: num(p.boosts?.active) ?? 0,
      }
    : null;
  if (dex.ok && !p) sources.dexscreener = "no pair listed for this coin";

  let paid: Dossier["paid"] = null;
  if (orders.ok) {
    const approved = ((orders.json.orders ?? []) as Array<{ type?: string; status?: string; paymentTimestamp?: number }>).filter((o) => o.status === "approved" && num(o.paymentTimestamp) != null);
    const secs = (o: { paymentTimestamp?: number }) => o.paymentTimestamp! / 1000;
    const prof = approved.filter((o) => o.type === "tokenProfile").map(secs);
    const cto = approved.filter((o) => o.type === "communityTakeover").map(secs);
    paid = {
      profile: prof.length ? Math.min(...prof) : null, cto: cto.length ? Math.min(...cto) : null, ads: approved.filter((o) => /ad/i.test(o.type ?? "")).map(secs),
      boosts: ((orders.json.boosts ?? []) as Array<{ amount?: number; paymentTimestamp?: number }>).filter((b) => num(b.paymentTimestamp) != null).map((b) => [b.paymentTimestamp! / 1000, num(b.amount) ?? 0] as [number, number]),
    };
  }

  const jt = jup.ok && Array.isArray(jup.json) ? (jup.json as any[]).find((t) => t?.id === mint) : null;
  const win = (w: any) => ({ priceChange: num(w?.priceChange), holderChange: num(w?.holderChange), liquidityChange: num(w?.liquidityChange), volumeChange: num(w?.volumeChange), buyVolume: num(w?.buyVolume), sellVolume: num(w?.sellVolume), buyOrganicVolume: num(w?.buyOrganicVolume), sellOrganicVolume: num(w?.sellOrganicVolume), numBuys: num(w?.numBuys), numSells: num(w?.numSells), numTraders: num(w?.numTraders), numOrganicBuyers: num(w?.numOrganicBuyers), numNetBuyers: num(w?.numNetBuyers) });
  const jupiter: Dossier["jupiter"] = jt
    ? {
        organic: num(jt.organicScore), organicLabel: jt.organicScoreLabel ?? null, holders: num(jt.holderCount), launchpad: jt.launchpad ?? null, verified: jt.isVerified ?? null,
        topHoldersPct: num(jt.audit?.topHoldersPercentage), devPct: num(jt.audit?.devBalancePercentage), devMints: num(jt.audit?.devMints), devMigrations: num(jt.audit?.devMigrations),
        mintOff: jt.audit?.mintAuthorityDisabled ?? null, freezeOff: jt.audit?.freezeAuthorityDisabled ?? null, h1: win(jt.stats1h), h24: win(jt.stats24h),
      }
    : null;
  if (jup.ok && !jt) sources.jupiter = "not listed";

  const rugcheck = rug.ok && rug.json && typeof rug.json === "object" ? rugSummary(rug.json, num(jt?.totalSupply)) : null;

  // price history last: it needs the pool address and is the source most often refused
  let chart: Dossier["chart"] = null;
  if (market?.pair) {
    const g = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${market.pair}/ohlcv/hour?aggregate=1&limit=168&currency=usd&token=${mint}`, { accept: "application/json;version=20230302" }, 15_000);
    sources.geckoterminal = g.ok ? "ok" : g.error;
    if (g.ok) {
      const list = (g.json?.data?.attributes?.ohlcv_list ?? []) as Array<[number, number, number, number, number, number]>;
      if (list.length) chart = { candles: [...list].sort((a, b) => a[0] - b[0]) };
    }
  }

  const lab = await labFacts(mint);
  const tags = tagsFor(market?.name, market?.symbol, market?.site);
  const value: Dossier = { mint, at: new Date().toISOString(), sources, market, paid, jupiter, rugcheck, chart, lab, narrative: { tags, aiName: aiNameWide(market?.name, market?.symbol) } };
  cache.set(mint, { at: Date.now(), value });
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  return value;
}
