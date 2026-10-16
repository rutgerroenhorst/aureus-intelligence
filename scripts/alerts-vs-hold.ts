/**
 * What would following the Telegram messages to the letter have left, against simply holding? A test on the real messages and the real positions, valued at today's prices.
 *
 *   corepack pnpm exec tsx scripts/alerts-vs-hold.ts [--since 2026-10-13T13:54:00Z] [--delay-min 5]
 *
 * Read-only (the hosted database, DexScreener, GeckoTerminal). WRITTEN DOWN BEFORE LOOKING (2026-10-16): for every position that got at least one message since the new alerts went live (2026-10-13 15:54 local),
 * compare (a) holding the tokens held at its first message until now with (b) following the messages: the loud first-profit message (green): sell 50% of what is held then; the line message (red): sell the rest;
 * the loss message (orange): sell everything; the quiet steps (blue): nothing. Every sale costs $0.10. A coin with no price now is worth 0. The fill is the price `--delay-min` minutes after the message (GeckoTerminal's
 * one-minute candles of the coin's pool; 5 by default, a person needs minutes), and the message's own price for a coin whose pool has no candles any more (so a coin that dies fast is treated kindly). No rule is tuned.
 * Prints the coins' names and dollars: for the owner's eyes only, never for the repository (docs/FILTER_FEEDBACK.md has the totals).
 */
import { connectTo, hostedUrl } from "./lib/hosted.js";
import { dexQuotes } from "../apps/worker/src/exitLoop";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const SINCE = arg("since", "2026-10-13T13:54:00Z");
const DELAY_MIN = Number(arg("delay-min", "5"));
const FEE = 0.1;
const url = hostedUrl();
if (!url) {
  console.error("no hosted database url");
  process.exit(2);
}
const db = await connectTo(url, "alerts-vs-hold");
await db.query("SET default_transaction_read_only = on");
const msgs = (
  await db.query(
    `SELECT e.mint, EXTRACT(EPOCH FROM e.position_start)::float8 AS started, e.multiple::float8 AS multiple, e.price::float8 AS price, e.value_usd::float8 AS value_usd, EXTRACT(EPOCH FROM e.sent_at)::float8 AS sent_at, m.symbol, left(m.body, 2) AS dot
       FROM exit_alerts e JOIN telegram_messages m ON m.message_id = e.message_id
      WHERE e.state = 'sent' AND e.sent_at > $1::timestamptz ORDER BY e.sent_at`,
    [SINCE],
  )
).rows as Array<{ mint: string; started: number; multiple: number; price: number; value_usd: number; sent_at: number; symbol: string; dot: string }>;
await db.end();

const mints = [...new Set(msgs.map((m) => m.mint))];
const quotes = await dexQuotes(mints);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" };

/** The price `DELAY_MIN` minutes after a message: the close of the first one-minute candle at or after that moment (null when the pool has no candles for it). */
async function laterPrice(pair: string | null, t: number): Promise<number | null> {
  if (!pair || DELAY_MIN <= 0) return null;
  const target = Math.floor(t + DELAY_MIN * 60);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair}/ohlcv/minute?aggregate=1&before_timestamp=${target + 600}&limit=15&currency=usd&token=base`, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const list = ((await res.json()) as any)?.data?.attributes?.ohlcv_list as number[][] | undefined;
      const c = (list ?? []).filter((x) => x[0]! >= target - 30).sort((a, b) => a[0]! - b[0]!)[0];
      return c ? Number(c[4]) : null;
    } catch {
      /* try again, then give up */
    }
  }
  return null;
}

interface Row { sym: string; kinds: string; t0: number; hold: number; policy: number; nowMult: number; first: number; did: string; late: number; ev: number }
const by = new Map<string, typeof msgs>();
for (const m of msgs) {
  const k = `${m.mint}|${m.started}`;
  (by.get(k) ?? by.set(k, []).get(k)!).push(m);
}
const rows: Row[] = [];
let late = 0;
let events = 0;
let ignored = 0;
for (const [, a] of by) {
  a.sort((x, y) => x.sent_at - y.sent_at);
  const first = a[0]!;
  const q = quotes.get(first.mint);
  const pNow = q?.price ?? 0;
  const T0 = first.value_usd / first.price;
  let t = T0;
  let cash = 0;
  let did = "";
  let lateHere = 0;
  for (const m of a) {
    if (t <= 0) break;
    const dot = m.dot.trim();
    const act = dot === "🟢" ? "half" : dot === "🔴" ? "line" : dot === "🟠" ? "loss" : null;
    if (!act) continue;
    events++;
    await sleep(2300);
    let lp = await laterPrice(q?.pair ?? null, m.sent_at);
    // a candle that is not within a factor of four of the message's own price is a different unit or a bad print (a pool that quotes the other way round): the message's price is used instead
    if (lp != null && !(lp / m.price >= 0.25 && lp / m.price <= 4)) {
      ignored++;
      lp = null;
    }
    const fill = lp ?? m.price;
    if (lp != null) {
      late++;
      lateHere++;
    }
    if (act === "half") {
      const s = t * 0.5;
      if (s * fill >= 1) {
        cash += s * fill - FEE;
        t -= s;
        did += `½@${m.multiple.toFixed(1)}(${(fill / m.price).toFixed(2)}) `;
      }
    } else {
      cash += t * fill - FEE;
      t = 0;
      did += `${act}@${m.multiple.toFixed(2)}(${(fill / m.price).toFixed(2)}) `;
    }
  }
  rows.push({ sym: first.symbol, kinds: a.map((m) => m.dot.trim()).join(""), t0: first.sent_at, hold: T0 * pNow, policy: cash + t * pNow, nowMult: pNow / (first.price / first.multiple), first: first.multiple, did: did.trim(), late: lateHere, ev: a.length });
}
rows.sort((a, b) => a.t0 - b.t0);
const f = (x: number) => (x >= 0 ? "+" : "-") + "$" + Math.abs(x).toFixed(2);
console.log(`since ${SINCE}: ${msgs.length} messages on ${rows.length} positions; fills ${DELAY_MIN} minutes after the message where the pool still has candles (${late} of ${events} sales; ${ignored} candles ignored as implausible), else at the message's price`);
console.log("coin         messages  first@   now/cost | hold now   policy now    diff    what the policy did (loss/line@multiple(fill/message price))");
for (const r of rows) console.log(`${r.sym.slice(0, 11).padEnd(12)} ${r.kinds.padEnd(9)} ${r.first.toFixed(2).padStart(6)}x ${r.nowMult.toFixed(2).padStart(8)}x | $${r.hold.toFixed(2).padStart(7)}   $${r.policy.toFixed(2).padStart(7)}   ${f(r.policy - r.hold).padStart(7)}   ${r.did}`);
const sum = (a: Row[], k: "hold" | "policy") => a.reduce((s, r) => s + r[k], 0);
const part = (name: string, a: Row[]) => console.log(`${name}: ${a.length} positions: hold $${sum(a, "hold").toFixed(2)} vs policy $${sum(a, "policy").toFixed(2)} (${f(sum(a, "policy") - sum(a, "hold"))})`);
console.log("");
part("all positions with a message", rows);
part("with a loss message (orange)", rows.filter((r) => r.kinds.includes("🟠")));
part("with a line message (red)", rows.filter((r) => r.kinds.includes("🔴")));
part("with a first-profit message (green)", rows.filter((r) => r.kinds.includes("🟢")));
const best = [...rows].sort((a, b) => b.policy - b.hold - (a.policy - a.hold))[0];
const worst = [...rows].sort((a, b) => a.policy - a.hold - (b.policy - b.hold))[0];
if (best && worst) console.log(`biggest gain from following: ${best.sym} ${f(best.policy - best.hold)}; biggest cost: ${worst.sym} ${f(worst.policy - worst.hold)}; without those two: ${f(sum(rows, "policy") - sum(rows, "hold") - (best.policy - best.hold) - (worst.policy - worst.hold))}`);
