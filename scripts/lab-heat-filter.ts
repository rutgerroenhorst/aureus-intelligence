/**
 * Which first-look features of a Radar coin go with a better or a worse result of the exit plan, and do they hold in both halves of the time? (docs/FILTER_FEEDBACK.md)
 *
 *   corepack pnpm exec tsx scripts/lab-heat-filter.ts [--lane fresh|graduate]
 *
 * Read-only, laptop database. WRITTEN DOWN BEFORE LOOKING (2026-10-16): population = the lab coins of the lane (default `fresh`, the Radar's coins, first look at a pool age of about 1.3 h) whose 72-hour window was over
 * ("decided": the lab labelled them, so a recent cohort of dead coins cannot leak in); outcome = the lab's `ev` (the result of the current exit plan from the first look, a multiple of the stake), plus the share that held 2x
 * and the share that lost half within a day. Features = a fixed list; cuts = terciles of the population; stability = the same high-minus-low difference in the earlier and the later half by first-seen time.
 * After the single features, FOUR fixed combinations are tested (chosen from the single features before the halves were looked at): a feature that matters must show the same sign in both halves.
 * 18 single comparisons are a lot of looks: a difference counts only when it is large (0.15x or more) and has the same sign in both halves. Nothing here is a verdict on a coin, only on groups.
 */
import pg from "pg";
import { bootMeanCi } from "../apps/web/lib/lab/stats";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const LANE = arg("lane", "fresh");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });
interface Coin { t: number; f: Record<string, number | null>; y: { ev: number | null; go2: boolean | null; collapse24: boolean | null } }
const rows: Coin[] = (
  await pool.query(`SELECT EXTRACT(EPOCH FROM first_seen_at)::float8 AS t, snaps->0->'f' AS f, snaps->0->'y' AS y FROM lab_coins WHERE lane = $1 AND snaps->0->'y'->>'ev' IS NOT NULL`, [LANE])
).rows;
await pool.end();
const tMid = [...rows.map((r) => r.t)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]!;
const ev = (a: Coin[]) => a.map((r) => r.y.ev!).filter((x) => Number.isFinite(x));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function show(a: Coin[]): string {
  if (!a.length) return "-";
  const e = ev(a);
  const ci = bootMeanCi(e);
  const go2 = a.filter((r) => r.y.go2).length;
  const col = a.filter((r) => r.y.collapse24).length;
  return `n=${String(a.length).padStart(4)}  result ${mean(e).toFixed(2)}x [${ci.lo.toFixed(2)}-${ci.hi.toFixed(2)}]  held 2x ${((100 * go2) / a.length).toFixed(1)}%  lost half in a day ${((100 * col) / a.length).toFixed(1)}%`;
}
console.log(`lane ${LANE}: ${rows.length} coins with a decided 72 h window; halves split at the median first-seen time`);
console.log("ALL                ", show(rows));

const FEATURES: Array<[string, string]> = [
  ["trades_h1", "trades in the last hour"],
  ["vol_h1", "volume in the last hour"],
  ["vol_liq_h1", "volume / liquidity, 1 h"],
  ["pc_h24", "price change 24 h"],
  ["liq_mcap", "liquidity / market cap"],
  ["mcap", "market cap"],
  ["liq", "liquidity"],
  ["pair_age_h", "pool age (hours)"],
  ["buy_share_h1", "buy share, 1 h"],
  ["creator_launches", "creator's launches (72 h)"],
  ["dev_buy_sol", "creator's first buy (SOL)"],
  ["rc_top10", "top 10 holders (RugCheck)"],
  ["rc_holders", "holders (RugCheck)"],
];
const edges = new Map<string, [number, number]>();
for (const [key, label] of FEATURES) {
  const vals = rows.filter((r) => r.f[key] != null);
  if (vals.length < 150) continue;
  const vs = vals.map((r) => r.f[key]!).sort((a, b) => a - b);
  const q1 = vs[Math.floor(vs.length / 3)]!;
  const q2 = vs[Math.floor((2 * vs.length) / 3)]!;
  if (q1 === q2) continue;
  edges.set(key, [q1, q2]);
  const lo = vals.filter((r) => r.f[key]! < q1);
  const mid = vals.filter((r) => r.f[key]! >= q1 && r.f[key]! < q2);
  const hi = vals.filter((r) => r.f[key]! >= q2);
  console.log(`\n${label} (n=${vals.length}; cuts ${q1.toPrecision(4)} / ${q2.toPrecision(4)})`);
  console.log("   low ", show(lo));
  console.log("   mid ", show(mid));
  console.log("   high", show(hi));
  const half = (sel: (r: Coin) => boolean) => {
    const l = lo.filter(sel), h = hi.filter(sel);
    return l.length >= 15 && h.length >= 15 ? `${(mean(ev(h)) - mean(ev(l))).toFixed(2).replace(/^(\d)/, "+$1")}x (n ${h.length}/${l.length})` : "thin";
  };
  console.log(`   high minus low:  earlier half ${half((r) => r.t < tMid)}   later half ${half((r) => r.t >= tMid)}`);
}
const E = (k: string) => edges.get(k);
const lt = (k: string, which: 0 | 1, r: Coin) => r.f[k] != null && E(k) != null && r.f[k]! < E(k)![which];
const ge = (k: string, which: 0 | 1, r: Coin) => r.f[k] != null && E(k) != null && r.f[k]! >= E(k)![which];
const RULES: Array<[string, (r: Coin) => boolean]> = [
  ["not hot: trades in the last hour below the top third", (r) => lt("trades_h1", 1, r)],
  ["quiet: trades in the last hour in the bottom third", (r) => lt("trades_h1", 0, r)],
  ["not hot AND a deep pool (liquidity / market cap in the top two thirds)", (r) => lt("trades_h1", 1, r) && ge("liq_mcap", 0, r)],
  ["not hot AND deep AND market cap below the top third", (r) => lt("trades_h1", 1, r) && ge("liq_mcap", 0, r) && lt("mcap", 1, r)],
];
console.log("\n== four fixed combinations (pass vs fail, then the same in each half)");
for (const [name, fn] of RULES) {
  const pass = rows.filter(fn), fail = rows.filter((r) => !fn(r));
  console.log(`\n${name}\n   pass ${show(pass)}\n   fail ${show(fail)}`);
  const d = (sel: (r: Coin) => boolean) => {
    const p = pass.filter(sel), f = fail.filter(sel);
    return p.length >= 20 && f.length >= 20 ? `${(mean(ev(p)) - mean(ev(f))).toFixed(2).replace(/^(\d)/, "+$1")}x (n ${p.length}/${f.length})` : "thin";
  };
  console.log(`   pass minus fail: earlier half ${d((r) => r.t < tMid)}   later half ${d((r) => r.t >= tMid)}`);
}
