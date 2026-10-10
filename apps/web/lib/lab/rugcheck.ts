/**
 * Who holds a coin, read from RugCheck's free report at the first look (laptop only; the hosted lab does not call it).
 *
 * RugCheck's report names the largest holders (20) with a flag for wallets linked to each other ("insiders"), the networks of linked
 * wallets and what they still hold, the liquidity lock, the creator, and a list of risks. One snapshot per coin is taken shortly after
 * the lab first sees it and kept as a row in lab_signals_ts (source "rugcheck"); the snapshot is a current state, so it is only ever
 * used for moments at or after it was taken (plus a short allowance for the very first look, like the other collected signals).
 *
 * Holder shares exclude the pool's own token accounts: the pool holds a large share of a fresh coin and says nothing about
 * concentration among people.
 */

import { fin, insertRows } from "./collectors";
import type { Queryable } from "./builder";

export interface RugRow {
  /** epoch seconds the snapshot was taken */
  at: number;
  /** RugCheck's normalised score (1 = best) */
  score: number | null;
  rugged: boolean;
  /** best liquidity lock over the coin's markets, 0..100 */
  lp: number | null;
  holders: number | null;
  /** liquidity in USD summed over its markets */
  liq: number | null;
  /** wallets that belong to an insider network, and the share of the supply those networks still hold (0..1) */
  ins: number | null;
  insPct: number | null;
  /** largest / top 5 / top 10 holders excluding pool and burn accounts, as fractions 0..1 (of the 20 RugCheck lists) */
  top1: number | null;
  top5: number | null;
  top10: number | null;
  risks: string[];
  mintOff: boolean | null;
  freezeOff: boolean | null;
}

export interface RugFeatures {
  rc_holders: number | null;
  rc_top1: number | null;
  rc_top10: number | null;
  rc_insider_pct: number | null;
  rc_insiders: number | null;
  rc_lp_locked: number | null;
  rc_risk_n: number | null;
  /** RugCheck lists "creator history of rugged tokens" among the risks */
  rc_creator_rugs: number | null;
}

const NONE: RugFeatures = { rc_holders: null, rc_top1: null, rc_top10: null, rc_insider_pct: null, rc_insiders: null, rc_lp_locked: null, rc_risk_n: null, rc_creator_rugs: null };
const BURN = new Set(["1nc1nerator11111111111111111111111111111111", "11111111111111111111111111111111"]);

/** Reduce RugCheck's long report to the row the lab keeps. null when the answer is not a report. */
export function rugSnapshot(r: any, nowS: number): RugRow | null {
  if (!r || typeof r !== "object" || !Array.isArray(r.topHolders)) return null;
  const markets = (Array.isArray(r.markets) ? r.markets : []) as Array<{ pubkey?: string; liquidityA?: string; liquidityB?: string; lp?: { lpLockedPct?: number } }>;
  const pool = new Set<string>(BURN);
  for (const m of markets) for (const a of [m.pubkey, m.liquidityA, m.liquidityB]) if (typeof a === "string") pool.add(a);
  const holders = (r.topHolders as Array<{ address?: string; owner?: string; pct?: number }>)
    .filter((h) => !(h.address && pool.has(h.address)) && !(h.owner && pool.has(h.owner)))
    .map((h) => (fin(h.pct) ?? 0) / 100)
    .sort((a, b) => b - a);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const supply = fin(r.token?.supply);
  const nets = ((Array.isArray(r.insiderNetworks) ? r.insiderNetworks : []) as Array<{ currentHolding?: number }>).reduce((a, n) => a + (fin(n.currentHolding) ?? 0), 0);
  const locks = markets.map((m) => fin(m.lp?.lpLockedPct)).filter((x): x is number => x != null);
  return {
    at: nowS,
    score: fin(r.score_normalised) ?? fin(r.score),
    rugged: r.rugged === true,
    lp: locks.length ? Math.max(...locks) : null,
    holders: fin(r.totalHolders),
    liq: fin(r.totalMarketLiquidity),
    ins: fin(r.graphInsidersDetected),
    insPct: supply && supply > 0 ? Math.min(1, nets / supply) : null,
    top1: holders.length ? holders[0]! : null,
    top5: holders.length ? sum(holders.slice(0, 5)) : null,
    top10: holders.length ? sum(holders.slice(0, 10)) : null,
    risks: ((Array.isArray(r.risks) ? r.risks : []) as Array<{ name?: string }>).map((x) => String(x.name ?? "risk")).slice(0, 12),
    mintOff: r.mintAuthority === undefined ? null : r.mintAuthority == null,
    freezeOff: r.freezeAuthority === undefined ? null : r.freezeAuthority == null,
  };
}

/** The first look is allowed to use a snapshot taken up to this long after it (the collector runs a few minutes behind discovery). */
const FIRST_LOOK_SLACK_S = 25 * 60;

/**
 * Holder facts as they stood at epoch second `t`: the latest snapshot taken at or before `t`. For the very first look (tau <= 0)
 * the earliest snapshot within 25 minutes after is accepted too, because the collector cannot be faster than the discovery.
 */
export function rugAt(rows: RugRow[] | undefined | null, t: number, tau: number): RugFeatures {
  if (!rows?.length) return NONE;
  let pick: RugRow | null = null;
  for (const r of rows) if (r.at <= t && (!pick || r.at > pick.at)) pick = r;
  if (!pick && tau <= 0) for (const r of rows) if (r.at <= t + FIRST_LOOK_SLACK_S && (!pick || r.at < pick.at)) pick = r;
  if (!pick) return NONE;
  return {
    rc_holders: pick.holders,
    rc_top1: pick.top1,
    rc_top10: pick.top10,
    rc_insider_pct: pick.insPct,
    rc_insiders: pick.ins,
    rc_lp_locked: pick.lp == null ? null : pick.lp / 100,
    rc_risk_n: pick.risks.length,
    rc_creator_rugs: pick.risks.some((r) => /creator history/i.test(r)) ? 1 : 0,
  };
}

let blockedUntil = 0;

async function fetchReport(mint: string): Promise<{ status: "ok"; json: any } | { status: "miss" | "limited" | "error" }> {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { headers: { accept: "application/json", "user-agent": "Aureus-Lab/1.0" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) return { status: "limited" };
    if (res.status === 404 || res.status === 400) return { status: "miss" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", json: await res.json() };
  } catch {
    return { status: "error" };
  }
}

/**
 * One snapshot per coin, newest coins first: the coins the lab first saw in the last 6 hours (watch list and the Radar's own) that
 * have no snapshot yet and whose pool holds at least $5K (an empty pool has nothing to say about holders). A coin RugCheck does not
 * know yet is tried again in 10 minutes, up to four times. At most `maxCalls` calls a round, 1.2 s apart; a 429 stops collecting for
 * 15 minutes. Does nothing on the hosted site.
 */
export async function collectRugcheck(db: Queryable, opts: { maxCalls?: number } = {}): Promise<{ tried: number; saved: number; missed: number; limited?: boolean } | { skipped: string }> {
  if (process.env.VERCEL) return { skipped: "hosted" };
  if (Date.now() < blockedUntil) return { skipped: "rate limited, waiting" };
  const { rows } = await db.query(
    `SELECT m.mint,
            (SELECT (s.payload->>'liq')::float8 FROM lab_signals_ts s WHERE s.mint = m.mint AND s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.taken_at DESC LIMIT 1) AS liq,
            (SELECT first_liq FROM lab_coins c WHERE c.mint = m.mint) AS first_liq
       FROM (
         SELECT mint, first_seen_at FROM lab_watch WHERE active AND first_seen_at > now() - interval '6 hours'
         UNION
         SELECT mint, first_seen_at FROM lab_coins WHERE first_seen_at > now() - interval '6 hours'
       ) m
      WHERE NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = m.mint AND s.source = 'rugcheck')
        AND NOT EXISTS (SELECT 1 FROM lab_signals_ts s WHERE s.mint = m.mint AND s.source = 'rugcheck_miss' AND s.taken_at > now() - interval '10 minutes')
        AND (SELECT count(*) FROM lab_signals_ts s WHERE s.mint = m.mint AND s.source = 'rugcheck_miss') < 4
      ORDER BY m.first_seen_at DESC LIMIT 80`,
  ).catch(() => ({ rows: [] as any[] }));
  const todo = rows.filter((r) => (fin(r.liq) ?? fin(r.first_liq) ?? 0) >= 5_000).slice(0, opts.maxCalls ?? 8);
  const out: Array<{ mint: string; source: string; payload: unknown }> = [];
  let missed = 0;
  let limited = false;
  for (const r of todo) {
    const res = await fetchReport(r.mint);
    if (res.status === "limited") {
      blockedUntil = Date.now() + 15 * 60_000;
      limited = true;
      break;
    }
    if (res.status === "ok") {
      const snap = rugSnapshot(res.json, Date.now() / 1000);
      if (snap) {
        out.push({ mint: r.mint, source: "rugcheck", payload: snap });
      } else {
        out.push({ mint: r.mint, source: "rugcheck_miss", payload: {} });
        missed++;
      }
    } else if (res.status === "miss") {
      out.push({ mint: r.mint, source: "rugcheck_miss", payload: {} });
      missed++;
    }
    await new Promise((s) => setTimeout(s, 1_200));
  }
  await insertRows(db, out).catch(() => undefined);
  return { tried: todo.length, saved: out.filter((o) => o.source === "rugcheck").length, missed, ...(limited ? { limited } : {}) };
}
