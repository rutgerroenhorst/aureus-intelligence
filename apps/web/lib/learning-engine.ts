import { getPool } from "@aureus/db";
import { internalFetch } from "./internalFetch";

/**
 * The learning loop, run on the server.
 *
 * It used to depend on a browser calling /api/learning-track for every coin that qualified for a tab;
 * nothing ever did, so the Self-Optimizer stayed at zero for good. Now every tick:
 *   1. trackQualified()  records each coin currently listed on a Radar tab (once per coin per tab per day),
 *   2. updateOutcomes()  re-measures the open ones and labels them once there is something to label.
 * Suggestions are generated from the labelled rows by /api/learning-generate-suggestions.
 */

/** A coin that never reached 2x is only called a loser after being watched this long. */
const HORIZON_H = Number(process.env.LEARNING_HORIZON_HOURS ?? 6);
/** Winners keep being measured this long after qualifying so their peak is right. */
const WINNER_TRACK_H = 24;
const WIN_MULTIPLE = 2;
const RUG_MULTIPLE = 0.5;
/** Pool depth below this counts as pulled liquidity. */
const DRAINED_LIQUIDITY_USD = 100;
/** A coin already tracked for a tab within this window is not tracked for it again. */
const DEDUPE_H = 24;
/** Mints measured per tick: at most 8 DexScreener calls of 30. */
const MAX_MINTS_PER_TICK = 240;
/** coin_qualifications.mint is VARCHAR(44). */
const MAX_MINT_LENGTH = 44;

type Raw = Record<string, any>;

export interface Qualifier {
  mint: string;
  symbol: string | null;
  tab: string;
  ageMin: number | null;
  score: number | null;
  mcap: number | null;
  liq: number | null;
  danger: number | null;
  top10: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const minutesSince = (iso: unknown): number | null => {
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : null;
};

const clamp = (v: number | null, lo: number, hi: number): number | null => (v == null ? null : Math.min(hi, Math.max(lo, v)));

/** topHolders[].pct is a fraction (0.12 = 12 %); the table stores percent. */
function top10Percent(holders: unknown): number | null {
  if (!Array.isArray(holders) || holders.length === 0) return null;
  const sum = holders.slice(0, 10).reduce((s: number, h: Raw) => s + (num(h?.pct) ?? 0), 0);
  return Math.min(100, sum <= 1.5 ? sum * 100 : sum);
}

const fromCandidate = (c: Raw): Partial<Qualifier> => ({
  ageMin: minutesSince(c.discovered_at),
  mcap: num(c.marketCapUsd),
  liq: num(c.liquidityUsd),
  top10: top10Percent(c.topHolders),
});

/** One entry per Radar tab: the route that fills it and how to read a row. Names match the tab labels. */
const SOURCES: Array<{ tab: string; path: string; list: (j: Raw) => Raw[]; read: (c: Raw) => Partial<Qualifier> }> = [
  {
    tab: "cate", path: "/api/cate-hunter", list: (j) => j.cateCoins,
    read: (c) => ({ ageMin: num(c.minutesOld), score: num(c.cateScore), mcap: num(c.mcap), liq: num(c.liquidity) }),
  },
  {
    tab: "buy_signals", path: "/api/signals", list: (j) => j.buy_signals,
    read: (c) => ({ ageMin: num(c.minutesOld), score: num(c.buy_score), mcap: num(c.marketCapUsd), liq: num(c.liquidityUsd), danger: num(c.riskScore) }),
  },
  {
    tab: "ultra_momentum", path: "/api/ultra-early-momentum", list: (j) => j.candidates,
    read: (c) => ({ ageMin: num(c.minutesOld), score: num(c.score), mcap: num(c.mcap), liq: num(c.liquidity) }),
  },
  { tab: "elite", path: "/api/elite-validator", list: (j) => j.candidates, read: fromCandidate },
  { tab: "incubation", path: "/api/incubation", list: (j) => j.candidates, read: fromCandidate },
];

/** The coins every Radar tab lists right now, read from the same routes the tabs use. */
export async function collectQualifiers(): Promise<{ qualifiers: Qualifier[]; failedTabs: string[] }> {
  const failedTabs: string[] = [];
  const perTab = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const res = await internalFetch(s.path, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const rows = s.list(await res.json());
        if (!Array.isArray(rows)) throw new Error("unexpected shape");
        return rows.map((c): Qualifier => ({
          mint: String(c.mint ?? ""), symbol: c.symbol ? String(c.symbol).slice(0, 100) : null, tab: s.tab,
          ageMin: null, score: null, mcap: null, liq: null, danger: null, top10: null,
          ...s.read(c),
        }));
      } catch {
        failedTabs.push(s.tab);
        return [] as Qualifier[];
      }
    }),
  );
  const seen = new Set<string>();
  const qualifiers = perTab.flat().filter((q) => {
    if (!q.mint || q.mint.length > MAX_MINT_LENGTH) return false;
    const key = `${q.tab}:${q.mint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { qualifiers, failedTabs };
}

interface Metrics { ageMin: number | null; chain: string; buyRatio: number | null; volVel: number | null; priceVel: number | null; top10: number | null }

/** Buy/sell balance, volume and price momentum from what the scanner has already stored. */
async function marketMetrics(mints: string[]): Promise<Map<string, Metrics>> {
  const out = new Map<string, Metrics>();
  if (mints.length === 0) return out;
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (t.mint) t.mint, t.chain::text AS chain,
            EXTRACT(EPOCH FROM (now() - c.discovered_at)) / 60 AS age_min,
            tx.buys, tx.sells, tx.volume_usd AS vol_now, txp.volume_usd AS vol_prev,
            pr.price_now, pr.price_ref, hs.top10_pct
       FROM tokens t
       JOIN candidates c ON c.token_id = t.id AND c.current_state <> 'EXPIRED'
       LEFT JOIN LATERAL (SELECT buys, sells, volume_usd FROM transaction_aggregates
                           WHERE pool_id = c.pool_id AND window_seconds = 3600
                           ORDER BY observed_at DESC LIMIT 1) tx ON true
       LEFT JOIN LATERAL (SELECT volume_usd FROM transaction_aggregates
                           WHERE pool_id = c.pool_id AND window_seconds = 3600
                             AND observed_at <= now() - interval '30 minutes'
                           ORDER BY observed_at DESC LIMIT 1) txp ON true
       LEFT JOIN LATERAL (SELECT
                (SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) AS price_now,
                (SELECT price_usd FROM prices WHERE pool_id = c.pool_id AND observed_at <= now() - interval '30 minutes'
                  ORDER BY observed_at DESC LIMIT 1) AS price_ref) pr ON true
       LEFT JOIN LATERAL (SELECT top10_pct FROM holder_snapshots WHERE token_id = t.id
                           ORDER BY taken_at DESC LIMIT 1) hs ON true
      WHERE t.mint = ANY($1)
      ORDER BY t.mint, c.discovered_at DESC`,
    [mints],
  );
  for (const r of rows) {
    const buys = num(r.buys), sells = num(r.sells);
    const volNow = num(r.vol_now), volPrev = num(r.vol_prev);
    const pNow = num(r.price_now), pRef = num(r.price_ref);
    const age = num(r.age_min);
    out.set(r.mint, {
      ageMin: age != null ? Math.round(age) : null,
      chain: r.chain || "solana",
      buyRatio: buys != null && sells != null && buys + sells > 0 ? buys / (buys + sells) : null,
      volVel: volNow != null && volPrev != null && volPrev > 0 ? volNow / volPrev : null,
      priceVel: pNow != null && pRef != null && pRef > 0 ? pNow / pRef - 1 : null,
      top10: num(r.top10_pct),
    });
  }
  return out;
}

export interface TrackResult { listed: number; fresh: number; tracked: number; unpriced: number; failedTabs: string[] }

/**
 * Record every coin that is on a Radar tab and was not already tracked for that tab in the last day.
 * The baseline is the market cap fetched live right now, not the stored one: the stored value is as old as
 * the coin's last scan, and grading a later reading against a stale baseline would call a coin a "2x winner"
 * that had in fact already doubled before it qualified.
 */
export async function trackQualified(): Promise<TrackResult> {
  const pool = getPool();
  const { qualifiers, failedTabs } = await collectQualifiers();
  const result: TrackResult = { listed: qualifiers.length, fresh: 0, tracked: 0, unpriced: 0, failedTabs };
  if (qualifiers.length === 0) return result;

  const mints = [...new Set(qualifiers.map((q) => q.mint))];
  const existing = await pool.query(
    `SELECT mint, tab_name FROM coin_qualifications
      WHERE mint = ANY($1) AND qualified_at > now() - make_interval(hours => $2)`,
    [mints, DEDUPE_H],
  );
  const done = new Set(existing.rows.map((r: Raw) => `${r.tab_name}:${r.mint}`));
  const fresh = qualifiers.filter((q) => !done.has(`${q.tab}:${q.mint}`));
  result.fresh = fresh.length;
  if (fresh.length === 0) return result;

  const freshMints = [...new Set(fresh.map((q) => q.mint))];
  const metrics = await marketMetrics(freshMints);

  // Live baseline per mint (one call per 30).
  const live = new Map<string, Pair>();
  const byChain = new Map<string, string[]>();
  for (const m of freshMints) {
    const chain = metrics.get(m)?.chain ?? "solana";
    byChain.set(chain, [...(byChain.get(chain) ?? []), m]);
  }
  for (const [chain, list] of byChain) {
    for (let i = 0; i < list.length; i += 30) {
      const found = await fetchPairs(chain, list.slice(i, i + 30));
      if (found) for (const [m, p] of found) live.set(m, p);
    }
  }

  const rows = fresh.flatMap((q) => {
    const pair = live.get(q.mint);
    const mcap = pair ? num(pair.marketCap) ?? num(pair.fdv) : null;
    // No live price -> not tracked this tick; it is picked up on the next one instead of getting a wrong baseline.
    if (mcap == null || mcap <= 0) { result.unpriced++; return []; }
    const m = metrics.get(q.mint);
    return [{
      mint: q.mint, symbol: q.symbol, tab: q.tab,
      ageMin: Math.max(0, Math.round(q.ageMin ?? m?.ageMin ?? 0)),
      score: clamp(q.score, -99_999_999, 99_999_999),
      buyRatio: clamp(m?.buyRatio ?? null, 0, 999),
      top10: clamp(q.top10 ?? m?.top10 ?? null, 0, 999),
      volVel: clamp(m?.volVel ?? null, 0, 999_999),
      priceVel: clamp(m?.priceVel ?? null, -999_999, 999_999),
      mcap, liq: pair?.liquidity?.usd ?? q.liq,
      danger: clamp(q.danger, 0, 999),
    }];
  });
  if (rows.length === 0) return result;

  const col = <T,>(f: (r: (typeof rows)[number]) => T) => rows.map(f);
  const res = await pool.query(
    `INSERT INTO coin_qualifications (
        mint, symbol, tab_name, age_minutes_at_qualification, age_days_at_qualification,
        score_at_qualification, buy_ratio_at_qualification, holder_top10_at_qualification,
        volume_velocity_at_qualification, price_velocity_at_qualification,
        mcap_usd_at_qualification, liquidity_usd_at_qualification, danger_score_at_qualification, outcome_status)
     SELECT v.mint, v.symbol, v.tab, v.age_min, v.age_min / 1440.0,
            v.score, v.buy_ratio, v.top10, v.vol_vel, v.price_vel, v.mcap, v.liq, v.danger, 'pending'
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::numeric[], $6::numeric[], $7::numeric[],
                   $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[])
            AS v(mint, symbol, tab, age_min, score, buy_ratio, top10, vol_vel, price_vel, mcap, liq, danger)
      WHERE NOT EXISTS (
        SELECT 1 FROM coin_qualifications q
         WHERE q.mint = v.mint AND q.tab_name = v.tab
           AND q.qualified_at > now() - make_interval(hours => $13))
     RETURNING id`,
    [
      col((r) => r.mint), col((r) => r.symbol), col((r) => r.tab), col((r) => r.ageMin), col((r) => r.score),
      col((r) => r.buyRatio), col((r) => r.top10), col((r) => r.volVel), col((r) => r.priceVel),
      col((r) => r.mcap), col((r) => r.liq), col((r) => r.danger), DEDUPE_H,
    ],
  );
  result.tracked = res.rowCount ?? 0;
  return result;
}

// ── Outcomes ────────────────────────────────────────────────────────────────────────────────────────

export type Outcome = "pending" | "winner" | "loser" | "rugpull" | "dead";

export interface OutcomeInput {
  status: Outcome;
  /** market cap now / market cap when it qualified; null when no market cap came back */
  multiple: number | null;
  /** highest market cap seen so far / market cap when it qualified */
  peakMultiple: number;
  ageHours: number;
  /** false only when the exchange answered but lists no pool for this coin */
  hasPair: boolean;
  liquidityUsd: number | null;
  volume24h: number | null;
}

/**
 * Pure labelling rule (kept separate so it is testable).
 *  - hit 2x at any check                  -> winner (kept, never downgraded)
 *  - no pool listed, 1 h after qualifying -> dead
 *  - liquidity pulled, or under 0.5x      -> rugpull
 *  - still open after the horizon         -> loser, or dead when nothing trades
 *  - otherwise                            -> pending: too early to call
 * A coin is NOT a loser merely because it has not moved yet; the old updater called everything a loser at the
 * first check, which would have taught the optimizer that nothing ever wins.
 */
export function decideOutcome(i: OutcomeInput): Outcome {
  if (i.status === "winner" || i.peakMultiple >= WIN_MULTIPLE) return "winner";
  if (!i.hasPair) return i.ageHours >= 1 ? "dead" : "pending";
  if (i.liquidityUsd != null && i.liquidityUsd < DRAINED_LIQUIDITY_USD) return "rugpull";
  if (i.multiple != null && i.multiple < RUG_MULTIPLE) return "rugpull";
  if (i.ageHours >= HORIZON_H) return i.volume24h === 0 ? "dead" : "loser";
  return "pending";
}

export interface Pair {
  baseToken?: { address?: string };
  pairCreatedAt?: number;
  marketCap?: number;
  fdv?: number;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

const sameMint = (a: string, b: string) => (a.startsWith("0x") || b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);

/** One DexScreener call for up to 30 mints of one chain; the deepest pool wins per mint. null = the call failed. */
export async function fetchPairs(chain: string, mints: string[]): Promise<Map<string, Pair> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${mints.join(",")}`, {
        headers: { accept: "application/json", "user-agent": "Aureus-Learning" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_200));
        continue;
      }
      if (!res.ok) return null;
      const pairs = (await res.json()) as Pair[];
      if (!Array.isArray(pairs)) return null;
      const best = new Map<string, Pair>();
      for (const p of pairs) {
        const addr = p.baseToken?.address;
        const mint = addr ? mints.find((m) => sameMint(m, addr)) : undefined;
        if (!mint) continue;
        const cur = best.get(mint);
        if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(mint, p);
      }
      return best;
    } catch {
      /* retry once, then give up on this batch */
    }
  }
  return null;
}

export interface OutcomeResult {
  checked: number;
  winners: number;
  rugpulls: number;
  dead: number;
  losers: number;
  pending: number;
  /** batches DexScreener did not answer; those coins keep their old status and are retried next tick */
  failedBatches: number;
}

/** Re-measure the open coins and label the ones that can be labelled. */
export async function updateOutcomes(): Promise<OutcomeResult> {
  const pool = getPool();
  const result: OutcomeResult = { checked: 0, winners: 0, rugpulls: 0, dead: 0, losers: 0, pending: 0, failedBatches: 0 };

  const { rows } = await pool.query(
    `SELECT q.id, q.mint, q.outcome_status, q.mcap_usd_at_qualification AS mcap0,
            q.peak_mcap_usd,
            EXTRACT(EPOCH FROM (now() - q.qualified_at)) / 3600 AS age_h,
            COALESCE(t.chain::text, 'solana') AS chain
       FROM coin_qualifications q
       LEFT JOIN LATERAL (SELECT chain FROM tokens WHERE mint = q.mint LIMIT 1) t ON true
      WHERE (q.outcome_status = 'pending'
             OR (q.outcome_status = 'winner' AND q.qualified_at > now() - make_interval(hours => $2)))
        AND q.mcap_usd_at_qualification > 0
        AND q.last_updated_at < now() - interval '4 minutes'
      ORDER BY q.last_updated_at ASC
      LIMIT $1`,
    [MAX_MINTS_PER_TICK * 2, WINNER_TRACK_H],
  );
  if (rows.length === 0) return result;

  // One request per 30 distinct mints per chain.
  const byChain = new Map<string, string[]>();
  for (const r of rows) {
    const list = byChain.get(r.chain) ?? [];
    if (!list.includes(r.mint) && list.length < MAX_MINTS_PER_TICK) list.push(r.mint);
    byChain.set(r.chain, list);
  }
  const market = new Map<string, Pair | null>(); // null = the exchange answered and lists no pool
  for (const [chain, mints] of byChain) {
    for (let i = 0; i < mints.length; i += 30) {
      const batch = mints.slice(i, i + 30);
      const found = await fetchPairs(chain, batch);
      // An answer that lists nothing at all for a whole batch is a hiccup, not a batch of dead coins.
      if (!found || (found.size === 0 && batch.length >= 5)) { result.failedBatches++; continue; }
      for (const m of batch) market.set(m, found.get(m) ?? null);
    }
  }

  const ids: number[] = [], prices: Array<number | null> = [], peakMcaps: number[] = [], statuses: Outcome[] = [];
  const multiples: Array<number | null> = [], peakMultiples: number[] = [];
  for (const r of rows) {
    if (!market.has(r.mint)) continue; // not measured this tick: leave it untouched
    const mcap0 = num(r.mcap0)!;
    const pair = market.get(r.mint) ?? null;
    const mcapNow = pair ? num(pair.marketCap) ?? num(pair.fdv) : null;
    const peakMcap = Math.max(num(r.peak_mcap_usd) ?? 0, mcap0, mcapNow ?? 0);
    const multiple = mcapNow != null ? mcapNow / mcap0 : null;
    const peakMultiple = peakMcap / mcap0;
    const status = decideOutcome({
      status: r.outcome_status, multiple, peakMultiple, ageHours: num(r.age_h) ?? 0,
      hasPair: pair != null, liquidityUsd: num(pair?.liquidity?.usd), volume24h: num(pair?.volume?.h24),
    });
    ids.push(Number(r.id));
    prices.push(pair ? num(pair.priceUsd) : null);
    peakMcaps.push(peakMcap);
    statuses.push(status);
    multiples.push(multiple != null ? Math.min(multiple, 999_999) : null);
    peakMultiples.push(Math.min(peakMultiple, 999_999));
    result.checked++;
    if (status === "winner") result.winners++;
    else if (status === "rugpull") result.rugpulls++;
    else if (status === "dead") result.dead++;
    else if (status === "loser") result.losers++;
    else result.pending++;
  }
  if (ids.length === 0) return result;

  await pool.query(
    `UPDATE coin_qualifications q SET
        current_price_usd = COALESCE(v.price, q.current_price_usd),
        peak_price_usd = GREATEST(COALESCE(q.peak_price_usd, 0), COALESCE(v.price, 0)),
        peak_mcap_usd = v.peak_mcap,
        outcome_status = v.status,
        return_multiplier = COALESCE(v.multiple, q.return_multiplier),
        peak_return_multiplier = v.peak_multiple,
        last_updated_at = now(),
        confirmed_winner_at = CASE WHEN v.status = 'winner' THEN COALESCE(q.confirmed_winner_at, now()) ELSE q.confirmed_winner_at END,
        failed_at = CASE WHEN v.status IN ('rugpull', 'dead') THEN COALESCE(q.failed_at, now()) ELSE q.failed_at END
       FROM unnest($1::bigint[], $2::numeric[], $3::numeric[], $4::text[], $5::numeric[], $6::numeric[])
            AS v(id, price, peak_mcap, status, multiple, peak_multiple)
      WHERE q.id = v.id`,
    [ids, prices, peakMcaps, statuses, multiples, peakMultiples],
  );
  return result;
}

/** Turn the labelled rows into filter suggestions (the route keeps the statistics in one place). */
export async function generateSuggestions(): Promise<{ generated: number }> {
  const res = await internalFetch("/api/learning-generate-suggestions", { method: "POST" });
  if (!res.ok) throw new Error(`suggestions ${res.status}`);
  const body = await res.json();
  return { generated: Number(body.generated_count ?? 0) };
}
