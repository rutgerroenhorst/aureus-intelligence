/**
 * Which first-look features of a pump.fun graduation go with holding 2x within a day, and with being down by half after a day? (docs/FILTER_FEEDBACK.md; the sequel of scripts/lab-graduate-audit.ts)
 *
 *   corepack pnpm exec tsx scripts/lab-graduate-features.ts [--min-liq 5000]
 *
 * Read-only, laptop database. WRITTEN DOWN BEFORE LOOKING (2026-10-16): population = every graduation the laptop's stream recorded (table pump_graduates, via 'stream') whose first pool reading was at least $5,000
 * (a coin a person could buy) and whose window is over (first reading + 25 h <= the latest reading, or the start of a gap of more than 6 hours in everybody's readings, whichever comes first). Outcomes: held2 = the highest level the price HELD (half an hour, several readings: lib/lab/paths heldPeak)
 * within 24 h of the first reading is at least 2x the first price; half24 = the last clean reading 22-26 h after the first one (else the last before) is at most 0.5x the first price (a coin that stopped being read is judged
 * by its last reading). Features: the lab's first snapshot of the coin (lab_coins, lane graduate: pool, market cap, trades, volume, buy share, price change since the graduation, RugCheck, social links, paid profile) and the
 * stream's own launch facts (creator's first buy in SOL, minutes from launch to graduation, creator's launches in 72 h). Cuts: terciles of the population. Stability: the same low-minus-high difference in the earlier and the
 * later half by first-reading time. About 19 features x 2 outcomes are a lot of looks: only a large difference (15 points or more) with the same sign in both halves counts, and nothing here is an entry filter until it holds
 * on graduations that come later (the forward test in docs/FILTER_FEEDBACK.md).
 */
import pg from "pg";
import { cleanObs, heldPeak, type Obs } from "../apps/web/lib/lab/paths";
import { fisherExact, wilson } from "../apps/web/lib/lab/stats";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const MIN_LIQ = Number(arg("min-liq", "5000"));
const H = 3600;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const grads = (await pool.query(`SELECT mint, EXTRACT(EPOCH FROM migrated_at)::float8 AS migrated_s, create_to_migrate_min, initial_buy_sol, creator_launches_72h FROM pump_graduates WHERE via = 'stream' AND migrated_at < now() - interval '26 hours' ORDER BY migrated_at`)).rows;
const lab = new Map<string, Record<string, number | null>>();
for (const r of (await pool.query(`SELECT mint, snaps->0->'f' AS f FROM lab_coins WHERE lane = 'graduate'`)).rows) lab.set(r.mint, r.f ?? {});
const reads = new Map<string, Array<{ t: number; p: number | null; liq: number | null }>>();
for (let i = 0; i < grads.length; i += 200) {
  const ms = grads.slice(i, i + 200).map((g) => g.mint as string);
  const r = await pool.query(`SELECT s.mint, EXTRACT(EPOCH FROM s.taken_at)::float8 AS t, (s.payload->>'p')::float8 AS p, (s.payload->>'liq')::float8 AS liq FROM lab_signals_ts s WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL AND s.mint = ANY($1::text[]) ORDER BY s.mint, s.taken_at`, [ms]);
  for (const x of r.rows) (reads.get(x.mint) ?? reads.set(x.mint, []).get(x.mint)!).push({ t: x.t, p: num(x.p), liq: num(x.liq) });
}
await pool.end();
const latest = Math.max(...[...reads.values()].map((a) => a[a.length - 1]!.t));

/** The lab's daemon stops now and then (the laptop sleeps, restarts): a window is over only if the readings were running throughout it. A gap of more than 6 hours in everybody's readings ends the horizon for coins that started before it. */
function horizonFor(allTimes: number[], latest: number): (t0: number) => number {
  const ts = [...allTimes].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) if (ts[i]! - ts[i - 1]! > 6 * 3600) gaps.push(ts[i - 1]!);
  return (t0) => gaps.find((g) => g >= t0) ?? latest;
}
const horizon = horizonFor([...reads.values()].flatMap((a) => a.map((r) => r.t)), latest);
interface Rec { t0: number; held2: boolean; half24: boolean; f: Record<string, number | null> }
const recs: Rec[] = [];
for (const g of grads) {
  const rs = reads.get(g.mint) ?? [];
  const { clean } = cleanObs(rs.filter((r) => r.p != null && r.p > 0).map((r): Obs => ({ t: r.t, p: r.p!, liq: r.liq })));
  if (clean.length < 3 || (rs[0]!.liq ?? 0) < MIN_LIQ) continue;
  const t0 = clean[0]!.t;
  if (t0 + 25 * H > horizon(t0)) continue;
  const hp = heldPeak(clean, "auto", 0, t0 + 24 * H);
  const at24 = clean.filter((o) => o.t - t0 >= 22 * H && o.t - t0 <= 26 * H).at(-1) ?? clean.filter((o) => o.t - t0 < 22 * H).at(-1)!;
  const f = { ...(lab.get(g.mint) ?? {}) } as Record<string, number | null>;
  f.dev_buy_sol = num(g.initial_buy_sol);
  f.grad_minutes = num(g.create_to_migrate_min);
  f.creator_launches = num(g.creator_launches_72h);
  recs.push({ t0, held2: (hp ? hp.level / clean[0]!.p : 0) >= 2, half24: at24.p / clean[0]!.p <= 0.5, f });
}
const tMid = [...recs.map((r) => r.t0)].sort((a, b) => a - b)[Math.floor(recs.length / 2)]!;
const pct = (k: number, n: number) => (n ? `${String(k).padStart(3)}/${String(n).padStart(3)} ${((100 * k) / n).toFixed(1).padStart(5)}% [${(100 * wilson(k, n).lo).toFixed(0)}-${(100 * wilson(k, n).hi).toFixed(0)}]` : "-");
const rate = (a: Rec[], k: "held2" | "half24") => pct(a.filter((r) => r[k]).length, a.length);
console.log(`${recs.length} graduations with a first pool of at least $${MIN_LIQ} and a window that is over; held 2x ${rate(recs, "held2")}; down by half after a day ${rate(recs, "half24")}`);

const FEATURES = ["liq", "mcap", "liq_mcap", "trades_h1", "vol_h1", "vol_liq_h1", "buy_share_h1", "pc_h1", "dev_buy_sol", "grad_minutes", "creator_launches", "dev_mints", "rc_top1", "rc_top10", "rc_insider_pct", "rc_holders", "has_social", "paid_profile"];
const ranked: Array<{ key: string; out: "held2" | "half24"; p: number; diff: number; halves: string }> = [];
for (const key of FEATURES) {
  const vals = recs.filter((r) => r.f[key] != null);
  if (vals.length < 150) continue;
  const vs = vals.map((r) => r.f[key]!).sort((a, b) => a - b);
  const uniq = [...new Set(vs)];
  const groups: Array<[string, Rec[]]> =
    uniq.length <= 3
      ? uniq.map((u) => [`= ${u}`, vals.filter((r) => r.f[key] === u)] as [string, Rec[]])
      : (() => {
          const q1 = vs[Math.floor(vs.length / 3)]!, q2 = vs[Math.floor((2 * vs.length) / 3)]!;
          return [
            [`< ${q1.toPrecision(4)}`, vals.filter((r) => r.f[key]! < q1)],
            [`${q1.toPrecision(4)} - ${q2.toPrecision(4)}`, vals.filter((r) => r.f[key]! >= q1 && r.f[key]! < q2)],
            [`>= ${q2.toPrecision(4)}`, vals.filter((r) => r.f[key]! >= q2)],
          ] as Array<[string, Rec[]]>;
        })();
  const g = groups.filter(([, a]) => a.length >= 20);
  if (g.length < 2) continue;
  console.log(`\n${key} (n=${vals.length})`);
  for (const [name, a] of g) console.log(`   ${name.padEnd(22)} held 2x ${rate(a, "held2")}   down by half ${rate(a, "half24")}`);
  const lo = g[0]![1], hi = g[g.length - 1]![1];
  for (const out of ["held2", "half24"] as const) {
    const a = lo.filter((r) => r[out]).length, b = lo.length - a, c = hi.filter((r) => r[out]).length, d = hi.length - c;
    const dif = (sel: (r: Rec) => boolean) => {
      const l = lo.filter(sel), h = hi.filter(sel);
      return l.length >= 10 && h.length >= 10 ? 100 * (l.filter((r) => r[out]).length / l.length - h.filter((r) => r[out]).length / h.length) : null;
    };
    const e = dif((r) => r.t0 < tMid), l2 = dif((r) => r.t0 >= tMid);
    ranked.push({ key, out, p: fisherExact(a, b, c, d), diff: 100 * (a / lo.length - c / hi.length), halves: `${e == null ? "-" : e.toFixed(0)} / ${l2 == null ? "-" : l2.toFixed(0)}` });
  }
}
console.log("\n== ranked by Fisher p (first group minus last group, in points; the same difference in the earlier / later half)");
for (const r of ranked.sort((a, b) => a.p - b.p).slice(0, 14)) console.log(`${r.key.padEnd(18)} ${r.out.padEnd(7)} p=${r.p.toFixed(4)}  ${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)} pts   halves ${r.halves}`);
