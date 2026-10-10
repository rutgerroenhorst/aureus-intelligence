/**
 * What the Radar's door turned away, handed to the Learning Lab.
 *
 * Discovery admits a coin only when its pair is old enough (DISCOVERY_MIN_AGE_MIN) and small enough (DISCOVERY_MAX_MCAP_USD).
 * Those limits decide what the Radar shows and are not touched here. But a door that never learns what happened to the coins it
 * refused cannot be judged, so the coins it refuses for being too young or too big are written to `lab_watch`; the lab polls
 * them on its own, builds lessons from them under a lane of their own, and the Radar never sees them.
 *
 * Best effort by design: any failure is swallowed (a lab problem must never stop discovery).
 */

/** Just what is needed from the shared pool (no dependency on the pg types). */
interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface TurnedAwayPair {
  chainId?: string;
  pairAddress?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  marketCap?: number;
  fdv?: number;
}

export interface TurnedAway {
  p: TurnedAwayPair;
  reason: "too_young" | "too_big";
}

/** How many coins the lab keeps under watch at once (hosted: the free database is small). */
const ACTIVE_CAP = process.env.VERCEL ? 120 : Number(process.env.LAB_WATCH_CAP ?? 2500);
const MAX_NEW_PER_PASS = 25;
/** A coin is watched for this long from the moment it is first seen (the lab's windows need 24 h + 72 h). */
const WATCH_DAYS = 7;
const MIN_LIQ_BIG = 40_000;
const MAX_MCAP = 150_000_000;

export async function noteTurnedAway(pool: Db, items: TurnedAway[], nowMs: number): Promise<number> {
  try {
    const best = new Map<string, TurnedAway>();
    for (const it of items) {
      const mint = it.p.baseToken?.address;
      if (!mint || (it.p.chainId ?? "solana").toLowerCase() !== "solana") continue;
      const liq = it.p.liquidity?.usd ?? 0;
      const mcap = it.p.marketCap ?? it.p.fdv ?? null;
      if (it.reason === "too_big" && (liq < MIN_LIQ_BIG || (mcap != null && mcap > MAX_MCAP))) continue;
      const cur = best.get(mint);
      if (!cur || liq > (cur.p.liquidity?.usd ?? 0)) best.set(mint, it);
    }
    if (!best.size) return 0;
    const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM lab_watch WHERE active`);
    const room = ACTIVE_CAP - (cnt[0]?.n ?? 0);
    if (room <= 0) return 0;
    const pick = [...best.entries()]
      .sort((a, b) => (b[1].p.liquidity?.usd ?? 0) - (a[1].p.liquidity?.usd ?? 0))
      .slice(0, Math.min(room, MAX_NEW_PER_PASS));
    const col = <T,>(f: (m: string, it: TurnedAway) => T) => pick.map(([m, it]) => f(m, it));
    const res = await pool.query(
      `INSERT INTO lab_watch (mint, lane, reason, symbol, name, pool_address, pair_created_at, first_mcap, first_liq, watch_until)
       SELECT v.mint, v.lane, v.reason, v.symbol, v.name, v.pool, CASE WHEN v.created_ms IS NULL THEN NULL ELSE to_timestamp(v.created_ms / 1000.0) END,
              v.mcap, v.liq, to_timestamp($10::float8 / 1000.0) + make_interval(days => $11)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::float8[], $8::float8[], $9::float8[])
              AS v(mint, lane, reason, symbol, name, pool, created_ms, mcap, liq)
        WHERE NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = v.mint)
       ON CONFLICT (mint) DO NOTHING`,
      [
        col((m) => m),
        col((_m, it) => (it.reason === "too_young" ? "graduate" : "runner")),
        col((_m, it) => it.reason),
        col((_m, it) => it.p.baseToken?.symbol ?? null),
        col((_m, it) => it.p.baseToken?.name ?? null),
        col((_m, it) => it.p.pairAddress ?? null),
        col((_m, it) => it.p.pairCreatedAt ?? null),
        col((_m, it) => it.p.marketCap ?? it.p.fdv ?? null),
        col((_m, it) => it.p.liquidity?.usd ?? null),
        nowMs,
        WATCH_DAYS,
      ],
    );
    return res.rowCount ?? 0;
  } catch (e) {
    // Swallowed on purpose (discovery must go on), but not silently: a broken insert here would otherwise look like "nothing to note".
    console.warn(JSON.stringify({ msg: "lab watch note failed", error: String((e as Error)?.message ?? e).slice(0, 200) }));
    return 0;
  }
}
