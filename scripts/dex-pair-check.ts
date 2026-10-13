/**
 * How often does DexScreener's batch endpoint (tokens/v1/solana/<mints>, one pair per coin) hand back a pair without a price (a pump.fun bonding-curve pair that no longer trades)
 * for a coin that DOES have a live pool? Those coins read as "gone" or "not listed" everywhere the code uses that endpoint.
 *
 *   corepack pnpm exec tsx scripts/dex-pair-check.ts [--hours 72] [--wallet]
 *
 * Read-only. Looks at the graduations of the last N hours (table pump_graduates) and, with --wallet, at every coin the followed wallet ever bought. Never prints an address of the wallet.
 */
import { connectTo, localUrl } from "./lib/hosted.js";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const HOURS = Number(arg("hours", "72"));
const WALLET = process.argv.includes("--wallet");
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: unknown) => (x == null || x === "" ? NaN : Number(x));

async function getJson(url: string): Promise<any> {
  for (let a = 0; a < 4; a++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
    if (res.status === 429) {
      await sleep(3000 * (a + 1));
      continue;
    }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

const db = await connectTo(localUrl(), "dex-pair-check");
const mints: string[] = [];
const labels = new Map<string, string>();
try {
  const g = await db.query(`SELECT mint, symbol FROM pump_graduates WHERE migrated_at > now() - make_interval(hours => $1::int)`, [HOURS]);
  for (const r of g.rows) {
    mints.push(r.mint);
    labels.set(r.mint, r.symbol ?? "?");
  }
  if (WALLET) {
    const w = await db.query(`SELECT DISTINCT mint FROM wallet_fills WHERE side = 'buy'`);
    for (const r of w.rows) if (!labels.has(r.mint)) {
      mints.push(r.mint);
      labels.set(r.mint, "wallet");
    }
  }
} finally {
  await db.end();
}
console.log(`${mints.length} coins to look at (${HOURS} h of graduations${WALLET ? " + every coin the wallet bought" : ""})`);

let answered = 0;
let priced = 0;
const unpriced: string[] = [];
const dexOf: Record<string, number> = {};
const missing: string[] = [];
for (let i = 0; i < mints.length; i += 30) {
  const batch = mints.slice(i, i + 30);
  const list = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`);
  if (!Array.isArray(list)) continue;
  const by = new Map<string, any>();
  for (const p of list) {
    const m = p?.baseToken?.address;
    if (m && !by.has(m)) by.set(m, p);
  }
  for (const m of batch) {
    const p = by.get(m);
    if (!p) {
      missing.push(m);
      continue;
    }
    answered++;
    dexOf[p.dexId] = (dexOf[p.dexId] ?? 0) + 1;
    if (num(p.priceUsd) > 0) priced++;
    else unpriced.push(m);
  }
  await sleep(350);
}
console.log(`batch answer: ${answered} coins with a pair (${priced} with a price), ${unpriced.length} with a pair WITHOUT a price, ${missing.length} not answered at all; dex of the returned pair: ${JSON.stringify(dexOf)}`);

// the other endpoint (all pairs of a coin) for the ones that read as dead
let rescued = 0;
const rows: string[] = [];
for (const m of [...unpriced, ...missing]) {
  const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${m}`);
  await sleep(300);
  const ps = ((j?.pairs ?? []) as any[]).filter((p) => p.chainId === "solana" && p.baseToken?.address === m && num(p.priceUsd) > 0 && num(p.liquidity?.usd) >= 1000);
  if (!ps.length) continue;
  rescued++;
  ps.sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
  const b = ps[0];
  rows.push(`${labels.get(m)}  ${m.slice(0, 5)}…${m.slice(-4)}  ${b.dexId}  mcap $${Math.round(num(b.marketCap) || 0).toLocaleString("en-US")}  pool $${Math.round(num(b.liquidity?.usd)).toLocaleString("en-US")}  24h ${b.priceChange?.h24 ?? "?"}%`);
}
console.log(`of the ${unpriced.length + missing.length} that read as dead, ${rescued} have a live priced pool with $1,000+ liquidity on the other endpoint:`);
for (const r of rows.slice(0, 40)) console.log("   " + r);
