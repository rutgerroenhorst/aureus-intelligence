/**
 * What does the trading app actually charge on an order? Read-only look at the owner's own on-chain trades.
 *
 *   corepack pnpm exec tsx scripts/fomo-fee-probe.ts [--sample] [--hosted]
 *
 * The wallet address comes from table wallet_watch and is never printed. For every USDC trade in wallet_fills it fetches the transaction from the
 * free public RPC and splits the USDC that moved into: the owner (ME), the pool side (the biggest move the other way) and everything else (the
 * fees: what the owner paid minus what the pool got on a buy, what the pool paid minus what the owner got on a sell). Then it prints the fee per
 * size bucket. Results are cached in .private/fomo-fee-probe.json (git-ignored) so a second run does not ask the RPC again.
 */
import fs from "node:fs";
import path from "node:path";
import { connectTo, localUrl, hostedUrl, REPO } from "./lib/hosted.js";
import { fetchTransaction, USDC } from "../apps/web/lib/wallet";

interface Row {
  sig: string;
  side: "buy" | "sell";
  usd: number;
  t: string;
  /** what the owner moved, positive */
  me: number;
  /** what the pool side moved, positive */
  pool: number;
  /** the fee: the difference, never negative */
  fee: number;
  /** other owners with a USDC move, first six characters and amount */
  others: Array<[string, number]>;
}

/** the fee changed in the last days of August: the flat part was $0.20 until 2026-08-28 and $0.10 since */
const CHANGE = "2026-08-29";
const cacheFile = path.join(REPO, ".private", "fomo-fee-probe.json");
const cache: Record<string, Row | null> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const url = process.argv.includes("--hosted") ? hostedUrl() : localUrl();
if (!url) {
  console.error("no database url");
  process.exit(2);
}
const db = await connectTo(url, "fomo-fee-probe");
let me = "";
let fills: Array<{ signature: string; side: "buy" | "sell"; usd: number; t: Date }> = [];
try {
  const w = await db.query("select address from wallet_watch limit 1");
  me = w.rows[0]?.address ?? "";
  if (!me) throw new Error("no wallet in wallet_watch");
  const q = await db.query("select signature, side, usd, t from wallet_fills where quote = 'USD' and usd > 0.2 order by t");
  fills = q.rows;
} finally {
  await db.end();
}
const allFills = fills;
// --per-bucket=N: only the N most recent trades of each side and size bucket are fetched (the public RPC is slow: about one transaction in seven seconds)
const perBucket = Number(process.argv.find((a) => a.startsWith("--per-bucket="))?.split("=")[1] ?? 0);
const BUCKETS: Array<[string, number, number]> = [
  ["under $1.5", 0, 1.5],
  ["$1.5 to 2.5", 1.5, 2.5],
  ["$2.5 to 5", 2.5, 5],
  ["$5 to 10", 5, 10],
  ["$10 to 25", 10, 25],
  ["$25 and up", 25, 1e9],
];
if (perBucket > 0) {
  const pick: typeof fills = [];
  for (const side of ["buy", "sell"] as const)
    for (const [, lo, hi] of BUCKETS) {
      // only the current fee period is fetched: the earlier one is covered
      const g = allFills.filter((f) => f.side === side && f.usd >= lo && f.usd < hi && f.t.toISOString() >= CHANGE).sort((a, b) => b.t.getTime() - a.t.getTime());
      const have = g.filter((f) => f.signature in cache && cache[f.signature]).length;
      pick.push(...g.filter((f) => !(f.signature in cache)).slice(0, Math.max(0, perBucket - have)));
    }
  fills = pick;
}
console.log(`${fills.length} USDC trades to fetch (${Object.keys(cache).length} already cached, ${allFills.length} in the journal)`);

const ui = (b: any) => Number(b?.uiTokenAmount?.uiAmountString ?? b?.uiTokenAmount?.uiAmount ?? 0);

function split(f: { signature: string; side: "buy" | "sell"; usd: number; t: Date }, tx: any): Row | null {
  if (!tx?.meta || tx.meta.err != null) return null;
  const delta = new Map<string, number>();
  for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === USDC) delta.set(b.owner, (delta.get(b.owner) ?? 0) - ui(b));
  for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === USDC) delta.set(b.owner, (delta.get(b.owner) ?? 0) + ui(b));
  const mine = delta.get(me) ?? 0;
  if (Math.abs(mine) < 0.01) return null;
  const others = [...delta.entries()].filter(([o, d]) => o !== me && Math.abs(d) > 1e-9);
  // buy: the owner pays (negative); the pool and the fee wallets receive (positive). sell: the pool pays (negative); the owner and the fee wallets receive.
  // So the pool is the biggest receiver on a buy and the only payer on a sell, and the fee is what the owner paid minus what the pool got (buy),
  // or what the pool paid minus what the owner got (sell). A route with a second payer (a multi-hop swap) has no clean split and is left out.
  const poolEntry = f.side === "buy" ? others.filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1])[0] : others.filter(([, d]) => d < 0).sort((a, b) => a[1] - b[1])[0];
  if (!poolEntry) return null;
  const wrongWay = f.side === "buy" ? others.filter(([, d]) => d < 0) : others.filter(([o, d]) => d < 0 && o !== poolEntry[0]);
  if (wrongWay.length) return null;
  const poolAmt = Math.abs(poolEntry[1]);
  if (poolAmt < 0.5 * Math.abs(mine)) return null;
  const fee = f.side === "buy" ? Math.abs(mine) - poolAmt : poolAmt - Math.abs(mine);
  return {
    sig: f.signature,
    side: f.side,
    usd: f.usd,
    t: f.t.toISOString(),
    me: Math.abs(mine),
    pool: poolAmt,
    fee: Math.max(0, fee),
    others: others.filter(([o]) => o !== poolEntry[0]).map(([o, d]) => [o.slice(0, 6), Math.round(d * 1e4) / 1e4] as [string, number]),
  };
}

let next = 0;
let fetched = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= fills.length) return;
    const f = fills[i]!;
    if (f.signature in cache) continue;
    const tx = await fetchTransaction(f.signature);
    cache[f.signature] = tx ? split(f, tx) : null;
    fetched++;
    if (fetched % 25 === 0) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`  ${fetched} fetched...`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(cache));

// the report covers everything that is in the cache, not only what this run fetched
const cached = allFills.filter((f) => f.signature in cache);
const rows = cached.map((f) => cache[f.signature]).filter((r): r is Row => !!r);
console.log(`\n${rows.length} of ${cached.length} cached trades have a clean USDC split (the rest are multi-hop routes)\n`);
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
function report(title: string, set: Row[]) {
  console.log(`=== ${title}: ${set.length} trades`);
  for (const side of ["buy", "sell"] as const) {
    console.log(side === "buy" ? "BUYS (size = what the owner paid)" : "SELLS (size = what the owner received)");
    console.log("bucket        n   median fee $   median fee %   share with fee <= $0.105   max fee $");
    for (const [name, lo, hi] of BUCKETS) {
      const r = set.filter((x) => x.side === side && x.me >= lo && x.me < hi);
      if (!r.length) continue;
      const fees = r.map((x) => x.fee);
      const pct = r.map((x) => (100 * x.fee) / (side === "buy" ? x.me : x.pool));
      const flat = r.filter((x) => x.fee <= 0.105).length;
      console.log(`${name.padEnd(12)} ${String(r.length).padStart(3)}   ${median(fees).toFixed(3).padStart(10)}   ${median(pct).toFixed(2).padStart(10)}%   ${((100 * flat) / r.length).toFixed(0).padStart(16)}%   ${Math.max(...fees).toFixed(2).padStart(14)}`);
    }
  }
  const who = new Map<string, number[]>();
  for (const r of set) for (const [o, d] of r.others) who.set(o, [...(who.get(o) ?? []), Math.abs(d)]);
  console.log("other USDC receivers (first six characters): trades / median amount");
  for (const [o, a] of [...who.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 6)) console.log(`  ${o}  ${String(a.length).padStart(4)}  $${median(a).toFixed(3)}`);
  const total = set.reduce((s, r) => s + r.fee, 0);
  const volume = set.reduce((s, r) => s + (r.side === "buy" ? r.me : r.pool), 0);
  console.log(`total: $${volume.toFixed(0)} traded, $${total.toFixed(2)} paid in fees (${((100 * total) / Math.max(volume, 1)).toFixed(2)}%)\n`);
}
report("all cached", rows);
report(`since ${CHANGE} (the current fee)`, rows.filter((r) => r.t >= CHANGE));
report(`before ${CHANGE}`, rows.filter((r) => r.t < CHANGE));

// What the fees add up to over the whole journal: every USDC trade gets the median fee of the trades of the same side and size that were read.
{
  const sizeOf = (f: (typeof allFills)[number]) => f.usd;
  const bucketOf = (u: number) => BUCKETS.find(([, lo, hi]) => u >= lo && u < hi)?.[0] ?? "";
  const med = new Map<string, number>();
  for (const era of ["early", "now"])
    for (const side of ["buy", "sell"] as const)
      for (const [name, lo, hi] of BUCKETS) {
        const r = rows.filter((x) => (x.t < CHANGE ? "early" : "now") === era && x.side === side && x.me >= lo && x.me < hi);
        if (r.length >= 3) med.set(`${era}|${side}|${name}`, median(r.map((x) => x.fee)));
      }
  let fees = 0;
  let vol = 0;
  let n = 0;
  const bySide = { buy: { n: 0, fee: 0, vol: 0 }, sell: { n: 0, fee: 0, vol: 0 } };
  for (const f of allFills) {
    const era = f.t.toISOString() < CHANGE ? "early" : "now";
    const b = bucketOf(sizeOf(f));
    const m = med.get(`${era}|${f.side}|${b}`) ?? med.get(`${era}|${f.side === "buy" ? "sell" : "buy"}|${b}`);
    if (m == null) continue;
    fees += m;
    vol += f.usd;
    n++;
    bySide[f.side].n++;
    bySide[f.side].fee += m;
    bySide[f.side].vol += f.usd;
  }
  console.log(`=== the whole journal (${n} USDC trades, each at the median fee of its side and size): about $${fees.toFixed(0)} in fees on $${vol.toFixed(0)} traded (${((100 * fees) / vol).toFixed(1)}%)`);
  for (const s of ["buy", "sell"] as const) console.log(`   ${s}: ${bySide[s].n} trades, $${bySide[s].vol.toFixed(0)}, about $${bySide[s].fee.toFixed(0)} in fees (${((100 * bySide[s].fee) / Math.max(1, bySide[s].vol)).toFixed(1)}%)`);
}
