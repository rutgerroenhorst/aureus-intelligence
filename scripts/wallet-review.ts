/**
 * Review of the user's own entries (from the followed wallet) against what the system knew and what the coins did afterwards.
 *
 *   corepack pnpm exec tsx scripts/wallet-review.ts [--since 2026-09-20] [--json path] [--live 0]
 *
 * Reads only. The wallet address is never selected, printed or written. For every coin first bought since the given day:
 *   - what the user put in, took out and still holds (valued at DexScreener's price now; 0 for a coin that is no longer listed or whose
 *     pool is under $1,000), and the result as a multiple of the money put in
 *   - when the system first saw the coin, how long before the buy that was, the verdict it had given by then, the tabs that had listed it
 *     (coin_qualifications only exists since 2026-10-09), the pool's age and the coin's size at the buy
 *   - what the price did after the buy, from the readings the scanner and the lab took (held peak within 72 h, lowest in 24 h)
 * Then the questions that matter for the system, each with its sample size and an interval (never a verdict on fewer than 30):
 *   Q1 which share of the coins was known to the system before the buy (the user's guess was about 80%)
 *   Q2 how the coins ended, by what the system had said about them
 *   Q3 timing and size at the buy
 *   Q4 whether the entries beat the lab's other coins at the same age (same definitions as the "do the tabs add anything" report)
 *   Q5 how much of the result is a handful of coins (outliers are opened first)
 */
import fs from "node:fs";
import pg from "pg";
import { loadLabCoins, loadObs, selectCandidates, selectWatch, type CandRow, type LabCoin } from "../apps/web/lib/lab/builder";
import { cleanObs, heldPeak, type Obs } from "../apps/web/lib/lab/paths";
import { bootMeanCi, fisherExact, median, wilson } from "../apps/web/lib/lab/stats";
import { group, rowsFor, type Row } from "../apps/web/lib/lab/reports/common";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const SINCE = arg("since", "2026-09-20");
const JSON_OUT = arg("json", "");
const LIVE = arg("live", "1") !== "0";
const CANDLES = arg("candles", "");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });

const H = 3600;
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Rec {
  mint: string;
  symbol: string;
  /** the pool the coin trades in (DexScreener's best pair now, else the scanner's pool): where hourly candles are fetched from */
  pool: string | null;
  firstBuy: number;
  nBuys: number;
  nSells: number;
  usdIn: number;
  usdOut: number;
  /** tokens bought in all (hold-everything valuation) */
  tokIn: number;
  held: number;
  pBuy: number;
  /** first time the system had the coin (tokens / candidates / lab), epoch s */
  seenAt: number | null;
  lagMin: number | null;
  lane: string | null;
  state: string | null;
  verdict: string | null;
  verdictFamily: string | null;
  verdictMcap: number | null;
  tabs: string[];
  poolAgeH: number | null;
  mcapBuy: number | null;
  priceNow: number | null;
  liqNow: number | null;
  valueNow: number;
  listed: boolean;
  mult: number;
  /** what the price did after the buy (readings after the buy only); null when the coin was not followed afterwards */
  path: { coverageH: number; peak72: number | null; min24: number | null; final: number | null } | null;
  /** how many coins the user bought in the two hours around this one */
  session: number;
}

async function liveInfo(mints: string[]): Promise<Map<string, { price: number; liq: number; pair: string | null }>> {
  const out = new Map<string, { price: number; liq: number; pair: string | null }>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (res.status === 429) {
          await sleep(4_000 * (attempt + 1));
          continue;
        }
        if (!res.ok) break;
        const list = (await res.json()) as any[];
        for (const p of Array.isArray(list) ? list : []) {
          const m = p?.baseToken?.address as string | undefined;
          const price = num(p?.priceUsd);
          const liq = num(p?.liquidity?.usd) ?? 0;
          if (!m || price == null || price <= 0) continue;
          const cur = out.get(m);
          if (!cur || liq > cur.liq) out.set(m, { price, liq, pair: (p?.pairAddress as string | undefined) ?? null });
        }
        break;
      } catch {
        await sleep(2_000);
      }
    }
    await sleep(400);
  }
  return out;
}

const pc = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}% (${k}/${n})` : "-");
const money = (x: number) => `$${x.toFixed(1)}`;
const x2 = (x: number | null) => (x == null ? "  -" : x >= 10 ? x.toFixed(0) + "x" : x.toFixed(2) + "x");
function wl(k: number, n: number) {
  if (!n) return "-";
  const w = wilson(k, n);
  return `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}-${(100 * w.hi).toFixed(0)}] n=${n}`;
}

async function main() {
  const sinceEpoch = Date.parse(`${SINCE}T00:00:00Z`) / 1000;
  // ---- 1. what the wallet did, per coin
  const fills = (
    await pool.query(
      `SELECT mint,
              EXTRACT(EPOCH FROM min(t) FILTER (WHERE side = 'buy'))::float8 AS first_buy,
              count(*) FILTER (WHERE side = 'buy')::int AS n_buys, count(*) FILTER (WHERE side = 'sell')::int AS n_sells,
              COALESCE(sum(usd) FILTER (WHERE side = 'buy'), 0)::float8 AS usd_in, COALESCE(sum(usd) FILTER (WHERE side = 'sell'), 0)::float8 AS usd_out,
              COALESCE(sum(tokens) FILTER (WHERE side = 'buy'), 0)::float8 AS tok_in, COALESCE(sum(tokens) FILTER (WHERE side = 'sell'), 0)::float8 AS tok_out
         FROM wallet_fills GROUP BY mint HAVING count(*) FILTER (WHERE side = 'buy') > 0 AND sum(usd) FILTER (WHERE side = 'buy') > 0`,
    )
  ).rows;
  const firstPrice = new Map<string, number>(
    (await pool.query(`SELECT DISTINCT ON (mint) mint, (usd / NULLIF(tokens, 0))::float8 AS p FROM wallet_fills WHERE side = 'buy' AND usd > 0 AND tokens > 0 ORDER BY mint, t`)).rows.map((r) => [r.mint as string, Number(r.p)]),
  );
  const recent = fills.filter((f) => f.first_buy >= sinceEpoch);
  const mints = recent.map((f) => f.mint as string);
  console.log(`since ${SINCE}: ${recent.length} coins first bought (all time: ${fills.length})`);

  // ---- 2. what the system knew
  const sys = new Map<string, { seenAt: number | null; cid: string | null; state: string | null; symbol: string | null; poolCreated: number | null; poolAddress: string | null }>();
  for (const r of (
    await pool.query(
      // NB: candidates.discovered_at is the moment the POOL was created (the scanner copies the pair's age into it), not the moment the
      // system saw the coin. The moment the system first had the coin is tokens.first_seen_at (= candidates.created_at).
      `SELECT DISTINCT ON (t.mint) t.mint, t.symbol_label AS symbol, EXTRACT(EPOCH FROM t.first_seen_at)::float8 AS tok_seen, c.id AS cid,
              c.current_state::text AS state, EXTRACT(EPOCH FROM p.created_at_src)::float8 AS pool_created, p.pool_address AS pool_address
         FROM tokens t LEFT JOIN candidates c ON c.token_id = t.id LEFT JOIN pools p ON p.id = c.pool_id
        WHERE t.mint = ANY($1::text[]) ORDER BY t.mint, c.created_at NULLS LAST`,
      [mints],
    )
  ).rows)
    sys.set(r.mint, { seenAt: r.tok_seen, cid: r.cid, state: r.state, symbol: r.symbol, poolCreated: r.pool_created, poolAddress: r.pool_address ?? null });
  const lab = new Map<string, LabCoin>((await loadLabCoins(pool as never)).map((c) => [c.mint, c]));
  const verdicts = new Map<string, Array<{ t: number; verdict: string; family: string | null; mcap: number | null }>>();
  const cids = [...sys.values()].map((s) => s.cid).filter((x): x is string => !!x);
  for (const r of (await pool.query(`SELECT candidate_id, verdict, reason_family, EXTRACT(EPOCH FROM decided_at)::float8 AS t, market_cap_usd::float8 AS mcap FROM candidate_verdicts WHERE candidate_id = ANY($1::uuid[]) ORDER BY decided_at`, [cids])).rows) {
    const a = verdicts.get(r.candidate_id) ?? [];
    a.push({ t: r.t, verdict: r.verdict, family: r.reason_family, mcap: r.mcap });
    verdicts.set(r.candidate_id, a);
  }
  const quals = new Map<string, Array<{ tab: string; t: number }>>();
  for (const r of (await pool.query(`SELECT mint, tab_name, EXTRACT(EPOCH FROM qualified_at)::float8 AS t FROM coin_qualifications WHERE mint = ANY($1::text[])`, [mints])).rows) {
    const a = quals.get(r.mint) ?? [];
    a.push({ tab: r.tab_name, t: r.t });
    quals.set(r.mint, a);
  }
  const journal = new Map<string, { symbol: string | null; entryMcap: number | null }>(
    (await pool.query(`SELECT DISTINCT ON (mint) mint, symbol, entry_mcap_usd::float8 AS m FROM my_trades WHERE mint = ANY($1::text[]) ORDER BY mint, entered_at`, [mints])).rows.map((r) => [r.mint as string, { symbol: r.symbol as string | null, entryMcap: r.m as number | null }]),
  );

  // ---- 3. what the price did after the buy
  const cand = await selectCandidates(pool as never, { limit: 100_000, all: true, mints });
  const watch = await selectWatch(pool as never, { limit: 100_000, all: true, mints });
  const rows: CandRow[] = [...cand, ...watch];
  const obsBy = await loadObs(pool as never, rows);
  const poolOf = new Map(rows.map((r) => [r.mint, r.pool_id]));

  // ---- 4. the price now
  const live = LIVE ? await liveInfo(mints) : new Map<string, { price: number; liq: number; pair: string | null }>();

  // ---- 5. put it together
  const times = recent.map((f) => f.first_buy as number).sort((a, b) => a - b);
  const recs: Rec[] = [];
  for (const f of recent) {
    const mint = f.mint as string;
    const s = sys.get(mint);
    const l = lab.get(mint);
    const seenAt = [s?.seenAt, l?.firstSeenAt].filter((x): x is number => x != null && Number.isFinite(x));
    const seen = seenAt.length ? Math.min(...seenAt) : null;
    const tb = f.first_buy as number;
    const vs = s?.cid ? verdicts.get(s.cid) ?? [] : [];
    const vb = [...vs].reverse().find((v) => v.t <= tb) ?? null;
    const tabs = [...new Set((quals.get(mint) ?? []).filter((q) => q.t <= tb).map((q) => q.tab))];
    const poolCreated = s?.poolCreated ?? l?.pairCreatedAt ?? null;
    const held = Math.max(0, f.tok_in - f.tok_out);
    const lv = live.get(mint);
    const valueNow = held > 0 && lv && lv.liq >= 1_000 ? held * lv.price : 0;
    const pBuy = firstPrice.get(mint) ?? NaN;
    // path after the buy
    let path: Rec["path"] = null;
    const pid = poolOf.get(mint);
    const raw = pid ? obsBy.get(pid) : undefined;
    if (raw && raw.length && Number.isFinite(pBuy) && pBuy > 0) {
      const after = cleanObs(raw as Obs[]).clean.filter((o) => o.t >= tb - 120);
      if (after.length >= 2) {
        const upTo = (h: number) => after.filter((o) => o.t <= tb + h * H);
        const hp = heldPeak(after, "auto", 0, tb + 72 * H);
        const w24 = upTo(24);
        path = {
          coverageH: (after[after.length - 1]!.t - tb) / H,
          peak72: hp ? hp.level / pBuy : null,
          min24: w24.length ? Math.min(...w24.map((o) => o.p)) / pBuy : null,
          final: after[after.length - 1]!.p / pBuy,
        };
      }
    }
    recs.push({
      mint,
      pool: lv?.pair ?? s?.poolAddress ?? null,
      symbol: (journal.get(mint)?.symbol ?? s?.symbol ?? l?.symbol ?? "?").slice(0, 14),
      firstBuy: tb,
      nBuys: f.n_buys,
      nSells: f.n_sells,
      usdIn: f.usd_in,
      usdOut: f.usd_out,
      tokIn: f.tok_in,
      held,
      pBuy,
      seenAt: seen,
      lagMin: seen == null ? null : (tb - seen) / 60,
      lane: l?.lane ?? null,
      state: s?.state ?? null,
      verdict: vb?.verdict ?? null,
      verdictFamily: vb?.family ?? null,
      verdictMcap: vb?.mcap ?? null,
      tabs,
      poolAgeH: poolCreated != null ? (tb - poolCreated) / H : null,
      mcapBuy: journal.get(mint)?.entryMcap ?? null,
      priceNow: lv?.price ?? null,
      liqNow: lv?.liq ?? null,
      valueNow,
      listed: !!lv && lv.liq >= 1_000,
      mult: (f.usd_out + valueNow) / f.usd_in,
      path,
      session: times.filter((t) => Math.abs(t - tb) <= 2 * H).length,
    });
  }
  recs.sort((a, b) => a.firstBuy - b.firstBuy);

  // ---------------------------------------------------------------- output
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  console.log("\n=== per coin (time UTC, in/out/now in USD, result as multiple of the money put in; lag = minutes between the system's first sight and the buy, negative = the system saw it only after)");
  console.log("when        symbol         in    out   now   mult  lag(min) pool-age  mcap@buy   verdict@buy                      tabs   peak72 min24 follow");
  for (const r of recs) {
    console.log(
      `${iso(r.firstBuy)}  ${r.symbol.padEnd(13)} ${r.usdIn.toFixed(1).padStart(5)} ${r.usdOut.toFixed(1).padStart(6)} ${r.valueNow.toFixed(1).padStart(5)} ${x2(r.mult).padStart(6)}  ${(r.lagMin == null ? "-" : r.lagMin.toFixed(0)).padStart(8)}  ${(r.poolAgeH == null ? "-" : r.poolAgeH < 48 ? r.poolAgeH.toFixed(1) + "h" : (r.poolAgeH / 24).toFixed(0) + "d").padStart(7)}  ${(r.mcapBuy == null ? "-" : r.mcapBuy >= 1e6 ? (r.mcapBuy / 1e6).toFixed(2) + "M" : (r.mcapBuy / 1e3).toFixed(0) + "K").padStart(8)}   ${((r.verdict ?? "-") + (r.verdictFamily ? "/" + r.verdictFamily : "")).slice(0, 34).padEnd(34)} ${(r.tabs.join(",") || "").slice(0, 10).padEnd(10)} ${x2(r.path?.peak72 ?? null).padStart(6)} ${x2(r.path?.min24 ?? null).padStart(5)} ${r.path ? r.path.coverageH.toFixed(0) + "h" : "-"}`,
    );
  }

  const tot = (xs: Rec[]) => ({ n: xs.length, usdIn: xs.reduce((a, r) => a + r.usdIn, 0), usdOut: xs.reduce((a, r) => a + r.usdOut, 0), now: xs.reduce((a, r) => a + r.valueNow, 0) });
  const summ = (label: string, xs: Rec[]) => {
    const t = tot(xs);
    if (!t.n) return console.log(`  ${label.padEnd(44)} n=0`);
    const m = xs.map((r) => r.mult);
    const lost = m.filter((v) => v < 0.5).length;
    const dead = m.filter((v) => v < 0.1).length;
    const dbl = m.filter((v) => v >= 2).length;
    console.log(
      `  ${label.padEnd(44)} n=${String(t.n).padStart(3)} in ${money(t.usdIn).padStart(7)} out ${money(t.usdOut).padStart(7)} now ${money(t.now).padStart(6)} -> ${(((t.usdOut + t.now) / t.usdIn)).toFixed(2)}x | median coin ${x2(median(m))} | lost half+ ${wl(lost, t.n)} | dead ${pc(dead, t.n)} | 2x+ ${pc(dbl, t.n)}`,
    );
  };

  console.log("\n=== totals");
  summ("all coins first bought since " + SINCE, recs);
  const since2w = recs.filter((r) => r.firstBuy >= Date.parse("2026-09-27T00:00:00Z") / 1000);
  summ("  of which since 2026-09-27 (two weeks)", since2w);

  // Q1
  console.log("\n=== Q1 did the system know the coin before the buy?");
  const klass = (r: Rec): string => (r.tabs.length ? "A listed on a Radar tab before the buy" : r.lagMin != null && r.lagMin >= 0 && r.lagMin <= 60 ? "B known 0-60 min before the buy" : r.lagMin != null && r.lagMin > 60 && r.lagMin <= 24 * 60 ? "C known 1-24 h before" : r.lagMin != null && r.lagMin > 24 * 60 ? "D known more than a day before" : r.lagMin != null ? "E seen only AFTER the buy" : "F never seen by the system");
  const kl = [...new Set(recs.map(klass))].sort();
  for (const k of kl) summ(k, recs.filter((r) => klass(r) === k));
  const known = recs.filter((r) => r.lagMin != null && r.lagMin >= 0).length;
  const knownOrLater = recs.filter((r) => r.lagMin != null).length;
  console.log(`  known before the buy: ${pc(known, recs.length)}; known at some point: ${pc(knownOrLater, recs.length)}; listed on a tab (data only since 2026-10-09): ${pc(recs.filter((r) => r.tabs.length).length, recs.filter((r) => r.firstBuy >= Date.parse("2026-10-09T12:00:00Z") / 1000).length)} of the buys since then`);

  // Q2
  console.log("\n=== Q2 how did the coins end, by what the system had said at the moment of the buy");
  const vclass = (r: Rec) => (r.lagMin == null || r.lagMin < 0 ? "no verdict yet (not known / seen after)" : r.verdict ? `${r.verdict}${r.verdict === "REJECTED" ? "/" + r.verdictFamily : ""}` : "known, no verdict yet");
  for (const k of [...new Set(recs.map(vclass))].sort()) summ(k, recs.filter((r) => vclass(r) === k));

  // Q3
  console.log("\n=== Q3 timing and size at the buy");
  const bucket = <T,>(label: string, f: (r: Rec) => T | null, edges: Array<[string, (v: T) => boolean]>) => {
    console.log(`  -- ${label}`);
    for (const [name, test] of edges) summ(name, recs.filter((r) => { const v = f(r); return v != null && test(v); }));
    summ("unknown", recs.filter((r) => f(r) == null));
  };
  bucket("minutes between the system's first sight and the buy", (r) => (r.lagMin != null && r.lagMin >= 0 ? r.lagMin : null), [["0-15 min", (v) => v <= 15], ["15-120 min", (v) => v > 15 && v <= 120], ["2-24 h", (v) => v > 120 && v <= 1440], ["over a day", (v) => v > 1440]]);
  bucket("age of the pool at the buy", (r) => r.poolAgeH, [["under 1 h", (v) => v < 1], ["1-6 h", (v) => v >= 1 && v < 6], ["6-24 h", (v) => v >= 6 && v < 24], ["1-7 days", (v) => v >= 24 && v < 168], ["older than a week", (v) => v >= 168]]);
  bucket("market cap at the buy (average price paid)", (r) => r.mcapBuy, [["under $30K", (v) => v < 30e3], ["$30-100K", (v) => v >= 30e3 && v < 100e3], ["$100-300K", (v) => v >= 100e3 && v < 300e3], ["$300K-1M", (v) => v >= 300e3 && v < 1e6], ["over $1M", (v) => v >= 1e6]]);
  bucket("coins bought within 2 hours of this one (a session)", (r) => r.session, [["alone (1-2)", (v) => v <= 2], ["3-5 in the session", (v) => v >= 3 && v <= 5], ["6+ in the session", (v) => v >= 6]]);
  bucket("dollars put in", (r) => r.usdIn, [["$2-2.5", (v) => v <= 2.5], ["$3-5", (v) => v > 2.5 && v <= 5.5], ["over $5.5", (v) => v > 5.5]]);

  // Q5 outliers
  console.log("\n=== Q5 how much of the result is a handful of coins");
  const byNet = [...recs].sort((a, b) => b.usdOut + b.valueNow - b.usdIn - (a.usdOut + a.valueNow - a.usdIn));
  const net = (r: Rec) => r.usdOut + r.valueNow - r.usdIn;
  console.log("  best five:", byNet.slice(0, 5).map((r) => `${r.symbol} ${net(r) >= 0 ? "+" : ""}${net(r).toFixed(1)} (${x2(r.mult)})`).join(", "));
  console.log("  worst five:", byNet.slice(-5).reverse().map((r) => `${r.symbol} ${net(r).toFixed(1)}`).join(", "));
  const sumNet = recs.reduce((a, r) => a + net(r), 0);
  console.log(`  net of everything: ${sumNet >= 0 ? "+" : ""}${sumNet.toFixed(1)}; without the best 1: ${(sumNet - net(byNet[0]!)).toFixed(1)}; without the best 3: ${(sumNet - byNet.slice(0, 3).reduce((a, r) => a + net(r), 0)).toFixed(1)}`);
  for (const r of byNet.slice(0, 4)) {
    console.log(`  open: ${r.symbol} mint ${r.mint.slice(0, 6)}… in ${r.usdIn.toFixed(1)} out ${r.usdOut.toFixed(1)} held ${r.held.toFixed(0)} tokens worth ${r.valueNow.toFixed(1)} now (price ${r.priceNow?.toPrecision(3) ?? "-"}, pool ${r.liqNow == null ? "-" : "$" + Math.round(r.liqNow)}), bought at ${r.pBuy.toPrecision(3)}; after the buy: ${r.path ? `peak held ${x2(r.path.peak72)} min24 ${x2(r.path.min24)}, followed ${r.path.coverageH.toFixed(0)} h` : "not followed by the scanner"}`);
  }

  // Q4 against the lab's other coins at the same age
  console.log("\n=== Q4 do the entries beat the lab's other coins at the same age? (the lab's own labels, measured from the moment of the buy)");
  const universe = new Map<number, Row[]>();
  for (const tau of [0, 1, 3, 6, 12, 24]) universe.set(tau, rowsFor([...lab.values()], tau));
  const matched: Array<{ rec: Rec; row: Row }> = [];
  for (const r of recs) {
    const coin = lab.get(r.mint);
    if (!coin) continue;
    let best: { s: LabCoin["snaps"][number]; d: number } | null = null;
    for (const s of coin.snaps) {
      const d = Math.abs(s.ts - r.firstBuy);
      if (s.y && d <= 3 * H && (!best || d < best.d)) best = { s, d };
    }
    if (best) matched.push({ rec: r, row: { coin, tau: best.s.tau, t0: coin.firstSeenAt, f: best.s.f, y: best.s.y! } });
  }
  const g = group(matched.map((m) => m.row));
  const taus = matched.map((m) => m.row.tau);
  const base = (f: (r: Row) => number | null) => {
    const vals: number[] = [];
    for (const tau of taus) {
      const u = (universe.get(tau) ?? []).map(f).filter((x): x is number => x != null);
      if (u.length) vals.push(u.reduce((a, b) => a + b, 0) / u.length);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const bGo2 = base((r) => (r.y.go2 == null ? null : r.y.go2 ? 1 : 0));
  const bCol = base((r) => (r.y.collapse24 == null ? null : r.y.collapse24 ? 1 : 0));
  console.log(`  matched to a lab snapshot within 3 h of the buy with a decided 72 h window: ${matched.length} of ${recs.length}`);
  console.log(`  held 2x within 72 h of the buy: entries ${wl(g.go2.k, g.go2.n)}  | lab's other coins at the same ages ${bGo2 == null ? "-" : (100 * bGo2).toFixed(0) + "%"}`);
  console.log(`  lost half within 24 h:          entries ${wl(g.collapse24.k, g.collapse24.n)}  | lab's other coins at the same ages ${bCol == null ? "-" : (100 * bCol).toFixed(0) + "%"}`);
  if (g.go2.n >= 8 && bGo2 != null) console.log(`  Fisher p (held 2x): ${fisherExact(g.go2.k, g.go2.n - g.go2.k, Math.round(bGo2 * 1000), Math.round((1 - bGo2) * 1000)).toFixed(3)}`);
  if (g.collapse24.n >= 8 && bCol != null) console.log(`  Fisher p (lost half): ${fisherExact(g.collapse24.k, g.collapse24.n - g.collapse24.k, Math.round(bCol * 1000), Math.round((1 - bCol) * 1000)).toFixed(3)}`);
  console.log(`  exit plan result per $ (lab's default ladder from the same moment): entries ${g.ev.mean == null ? "-" : ((g.ev.mean - 1) * 100).toFixed(0) + "%"} (n=${g.ev.n})`);

  // Q6 what the coins looked like when the user bought them, against the lab's other coins at the same age (percentile within the same tau)
  console.log("\n=== Q6 what the coins looked like at the buy: where they sit among the lab's other coins at the same age (50 = the middle)");
  const feats: Array<[string, string]> = [["trades_h1", "trades in the last hour"], ["vol_h1", "volume in the last hour"], ["vol_liq_h1", "hour volume / liquidity"], ["pc_h1", "price change, 1 h"], ["pc_h6", "price change, 6 h"], ["pc_h24", "price change, 24 h"], ["mult", "price against the first look"], ["dd", "share of its high still held"], ["liq", "pool liquidity"], ["mcap", "market cap"], ["top10", "top 10 holders' share"]];
  const pctile = (vals: number[], x: number) => {
    if (!vals.length) return null;
    let below = 0, eq = 0;
    for (const v of vals) { if (v < x) below++; else if (v === x) eq++; }
    return (100 * (below + eq / 2)) / vals.length;
  };
  for (const [key, label] of feats) {
    const ps: number[] = [];
    for (const m of matched) {
      const v = m.row.f[key];
      if (v == null || !Number.isFinite(v)) continue;
      const u = (universe.get(m.row.tau) ?? []).map((r) => r.f[key]).filter((x): x is number => x != null && Number.isFinite(x));
      const q = pctile(u, v);
      if (q != null) ps.push(q);
    }
    if (ps.length < 10) continue;
    const above = ps.filter((q) => q > 50).length;
    console.log(`  ${label.padEnd(30)} median percentile ${median(ps).toFixed(0).padStart(3)}   above the middle in ${wl(above, ps.length)}`);
  }

  // path facts for all coins that were followed after the buy
  const followed = recs.filter((r) => r.path && r.path.coverageH >= 24);
  console.log(`\n=== what the price did after the buy, for the ${followed.length} coins the scanner kept following for at least 24 h after the buy`);
  const pk = followed.filter((r) => r.path!.peak72 != null);
  console.log(`  held 2x at some point in 72 h: ${wl(pk.filter((r) => r.path!.peak72! >= 2).length, pk.length)}   held 5x: ${wl(pk.filter((r) => r.path!.peak72! >= 5).length, pk.length)}`);
  const m24 = followed.filter((r) => r.path!.min24 != null);
  console.log(`  fell to half or less within 24 h: ${wl(m24.filter((r) => r.path!.min24! <= 0.5).length, m24.length)}`);
  const left = pk.filter((r) => r.path!.peak72! >= 2);
  console.log(`  of the ones that held 2x: your result was ${left.map((r) => x2(r.mult)).join(" ")}`);

  // E: what the price did from the buy until now, from hourly candles (scripts/wallet-candles.ts), and what simple exit rules would have done
  if (CANDLES && fs.existsSync(CANDLES)) {
    type Candle = [number, number, number, number, number, number];
    const cache = JSON.parse(fs.readFileSync(CANDLES, "utf8")) as Record<string, { pool: string | null; candles: Candle[] }>;
    interface Path { rec: Rec; hours: number; peakClose: number; peakHigh: number; tPeakD: number; firstX: Record<number, number | null>; holdAll: number }
    const paths: Path[] = [];
    for (const r of recs) {
      const c = cache[r.mint]?.candles ?? [];
      if (c.length < 3 || !(r.pBuy > 0)) continue;
      const after = c.filter((k) => k[0] >= r.firstBuy - 3600);
      if (after.length < 3) continue;
      let peakClose = 0, peakHigh = 0, tPeak = after[0]![0];
      const firstX: Record<number, number | null> = { 2: null, 3: null, 5: null, 10: null };
      for (const k of after) {
        const close = k[4] / r.pBuy, high = k[2] / r.pBuy;
        if (close > peakClose) { peakClose = close; tPeak = k[0] + 3600; }
        if (high > peakHigh) peakHigh = high;
        for (const x of [2, 3, 5, 10]) if (firstX[x] == null && close >= x) firstX[x] = (k[0] + 3600 - r.firstBuy) / 3600;
      }
      // holding everything bought until now: the price now (0 when the coin is no longer listed with a real pool) over the price paid
      const holdAll = r.listed && r.priceNow ? (r.tokIn * r.priceNow) / r.usdIn : 0;
      paths.push({ rec: r, hours: (after[after.length - 1]![0] + 3600 - r.firstBuy) / 3600, peakClose, peakHigh, tPeakD: (tPeak - r.firstBuy) / 86400, firstX, holdAll });
    }
    const single = paths.filter((x) => x.rec.nBuys === 1);
    console.log(`\n=== E what the price did from the buy until now (hourly candles for ${paths.length} of ${recs.length} coins; ${single.length} of them bought once)`);
    const ever = (x: number) => paths.filter((p) => p.firstX[x] != null).length;
    console.log(`  closed at ${"2x"} or more at some hour after the buy: ${wl(ever(2), paths.length)}; 3x: ${wl(ever(3), paths.length)}; 5x: ${wl(ever(5), paths.length)}; 10x: ${wl(ever(10), paths.length)}`);
    const first2 = paths.filter((p) => p.firstX[2] != null).map((p) => p.firstX[2]! / 24);
    const bucket2 = (lo: number, hi: number) => first2.filter((d) => d >= lo && d < hi).length;
    console.log(`  the ${first2.length} coins that closed 2x+: first time within 1 day ${bucket2(0, 1)}, 1-3 days ${bucket2(1, 3)}, 3-7 days ${bucket2(3, 7)}, after a week ${bucket2(7, 1e9)}`);
    const late = paths.filter((p) => p.firstX[3] != null && p.firstX[3]! > 72);
    console.log(`  coins whose first 3x close came after more than 72 hours: ${late.length} (${late.map((p) => p.rec.symbol + " day " + (p.firstX[3]! / 24).toFixed(1)).join(", ")})`);
    // exit rules on the first buy of single-buy coins; "touch" = a resting order filled when an hourly high reaches the level, "close" = needs an hourly close there
    const sim = (name: string, f: (p: Path, reached: (x: number) => boolean) => number, mode: "close" | "touch") => {
      const m: number[] = [];
      const d: number[] = [];
      for (const p of single) {
        const reached = (x: number) => (mode === "close" ? p.firstX[x] != null : p.peakHigh >= x);
        const v = f(p, reached);
        m.push(v);
        d.push(v - p.rec.mult);
      }
      const win = m.filter((v) => v >= 1).length;
      const dbl = m.filter((v) => v >= 2).length;
      const ci = bootMeanCi(d, 2000, 7);
      console.log(`  ${name.padEnd(46)} ${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(2)}x per coin | against what he did: ${ci.mean >= 0 ? "+" : ""}${ci.mean.toFixed(2)} [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}] | back at least the stake: ${pc(win, m.length)} | doubled: ${pc(dbl, m.length)}`);
    };
    const actual = single.reduce((a, p) => a + p.rec.mult, 0) / (single.length || 1);
    console.log(`  --- on the ${single.length} coins bought once (what the user really did, against simple rules applied to the same buys)`);
    console.log(`  ${"what the user actually did (sold when he sold)".padEnd(54)} ${actual.toFixed(2)}x per $ put in | back at least what went in: ${pc(single.filter((p) => p.rec.mult >= 1).length, single.length)} | doubled: ${pc(single.filter((p) => p.rec.mult >= 2).length, single.length)}`);
    for (const mode of ["close", "touch"] as const) {
      console.log(`  [${mode === "close" ? "needs an hourly close at the level (cautious)" : "filled when an hourly high touches the level (optimistic)"}]`);
      sim("hold everything until now", (p) => p.holdAll, mode);
      sim("half out at 2x (the money back), rest held", (p, r) => (r(2) ? 1 + 0.5 * p.holdAll : p.holdAll), mode);
      sim("a third at 2x, a third at 5x, rest held", (p, r) => (r(2) ? 2 / 3 : 0) + (r(5) ? 5 / 3 : 0) + (1 - (r(2) ? 1 / 3 : 0) - (r(5) ? 1 / 3 : 0)) * p.holdAll, mode);
      sim("everything out at 3x", (p, r) => (r(3) ? 3 : p.holdAll), mode);
      sim("half out at 2x, a quarter at 5x, rest held", (p, r) => (r(2) ? 1 : 0) + (r(5) ? 1.25 : 0) + (1 - (r(2) ? 0.5 : 0) - (r(5) ? 0.25 : 0)) * p.holdAll, mode);
    }
    console.log(`  the best possible (sell everything at the highest hourly close): ${(single.reduce((a, p) => a + p.peakClose, 0) / (single.length || 1)).toFixed(2)}x per $ — a ceiling nobody reaches`);
    // where did the user leave money: coins that closed 3x+ and the user ended below 1.5x
    const leaks = paths.filter((p) => p.peakClose >= 3 && p.rec.mult < 1.5).sort((a, b) => b.peakClose - a.peakClose);
    console.log(`  coins that closed 3x or more at some hour and ended below 1.5x for the user: ${leaks.length}: ${leaks.slice(0, 12).map((p) => `${p.rec.symbol} peak ${x2(p.peakClose)} day ${p.tPeakD.toFixed(1)} -> ${x2(p.rec.mult)}`).join("; ")}`);
    const kept = paths.filter((p) => p.peakClose >= 3 && p.rec.mult >= 1.5);
    console.log(`  coins that closed 3x or more and the user ended at 1.5x or better: ${kept.length}: ${kept.map((p) => `${p.rec.symbol} peak ${x2(p.peakClose)} -> ${x2(p.rec.mult)}`).join("; ")}`);
  }

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ since: SINCE, recs }, null, 1));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
