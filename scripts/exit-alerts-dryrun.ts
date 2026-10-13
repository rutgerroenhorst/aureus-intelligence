/**
 * What would the exit alerts send right now? A dry run on the real data: nothing is written and nothing is sent.
 *
 *   corepack pnpm exec tsx scripts/exit-alerts-dryrun.ts [--local] [--passes 4]
 *
 * Reads the followed wallet's fills, the alerts that were recorded and the small state next to them from the HOSTED database (read-only session; `--local` reads the laptop's), prices the held coins
 * from DexScreener (read-only calls), and runs the real pass (apps/worker/src/exitLoop.ts runPass) several times, two minutes apart on a made-up clock, against an in-memory copy of that state with
 * a Telegram that only collects the messages. Prints each position (multiple, value, what was reported, the line) and every message that would have gone out, exactly as it would look.
 * Never prints the wallet address, the bot token or the chat.
 */
import { connectTo, hostedUrl, localUrl } from "./lib/hosted.js";
import { dexQuotes, newPassState, runPass, type Deps, type Priced, type Store, type Streak, type Telegram } from "../apps/worker/src/exitLoop";
import { LEVELS_DEFAULT, readPosition, openPosition, type Fill } from "../apps/web/lib/exitAlerts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const PASSES = Number(arg("passes", "4"));
const url = process.argv.includes("--local") ? localUrl() : hostedUrl();
if (!url) {
  console.error("no database url");
  process.exit(2);
}
const db = await connectTo(url, "exit-alerts-dryrun");
await db.query("SET default_transaction_read_only = on");

// ---- the real state, copied into memory
const fills = new Map<string, Fill[]>();
for (const r of (await db.query(`SELECT mint, EXTRACT(EPOCH FROM t)::float8 AS t, side, tokens::float8 AS tokens, usd::float8 AS usd FROM wallet_fills WHERE side IN ('buy','sell') AND mint IN (SELECT mint FROM wallet_fills WHERE side = 'buy' GROUP BY mint) ORDER BY mint, t`)).rows) {
  const a = fills.get(r.mint) ?? [];
  a.push({ t: r.t, side: r.side, tokens: r.tokens, usd: r.usd });
  fills.set(r.mint, a);
}
const rows = new Map<string, { state: string }>();
const key = (m: string, s: number, l: number) => `${m}|${s}|${l}`;
for (const r of (await db.query(`SELECT mint, EXTRACT(EPOCH FROM position_start)::float8 AS s, level::float8 AS l, state FROM exit_alerts`)).rows) rows.set(key(r.mint, Math.floor(r.s), Number(r.l)), { state: r.state });
const kv = new Map<string, string>();
for (const r of (await db.query(`SELECT key, value FROM exit_alert_kv WHERE key IN ('armed_at','streaks','lines','ladder_v2')`)).rows) kv.set(r.key, String(r.value));
const symbols = new Map<string, string>((await db.query(`SELECT DISTINCT ON (mint) mint, symbol FROM my_trades WHERE symbol IS NOT NULL AND symbol <> '' ORDER BY mint, entered_at`)).rows.map((r) => [r.mint as string, r.symbol as string]));
await db.end();
console.log(`${fills.size} coins with a buy, ${rows.size} recorded alert rows, ladder_v2 ${kv.has("ladder_v2") ? "already seeded" : "NOT seeded yet (the first pass will seed it)"}, lines armed: ${Object.keys(JSON.parse(kv.get("lines") ?? "{}")).length}`);

let streaks: Record<string, Streak> = JSON.parse(kv.get("streaks") ?? "{}");
const store: Store = {
  fills: async () => fills,
  fillsVersion: async () => String([...fills.values()].reduce((a, f) => a + f.length, 0)),
  symbols: async (mints) => new Map(mints.filter((m) => symbols.has(m)).map((m) => [m, symbols.get(m)!])),
  armedAt: async () => (kv.has("armed_at") ? Number(kv.get("armed_at")) : null),
  setArmedAt: async (t) => {
    if (!kv.has("armed_at")) kv.set("armed_at", String(t));
  },
  knownAll: async () => {
    const out = new Map<string, Set<number>>();
    for (const k of rows.keys()) {
      const [m, s, l] = k.split("|");
      const set = out.get(`${m}|${s}`) ?? new Set<number>();
      set.add(Number(l));
      out.set(`${m}|${s}`, set);
    }
    return out;
  },
  knownVersion: async () => `${rows.size}:${[...rows.values()].filter((r) => r.state === "sent").length}:${[...rows.values()].filter((r) => r.state === "claimed").length}`,
  seed: async (m, s, levels) => {
    for (const l of [0, ...levels]) if (!rows.has(key(m, s, l))) rows.set(key(m, s, l), { state: "seeded" });
  },
  claim: async (m, s, l) => {
    if (rows.has(key(m, s, l))) return false;
    rows.set(key(m, s, l), { state: "claimed" });
    return true;
  },
  markSent: async (m, s, l) => {
    rows.set(key(m, s, l), { state: "sent" });
  },
  release: async (m, s, l) => {
    if (rows.get(key(m, s, l))?.state === "claimed") rows.delete(key(m, s, l));
  },
  expireClaims: async () => undefined,
  logMessage: async () => undefined,
  alertsLast24h: async () => 0,
  loadStreaks: async () => JSON.parse(JSON.stringify(streaks)),
  saveStreaks: async (x) => {
    streaks = JSON.parse(JSON.stringify(x));
  },
  sentTop: async () => {
    const out = new Map<string, number>();
    for (const [k, v] of rows) {
      const [m, s, l] = k.split("|");
      if (v.state === "sent" && Number(l) > 0) out.set(`${m}|${s}`, Math.max(out.get(`${m}|${s}`) ?? 0, Number(l)));
    }
    return out;
  },
  kvGet: async (k) => kv.get(k) ?? null,
  kvSet: async (k, v) => {
    kv.set(k, v);
  },
};

// ---- the prices: the real ones, asked once per pass
const mints = [...fills.keys()];
let clock = Date.now() / 1000;
const out: Array<{ pass: number; text: string; silent: boolean; buttons: string[] }> = [];
let pass = 0;
const tg: Telegram = {
  send: async (_chat, text, opts) => {
    out.push({ pass, text, silent: Boolean(opts?.silent), buttons: (opts?.buttons ?? []).map((b) => `${b.text}${b.style ? ` [${b.style}]` : ""}`) });
    return { ok: true, messageId: 1000 + out.length };
  },
  updates: async () => [],
};
const deps: Deps = {
  store,
  tg,
  prices: (m) => dexQuotes(m),
  log: () => undefined,
  now: () => clock,
  sleep: async () => undefined,
  minGapS: 60,
};
const st = newPassState();
const cfg = { chatId: "dry-run", levels: LEVELS_DEFAULT };

// the positions as they stand
const q0 = await dexQuotes(mints);
console.log(`\n${q0.size} of ${mints.length} coins priced. Positions that are held and priced:`);
const symOf = (m: string) => symbols.get(m) ?? q0.get(m)?.symbol ?? m.slice(0, 6);
const lines: string[] = [];
for (const [m, f] of fills) {
  const p = openPosition(m, f);
  const q = q0.get(m) as Priced | undefined;
  if (!p || !q) continue;
  const r = readPosition(p, q, LEVELS_DEFAULT);
  const known = [...rows.keys()].filter((k) => k.startsWith(`${m}|${Math.floor(p.started)}|`)).map((k) => `${Number(k.split("|")[2])}:${rows.get(k)!.state[0]}`);
  lines.push(`   ${symOf(m).padEnd(14)} ${r.multiple.toFixed(2).padStart(7)}x  value $${r.value.toFixed(2).padStart(7)}  pool $${Math.round(q.liq).toString().padStart(8)}  alertable ${r.alertable ? "yes" : "no "}  reached ${JSON.stringify(r.reached)}  recorded ${known.join(" ")}`);
}
console.log(lines.sort().join("\n"));

for (pass = 1; pass <= PASSES; pass++) {
  const r = await runPass(cfg, deps, st, { persistStreaks: true });
  console.log(`\n-- pass ${pass}: ${r.positions} positions, ${r.priced} priced, ${r.sent} message(s) would be sent`);
  clock += 120;
}
console.log(`\n== ${out.length} message(s) in ${PASSES} passes`);
for (const m of out) {
  console.log(`\n[pass ${m.pass}${m.silent ? ", silent" : ", with sound"}] buttons: ${m.buttons.join(" | ")}\n${m.text.replace(/<\/?[a-z-]+[^>]*>/g, "")}`);
}
console.log(`\nstate after the dry run: ladder_v2 ${kv.has("ladder_v2") ? "set" : "not set"}, lines armed ${Object.keys(JSON.parse(kv.get("lines") ?? "{}")).length}`);
