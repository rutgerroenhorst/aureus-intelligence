/**
 * Where did the owner's purchases come from, how did each source do, and are the Radar tabs' coins "slow cookers" that still stand at a good market cap days later? (docs/FILTER_FEEDBACK.md, section 6)
 *
 *   corepack pnpm exec tsx scripts/entries-by-source.ts [--since 2026-10-09] [--listed-from 2026-10-09T12:00:00+02:00] [--listed-to 2026-10-13T12:00:00+02:00]
 *
 * Read-only (the hosted database for the listings, the fills and the journal; the laptop's database for the stream's graduations; DexScreener for today's prices). Prints coin counts and dollars of groups, never a coin name.
 * WRITTEN DOWN BEFORE LOOKING (2026-10-16, after the owner said they bought most from Incubation / Elite and that those are "slow cookers" that still stand at a good cap):
 *  (1) every coin the wallet first bought since the date: listed on a Radar tab before that buy (which tab), else a Graduations entry (the button's journal row for the tab "graduates", or a stream graduation within a day before the
 *      buy), else none; the money multiple of each group today = (sold + held at today's price) / put in, and how many coins are at or above 1x and below half.
 *  (2) the slow-cooker claim: for every tab listing in the window (3 to 7 days old at the time of writing) the market cap NOW over the market cap at the listing: the share with no priced pool (dead), at least 0.5x, at least 1x, at least 2x,
 *      the median, the mean (capped at 50x) and the share that still stands at $50K or more; the same for the stream's graduations of those days whose first pool was at least $5,000, split into "born" and "not born".
 *  (3) the same listings by the age of the coin at the listing.
 */
import pg from "pg";
import { connectTo, hostedUrl, localUrl } from "./lib/hosted.js";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const SINCE = Date.parse(arg("since", "2026-10-09") + "T00:00:00+02:00") / 1000;
const FROM = Date.parse(arg("listed-from", "2026-10-09T12:00:00+02:00")) / 1000;
const TO = Date.parse(arg("listed-to", "2026-10-13T12:00:00+02:00")) / 1000;
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fin = (x: unknown) => {
  const n = x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};
const TABS = ["elite", "incubation", "buy_signals", "cate", "ultra_momentum"];

interface Now { price: number; mcap: number; liq: number }
async function nowOf(mints: string[]): Promise<Map<string, Now>> {
  const out = new Map<string, Now>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    for (let a = 0; a < 3; a++) {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`, { headers: UA, signal: AbortSignal.timeout(25_000) });
        if (res.status === 429) {
          await sleep(3000 * (a + 1));
          continue;
        }
        if (!res.ok) break;
        for (const p of (await res.json()) as any[]) {
          const m = p?.baseToken?.address as string;
          const price = fin(p?.priceUsd);
          const liq = fin(p?.liquidity?.usd) ?? 0;
          const mcap = fin(p?.marketCap) ?? fin(p?.fdv);
          if (!m || !price || price <= 0 || mcap == null) continue;
          const cur = out.get(m);
          if (!cur || liq > cur.liq) out.set(m, { price, mcap, liq });
        }
        break;
      } catch {
        await sleep(1500);
      }
    }
    await sleep(250);
  }
  return out;
}

const hosted = await connectTo(hostedUrl()!, "entries-by-source");
await hosted.query("SET default_transaction_read_only = on");
const qual = (await hosted.query(`SELECT mint, tab_name, EXTRACT(EPOCH FROM qualified_at)::float8 AS t, age_minutes_at_qualification AS age_min, mcap_usd_at_qualification::float8 AS mcap0 FROM coin_qualifications ORDER BY qualified_at`)).rows as Array<{ mint: string; tab_name: string; t: number; age_min: number; mcap0: number }>;
const fills = (await hosted.query(`SELECT mint, EXTRACT(EPOCH FROM t)::float8 AS t, side, tokens::float8 AS tokens, usd::float8 AS usd FROM wallet_fills WHERE side IN ('buy','sell') ORDER BY t`)).rows as Array<{ mint: string; t: number; side: string; tokens: number; usd: number }>;
const enter = new Set((await hosted.query(`SELECT mint FROM my_trades WHERE source = 'radar' AND tab_name = 'graduates'`)).rows.map((r) => r.mint as string));
await hosted.end();
const local = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? localUrl(), max: 2 });
const gradAt = new Map<string, number>((await local.query(`SELECT mint, EXTRACT(EPOCH FROM migrated_at)::float8 AS t FROM pump_graduates`)).rows.map((r) => [r.mint as string, r.t as number]));
const gr = (
  await local.query(
    `SELECT g.mint, (SELECT (s.payload->>'mcap')::float8 FROM lab_signals_ts s WHERE s.mint = g.mint AND s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.taken_at LIMIT 1) AS mcap0,
            (SELECT (s.payload->>'liq')::float8 FROM lab_signals_ts s WHERE s.mint = g.mint AND s.source = 'watch' AND s.payload->>'gone' IS NULL ORDER BY s.taken_at LIMIT 1) AS liq0, g.initial_buy_sol, g.create_to_migrate_min
       FROM pump_graduates g WHERE g.via = 'stream' AND g.migrated_at BETWEEN to_timestamp($1) AND to_timestamp($2)`,
    [FROM, TO],
  )
).rows;
await local.end();

// ---- (1) the purchases
const firstBuy = new Map<string, number>();
for (const f of fills) if (f.side === "buy" && f.t >= SINCE && !firstBuy.has(f.mint)) firstBuy.set(f.mint, f.t);
const first = new Map<string, { tab: string; mcap0: number; t: number; age: number }>();
for (const q of qual) {
  const k = q.tab_name + "|" + q.mint;
  if (q.t >= FROM && q.t <= TO && !first.has(k) && fin(q.mcap0)) first.set(k, { tab: q.tab_name, mcap0: q.mcap0, t: q.t, age: Number(q.age_min) });
}
const mints = [...new Set([...firstBuy.keys(), ...[...first.keys()].map((k) => k.split("|")[1]!), ...gr.map((r) => r.mint as string)])];
const now = await nowOf(mints);
interface P { src: string; inn: number; val: number }
const ps: P[] = [];
for (const [m, t0] of firstBuy) {
  const tabs = [...new Set(qual.filter((q) => q.mint === m && q.t < t0).map((q) => q.tab_name))].sort();
  const grad = enter.has(m) || (gradAt.has(m) && gradAt.get(m)! < t0 && t0 - gradAt.get(m)! < 24 * 3600);
  const fl = fills.filter((f) => f.mint === m);
  const inn = fl.filter((f) => f.side === "buy").reduce((s, f) => s + f.usd, 0);
  const out = fl.filter((f) => f.side === "sell").reduce((s, f) => s + f.usd, 0);
  const held = fl.filter((f) => f.side === "buy").reduce((s, f) => s + f.tokens, 0) - fl.filter((f) => f.side === "sell").reduce((s, f) => s + f.tokens, 0);
  ps.push({ src: tabs.length ? tabs.join("+") : grad ? "graduations" : "none", inn, val: out + Math.max(0, held) * (now.get(m)?.price ?? 0) });
}
const groups = new Map<string, P[]>();
for (const p of ps) {
  const onTab = p.src.split("+").some((t) => TABS.includes(t));
  const keys = [onTab ? "on a Radar tab" : p.src, ...p.src.split("+").filter((t) => TABS.includes(t)).map((t) => "  tab " + t)];
  for (const k of keys) (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
}
console.log(`== (1) ${ps.length} coins first bought since ${arg("since", "2026-10-09")}; where they came from (a coin on two tabs counts in both of the indented rows)`);
for (const [k, a] of [...groups.entries()].sort()) {
  const inn = a.reduce((s, p) => s + p.inn, 0), val = a.reduce((s, p) => s + p.val, 0);
  console.log(`   ${k.padEnd(22)} coins ${String(a.length).padStart(3)}   in $${inn.toFixed(0).padStart(4)}   now $${val.toFixed(0).padStart(4)}   ${(val / inn).toFixed(2)}x   at or above 1x: ${a.filter((p) => p.val >= p.inn).length}   below half: ${a.filter((p) => p.val < 0.5 * p.inn).length}`);
}

// ---- (2) now over then
const rows: Array<{ grp: string; mult: number; mcapNow: number }> = [];
for (const [k, v] of first) {
  const n = now.get(k.split("|")[1]!);
  rows.push({ grp: "tab " + v.tab, mult: n ? n.mcap / v.mcap0 : 0, mcapNow: n?.mcap ?? 0 });
}
for (const r of gr) {
  if (!r.mcap0 || r.mcap0 <= 0 || (r.liq0 ?? 0) < 5000) continue;
  const born = (r.create_to_migrate_min ?? 99) < 2 && (r.initial_buy_sol ?? 0) >= 50;
  const n = now.get(r.mint as string);
  rows.push({ grp: born ? "graduations: born" : "graduations: not born", mult: n ? n.mcap / r.mcap0 : 0, mcapNow: n?.mcap ?? 0 });
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
console.log(`\n== (2) market cap now over market cap at the listing (listings ${arg("listed-from", "2026-10-09T12:00:00+02:00")} .. ${arg("listed-to", "2026-10-13T12:00:00+02:00")}); dead = no priced pool = 0`);
console.log("group                      n   dead   >=0.5x  >=1x   >=2x  median  mean   standing at >= $50K now");
for (const g of [...new Set(rows.map((r) => r.grp))].sort()) {
  const a = rows.filter((r) => r.grp === g), n = a.length;
  const pc = (k: number) => `${((100 * k) / n).toFixed(0)}%`.padStart(5);
  console.log(`${g.padEnd(26)} ${String(n).padStart(4)} ${pc(a.filter((r) => r.mult === 0).length)}  ${pc(a.filter((r) => r.mult >= 0.5).length)}  ${pc(a.filter((r) => r.mult >= 1).length)}  ${pc(a.filter((r) => r.mult >= 2).length)}  ${med(a.map((r) => r.mult)).toFixed(2).padStart(5)}x ${(a.reduce((s, r) => s + Math.min(r.mult, 50), 0) / n).toFixed(2).padStart(5)}x  ${pc(a.filter((r) => r.mcapNow >= 50_000).length)}`);
}

// ---- (3) by the age at the listing
const ageRows = [...first.entries()].map(([k, v]) => {
  const n = now.get(k.split("|")[1]!);
  return { tab: v.tab, age: v.age, mult: n ? n.mcap / v.mcap0 : 0, mcapNow: n?.mcap ?? 0 };
});
console.log(`\n== (3) the tabs' listings by the coin's age at the listing (n=${ageRows.length})`);
for (const [name, lo, hi] of [["under 1 h", 0, 60], ["1 - 4.5 h", 60, 270], ["4.5 - 24 h", 270, 1440], ["1 - 3 days", 1440, 4320], ["3 days or more", 4320, 1e12]] as Array<[string, number, number]>) {
  const a = ageRows.filter((r) => r.age >= lo && r.age < hi), n = a.length;
  if (n < 5) {
    console.log(`   ${name.padEnd(16)} n=${n}`);
    continue;
  }
  const pc = (k: number) => `${((100 * k) / n).toFixed(0)}%`.padStart(4);
  console.log(`   ${name.padEnd(16)} n=${String(n).padStart(3)}  dead ${pc(a.filter((r) => r.mult === 0).length)}  >=0.5x ${pc(a.filter((r) => r.mult >= 0.5).length)}  >=1x ${pc(a.filter((r) => r.mult >= 1).length)}  median ${med(a.map((r) => r.mult)).toFixed(2)}x  standing >= $50K now ${pc(a.filter((r) => r.mcapNow >= 50_000).length)}`);
}
