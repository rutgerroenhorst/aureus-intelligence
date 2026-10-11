/**
 * Hourly price history since the buy, for the coins in a wallet review (scripts/wallet-review.ts --json).
 *
 *   corepack pnpm exec tsx scripts/wallet-candles.ts --in review.json --out candles.json
 *
 * The scanner follows a coin for about a day and the lab's tail for about 100 hours, but the user holds coins for weeks and the coins
 * that paid off ran after 6-10 days. GeckoTerminal's hourly candles (one call per coin, up to 1000 hours) fill that gap. The cache file is
 * read again on the next run, so an interrupted run continues where it stopped. GeckoTerminal allows about 30 calls a minute for
 * everything on this address together, so calls are spaced and a refusal waits and tries again. Always asks with token=<mint>: without it
 * a pool whose other token is listed first answers in the other token's price. `--lookup 1` also asks for the pools of coins that have none
 * on record (one more call each); `--pace` is the pause between calls in milliseconds.
 */
import fs from "node:fs";

const arg = (k: string, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const IN = arg("in");
const OUT = arg("out");
if (!IN || !OUT) {
  console.error("usage: wallet-candles.ts --in review.json --out candles.json");
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const H = { accept: "application/json;version=20230302", "user-agent": "Aureus-Review/1.0" };

/** Calls are spaced PACE_MS apart, and a refusal waits (the limit is shared with everything else on this address) and tries again. */
const PACE_MS = Number(arg("pace", "4500"));
const LOOKUP = arg("lookup", "0") === "1";

async function gt(url: string): Promise<{ status: number; json: any | null }> {
  for (let i = 0; i < 8; i++) {
    try {
      const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(25_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(15_000 + 5_000 * i);
        continue;
      }
      if (!res.ok) return { status: res.status, json: null };
      return { status: 200, json: await res.json() };
    } catch {
      await sleep(4_000);
    }
  }
  return { status: 0, json: null };
}

type Candle = [number, number, number, number, number, number];
interface Entry {
  pool: string | null;
  candles: Candle[];
  note?: string;
}

async function main() {
  const recs = (JSON.parse(fs.readFileSync(IN, "utf8")) as { recs: Array<{ mint: string; symbol: string; pool: string | null; firstBuy: number }> }).recs;
  const cache: Record<string, Entry> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  let n = 0;
  for (const r of recs) {
    if (cache[r.mint]) continue;
    n++;
    let pool = r.pool;
    let note: string | undefined;
    if (!pool && LOOKUP) {
      // the coin is not listed any more and the scanner never had it: ask GeckoTerminal for the pools it still knows (one more call per coin)
      await sleep(PACE_MS);
      const t = await gt(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${r.mint}/pools?page=1`);
      const first = t.json?.data?.[0]?.attributes?.address as string | undefined;
      if (first) pool = first;
      else note = t.status === 404 ? "no pool known" : "pool lookup failed";
    }
    let candles: Candle[] = [];
    if (!pool && !note) note = "no pool known";
    if (pool) {
      await sleep(PACE_MS);
      const res = await gt(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=${r.mint}`);
      const list: Candle[] = res.json?.data?.attributes?.ohlcv_list ?? [];
      candles = list.filter((c) => c[0] >= r.firstBuy - 3600 && c[4] > 0).sort((a, b) => a[0] - b[0]);
      if (res.json === null) note = `candles failed (${res.status})`;
      else if (!candles.length) note = "no candles after the buy";
    }
    cache[r.mint] = { pool, candles, ...(note ? { note } : {}) };
    fs.writeFileSync(OUT, JSON.stringify(cache));
    console.log(`${new Date().toISOString().slice(11, 19)} ${String(n).padStart(3)} ${r.symbol.padEnd(14)} ${candles.length} candles${note ? " (" + note + ")" : ""}`);
  }
  const have = Object.values(cache).filter((e) => e.candles.length).length;
  console.log(`done: ${have} of ${recs.length} coins have candles`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
