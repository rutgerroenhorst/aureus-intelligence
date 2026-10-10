/**
 * What is known about a coin that does not change minute to minute, and what the coin's team paid for.
 *
 *  - DexScreener "orders": a paid token profile, boosts (with amounts), ads and community takeovers, each with the time it was
 *    paid. Available for any coin, old or new, so it can be filled in for the whole history and read AS OF a given moment.
 *  - Jupiter: the launchpad the coin came from (static) and how many coins its developer has launched (only meaningful for
 *    coins first seen now: for an older coin the count would include coins launched after it).
 *
 * One row per coin in lab_signals_ts (source "static"). Free and keyless; DexScreener allows 60 order lookups a minute.
 */

import { fin, getJson, insertRows } from "./collectors";
import type { Queryable } from "./builder";

export interface StaticRow {
  /** launchpad name as Jupiter reports it ("pump.fun", "stonkfun", "bags.fun", "met-dbc", ...) */
  lp: string | null;
  /** coins the developer has launched / migrated to a DEX; null for coins that were not new when checked */
  dm: number | null;
  dg: number | null;
  /** epoch seconds the token profile was paid, null = never */
  prof: number | null;
  /** epoch seconds of a community takeover, null = none */
  cto: number | null;
  ads: number[];
  /** boosts as [epoch seconds, amount] */
  bo: Array<[number, number]>;
  /** epoch seconds this row was written */
  at: number;
}

export interface StaticFeatures {
  lp_pump: number | null;
  lp_other: number | null;
  dev_mints: number | null;
  dev_serial: number | null;
  paid_profile: number | null;
  profile_delay_min: number | null;
  boost_amount: number | null;
  boost_n: number | null;
  cto: number | null;
  ad_n: number | null;
}

const NONE: StaticFeatures = { lp_pump: null, lp_other: null, dev_mints: null, dev_serial: null, paid_profile: null, profile_delay_min: null, boost_amount: null, boost_n: null, cto: null, ad_n: null };

/** The row's facts as they stood at epoch second `t` (nothing paid after `t` is counted). `pairCreatedS` = when the pair was created. */
export function staticsAt(row: StaticRow | null | undefined, t: number, pairCreatedS: number | null): StaticFeatures {
  if (!row) return NONE;
  const paid = row.prof != null && row.prof <= t;
  const boosts = row.bo.filter((b) => b[0] <= t);
  return {
    lp_pump: row.lp ? (row.lp === "pump.fun" ? 1 : 0) : null,
    lp_other: row.lp ? (row.lp !== "pump.fun" ? 1 : 0) : null,
    dev_mints: row.dm,
    dev_serial: row.dm != null ? (row.dm >= 5 ? 1 : 0) : null,
    paid_profile: paid ? 1 : 0,
    profile_delay_min: paid && pairCreatedS ? (row.prof! - pairCreatedS) / 60 : null,
    boost_amount: boosts.reduce((a, b) => a + b[1], 0),
    boost_n: boosts.length,
    cto: row.cto != null && row.cto <= t ? 1 : 0,
    ad_n: row.ads.filter((a) => a <= t).length,
  };
}

/** DexScreener orders for one coin; null when the call failed (try again later). */
export async function fetchOrders(mint: string): Promise<Pick<StaticRow, "prof" | "cto" | "ads" | "bo"> | null> {
  const j = await getJson(`https://api.dexscreener.com/orders/v1/solana/${mint}`, {}, 15_000, 1);
  if (!j || typeof j !== "object") return null;
  const approved = ((j.orders ?? []) as Array<{ type?: string; status?: string; paymentTimestamp?: number }>).filter((o) => o.status === "approved" && fin(o.paymentTimestamp) != null);
  const secs = (o: { paymentTimestamp?: number }) => o.paymentTimestamp! / 1000;
  const profile = approved.filter((o) => o.type === "tokenProfile").map(secs);
  const cto = approved.filter((o) => o.type === "communityTakeover").map(secs);
  return {
    prof: profile.length ? Math.min(...profile) : null,
    cto: cto.length ? Math.min(...cto) : null,
    ads: approved.filter((o) => /ad/i.test(o.type ?? "")).map(secs),
    bo: ((j.boosts ?? []) as Array<{ amount?: number; paymentTimestamp?: number }>).filter((b) => fin(b.paymentTimestamp) != null).map((b) => [b.paymentTimestamp! / 1000, fin(b.amount) ?? 0] as [number, number]),
  };
}

/** Launchpad and developer facts from Jupiter, 50 mints a call. */
export async function fetchJupiterStatic(mints: string[]): Promise<Map<string, { lp: string | null; dm: number | null; dg: number | null }>> {
  const out = new Map<string, { lp: string | null; dm: number | null; dg: number | null }>();
  for (let i = 0; i < mints.length; i += 50) {
    const json = await getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 50).join(",")}`);
    if (!Array.isArray(json)) continue;
    for (const t of json) if (t?.id) out.set(t.id, { lp: t.launchpad ?? null, dm: fin(t.audit?.devMints), dg: fin(t.audit?.devMigrations) });
  }
  return out;
}

/**
 * Fill in the coins that have no static row yet, newest first: at most `maxOrders` order lookups (one per second, DexScreener's
 * limit is 60 a minute) and the Jupiter facts for the same coins. Developer counts are kept only for coins that are still new.
 */
export async function collectStatic(db: Queryable, opts: { maxOrders?: number } = {}): Promise<{ coins: number; saved: number; failed: number }> {
  const { rows } = await db.query(
    `SELECT m.mint, EXTRACT(EPOCH FROM m.first_seen_at)::float8 AS seen FROM (
       SELECT mint, first_seen_at FROM lab_coins UNION SELECT mint, first_seen_at FROM lab_watch WHERE active
     ) m
      WHERE NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = m.mint AND s.source = 'static')
      ORDER BY m.first_seen_at DESC LIMIT $1`,
    [opts.maxOrders ?? 20],
  );
  if (!rows.length) return { coins: 0, saved: 0, failed: 0 };
  const jup = await fetchJupiterStatic(rows.map((r) => r.mint));
  const now = Date.now() / 1000;
  const out: Array<{ mint: string; source: string; payload: unknown }> = [];
  let failed = 0;
  for (const r of rows) {
    const o = await fetchOrders(r.mint);
    if (!o) {
      failed++;
    } else {
      const j = jup.get(r.mint);
      const fresh = now - r.seen < 6 * 3600;
      const row: StaticRow = { lp: j?.lp ?? null, dm: fresh ? j?.dm ?? null : null, dg: fresh ? j?.dg ?? null : null, ...o, at: now };
      out.push({ mint: r.mint, source: "static", payload: row });
    }
    await new Promise((res) => setTimeout(res, 1_100));
  }
  await insertRows(db, out);
  return { coins: rows.length, saved: out.length, failed };
}
