/**
 * Read-only calibration of the Check button (docs/COIN_CHECK.md): runs the check's judgement over the coins the hosted Radar lists right now and prints, per coin, what it
 * concluded and why, and how often each verdict came out. Writes nothing: no check is recorded, no database row is changed.
 *
 *   corepack pnpm exec tsx scripts/check-calibration.ts
 *   LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/check-calibration.ts      (adds this system's own record of each coin; only SELECTs are run)
 *
 * SITE_URL defaults to the production address. About 40 coins take two minutes (each asks DexScreener, Jupiter twice and RugCheck, one coin every 1.2 s).
 * Why it exists: a check that agrees with most of what it is shown is worth nothing. The first version agreed with 36% of the Radar's coins because one mild sign fired on 40% of them;
 * run this again after changing a threshold, and when the Learning page has enough checks to grade the verdicts against how the coins really ended.
 */
import pg from "pg";
import { fetchExtras, fetchFresh, judgeCoin, looksDead } from "../apps/web/lib/coinCheck";
import { hostedUrl } from "./lib/hosted.js";
import { serviceSecret } from "./lib/hosted.js";

const SITE = process.env.SITE_URL ?? "https://aureus-intelligence-nu.vercel.app";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Pick {
  tab: string;
  symbol: string;
  mint: string;
}

async function main() {
  const secret = await serviceSecret(); // the site is locked (docs/ACCESS.md): the service secret opens it
  const res = await fetch(`${SITE}/api/radar-bundle`, { headers: { accept: "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) } });
  if (!res.ok) throw new Error(`radar-bundle ${res.status}`);
  const d = (await res.json()).data;
  const picks: Pick[] = [];
  const add = (tab: string, list: any[] | undefined, n: number) => {
    for (const c of (list ?? []).slice(0, n)) if (c?.mint && !picks.some((p) => p.mint === c.mint)) picks.push({ tab, symbol: c.symbol ?? "?", mint: c.mint });
  };
  add("elite", d.elite?.candidates, 7);
  add("cate", d.cate?.cateCoins, 5);
  add("buy_signals", d.signals?.buy_signals, 10);
  add("runners", d.runners?.candidates, 14);
  add("graduates", (d.graduates?.candidates ?? []).filter((g: any) => g.healthy !== false), 8);
  add("ultra_momentum", d.ultraEarlyMomentum?.candidates, 1);

  const url = hostedUrl();
  const db = url ? new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 }) : null;
  const noDb = { query: async () => ({ rows: [] as any[] }) };
  const tally: Record<string, number> = {};
  const flagCount = new Map<string, number>();
  try {
    for (const p of picks) {
      const fresh = await fetchFresh("solana", p.mint);
      const extras = fresh && fresh !== "error" && !looksDead(fresh) ? await fetchExtras("solana", p.mint, fresh, (db ?? noDb) as any) : {};
      const j = judgeCoin(fresh, { tab: p.tab }, extras);
      tally[j.verdict] = (tally[j.verdict] ?? 0) + 1;
      for (const f of j.flags) flagCount.set(f.replace(/\d+/g, "N"), (flagCount.get(f.replace(/\d+/g, "N")) ?? 0) + 1);
      const liq = fresh && fresh !== "error" ? `${Math.round((fresh.liq ?? 0) / 1000)}K` : "-";
      console.log(`${p.tab.padEnd(15)} ${p.symbol.slice(0, 12).padEnd(13)} liq ${liq.padStart(6)}  ${j.verdict.padEnd(9)} ${j.flags.join("; ").slice(0, 110)}`);
      await sleep(1200);
    }
  } finally {
    await db?.end();
  }
  const n = picks.length;
  console.log(`\nverdicts of ${n} coins: ${Object.entries(tally).map(([k, v]) => `${k} ${v} (${Math.round((100 * v) / n)}%)`).join(", ")}${db ? "" : "   (this system's own record not used: no LAB_SYNC_URL)"}`);
  console.log("most common warning signs:");
  for (const [f, c] of [...flagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(c).padStart(3)} of ${n}  ${f}`);
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e));
  process.exit(1);
});
