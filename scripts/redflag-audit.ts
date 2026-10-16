/**
 * How many coins that the live tabs show by default carry a severe red flag right now? (docs/RED_FLAGS.md)
 *
 *   corepack pnpm exec tsx scripts/redflag-audit.ts [--base https://aureus-intelligence-nu.vercel.app] [--local]
 *
 * Read-only. Logs in with the access code of `.env.access.local` (like scripts/access-code.ts does; never printed), reads what the Radar page reads (/api/radar-bundle and /api/hot-chains), takes the coins each tab shows by default,
 * and checks every one INDEPENDENTLY of the site's own gate: DexScreener's list of all pools of the coin (not the batch answer the gate uses, which can hand back a stale bonding-curve pair), the best priced pool by liquidity,
 * and the same rules (lib/redFlags.ts). After the gate is live the answer should be zero everywhere; a number above zero is a coin the gate let through (a minute of lag is normal: the lists are kept for a minute).
 * With --local the site on 127.0.0.1:3000 is asked (no login). Prints coin counts and flags, never an address.
 */
import path from "node:path";
import { loadEnvFile, REPO } from "./lib/hosted.js";
import { bestPricedPair, fetchAllPairs, type DexPairLike } from "../apps/web/lib/dexPairs";
import { liveStateOf } from "../apps/web/lib/liveQuotes";
import { liveRedFlags, FLAG_WORD, type FlagCode } from "../apps/web/lib/redFlags";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const LOCAL = process.argv.includes("--local");
const base = LOCAL ? "http://127.0.0.1:3000" : arg("base", "https://aureus-intelligence-nu.vercel.app");
let cookie = "";
if (!LOCAL) {
  loadEnvFile(path.join(REPO, ".env.access.local"));
  const code = process.env.SITE_ACCESS_CODE;
  if (!code) throw new Error("no access code file (.env.access.local)");
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${encodeURIComponent(code)}&next=/` });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (!cookie) throw new Error(`login failed (${login.status})`);
}
const get = async (p: string) => (await fetch(base + p, { headers: cookie ? { cookie } : {} })).json();
const bundle = (await get("/api/radar-bundle")).data;
const hot = await get("/api/hot-chains");

interface Item { tab: string; mint: string; symbol: string }
const items: Item[] = [];
const add = (tab: string, list: any[] | undefined, shown: (c: any) => boolean = () => true) => {
  for (const c of list ?? []) if (shown(c)) items.push({ tab, mint: c.mint, symbol: c.symbol ?? "?" });
};
add("graduations", bundle.graduates?.candidates, (c) => c.healthy !== false);
add("incubation", bundle.incubation?.candidates);
add("ultra_momentum", bundle.ultraEarlyMomentum?.candidates);
add("buy_signals", bundle.signals?.buy_signals);
add("cate", bundle.cate?.cateCoins);
add("runners", bundle.runners?.candidates);
add("elite", bundle.elite?.candidates);
// the Hot tab keeps pools per network and its own rule (HotChains.tsx isNewSmall): the Solana pools stand for it here
const sol = (hot?.pools?.solana ?? []) as any[];
for (const p of sol) if ((p.liq ?? 0) >= 10_000 && (p.vol24 ?? 0) >= 10_000 && ((p.ageH ?? 1e9) <= 720 || (p.ch24 ?? 0) >= 100)) items.push({ tab: "hot:solana (before its own red-flag rule)", mint: p.address, symbol: p.symbol ?? "?" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
const getJson = async (url: string): Promise<unknown> => {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
      if (r.status === 429) {
        await sleep(2500 * (a + 1));
        continue;
      }
      return r.ok ? await r.json() : null;
    } catch {
      await sleep(1000);
    }
  }
  return null;
};
const checked = new Map<string, FlagCode[] | "unknown">();
for (const m of [...new Set(items.map((i) => i.mint))]) {
  const all = await fetchAllPairs(m, getJson);
  await sleep(220);
  if (all == null) {
    checked.set(m, "unknown");
    continue;
  }
  const best = bestPricedPair(all, m);
  const state = best ? liveStateOf(best as DexPairLike & { priceChange?: any; txns?: any }) : null;
  checked.set(m, liveRedFlags(state).map((f) => f.code));
}
console.log(`${base}: ${items.length} coins shown by default, ${new Set(items.map((i) => i.mint)).size} different\n`);
console.log("tab                                         shown  with a severe flag now   (flags)");
let total = 0;
for (const tab of [...new Set(items.map((i) => i.tab))]) {
  const a = items.filter((i) => i.tab === tab);
  const flagged = a.filter((i) => {
    const c = checked.get(i.mint);
    return c !== "unknown" && c != null && c.length > 0;
  });
  const unknown = a.filter((i) => checked.get(i.mint) === "unknown").length;
  total += flagged.length;
  const words = new Map<string, number>();
  for (const i of flagged) for (const c of checked.get(i.mint) as FlagCode[]) words.set(FLAG_WORD[c], (words.get(FLAG_WORD[c]) ?? 0) + 1);
  console.log(`${tab.padEnd(43)} ${String(a.length).padStart(4)}   ${String(flagged.length).padStart(4)} (${a.length ? Math.round((100 * flagged.length) / a.length) : 0}%)${unknown ? `  [${unknown} not readable]` : ""}   ${[...words.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join("; ")}`);
}
console.log(`\ntotal with a severe flag: ${total}${total ? ` (e.g. ${items.filter((i) => (checked.get(i.mint) as FlagCode[] | undefined)?.length).slice(0, 6).map((i) => i.symbol).join(", ")})` : ""}`);
