/**
 * Where the free plans stand right now: the hosted database, what it sent out, what the scans used, Vercel's own counters, and what Telegram got.
 *
 *   LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/limits-check.ts
 *
 * Reads only. The Vercel numbers come from its usage API with the command-line login (if the login has expired: corepack pnpm dlx vercel whoami
 * refreshes it). Prints counts and sizes: never a token, a connection string or an address. The limits are in docs/LIMITS.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { hostedUrl } from "./lib/hosted.js";
import { EGRESS_USE_MB, rollingUse, todaysBudgetMb } from "../apps/web/lib/egressBudget";

const HOSTED = hostedUrl();
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const bar = (used: number, of: number) => {
  const p = Math.min(100, (100 * used) / of);
  return `${"#".repeat(Math.round(p / 5)).padEnd(20, ".")} ${p.toFixed(p < 10 ? 1 : 0)}%`;
};

async function hosted() {
  if (!HOSTED) return console.log("hosted database: set LAB_SYNC_URL to look at it\n");
  const db = new pg.Pool({ connectionString: HOSTED, max: 1, connectionTimeoutMillis: 20_000, ssl: { rejectUnauthorized: false } });
  try {
    const size = Number((await db.query(`SELECT pg_database_size(current_database()) AS b`)).rows[0].b);
    console.log("== Supabase Free (hosted database)");
    console.log(`  database       ${mb(size).padStart(8)} of 500 MB   ${bar(size, 500 * 1048576)}   (scanning pauses at 440 MB)`);
    const rows = (await db.query(`SELECT name, last_result FROM scan_lease WHERE name LIKE 'usage:%' ORDER BY name DESC LIMIT 60`)).rows as Array<{ name: string; last_result: any }>;
    const month = new Date().toISOString().slice(0, 7);
    let egress = 0;
    let cpu = 0;
    console.log("  day         sent out of the database   scan + exit-check CPU   (allowances: a rolling month for the data, 240 s a day for CPU)");
    const days = new Map<string, { e: number; c: number }>();
    for (const r of rows) {
      const m = /^usage:(egress:)?(\d{4}-\d{2}-\d{2})$/.exec(r.name);
      if (!m) continue;
      const d = days.get(m[2]!) ?? { e: 0, c: 0 };
      if (m[1]) d.e = Number(r.last_result?.bytes ?? 0);
      else d.c = Number(r.last_result?.cpuMs ?? 0) / 1000;
      days.set(m[2]!, d);
    }
    for (const [day, d] of [...days].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7)) console.log(`  ${day}  ${mb(d.e).padStart(10)}                 ${d.c.toFixed(0).padStart(5)} s`);
    for (const [day, d] of days) if (day.startsWith(month)) { egress += d.e; cpu += d.c; }
    console.log(`  this month     sent out ${mb(egress)} of 5 GB   ${bar(egress, 5 * 1073741824)}   (counted rows only; the meter started with the 2026-10-11 deployment)`);
    // the rolling month (lib/egressBudget.ts): everything counted plus the estimates for the days before the meter, the last 31 days against 4,500 MB, and today's allowance
    const all = (await db.query(`SELECT name, COALESCE((last_result->>'bytes')::bigint, 0) AS b FROM scan_lease WHERE name LIKE 'usage:egress%'`)).rows as Array<{ name: string; b: string }>;
    const roll = rollingUse(all.map((r) => ({ name: r.name, bytes: Number(r.b) })), Date.now());
    const window = roll.prevMb + roll.todayMb;
    console.log(`  last 31 days   sent out ${mb(window * 1048576)} of ${EGRESS_USE_MB} MB (90% of 5 GB)   ${bar(window, EGRESS_USE_MB)}   (site, laptop and backups, with estimates for 2026-10-08..10)`);
    console.log(`  today          ${roll.todayMb.toFixed(0)} MB used of an allowance of ${todaysBudgetMb(roll.prevMb)} MB (what the 30 days before left, at most 200)`);
    console.log(`  this month     counted CPU ${(cpu / 3600).toFixed(2)} h of 4 h   ${bar(cpu, 4 * 3600)}   (scans, the lab and the 24/7 exit check; the pages add a little)`);
    const tg = (await db.query(`SELECT count(*)::int AS n FROM telegram_messages WHERE sent_at > now() - interval '24 hours'`).catch(() => ({ rows: [{ n: "?" }] }))).rows[0].n;
    console.log(`  Telegram messages in the last 24 hours (hosted copy): ${tg}\n`);
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function vercel() {
  console.log("== Vercel Hobby (what Vercel itself counts this month)");
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), "Library/Application Support/com.vercel.cli/auth.json"), "utf8")) as { token?: string };
    const proj = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".vercel/project.json"), "utf8")) as { orgId: string };
    const from = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
    const res = await fetch(`https://api.vercel.com/v2/usage?teamId=${proj.orgId}&type=requests&from=${from}&to=${new Date(Date.now() + 86_400_000).toISOString()}`, { headers: { authorization: `Bearer ${auth.token}` } });
    if (!res.ok) return console.log(`  not available (http ${res.status}); refresh the login with: corepack pnpm dlx vercel whoami\n`);
    const data = ((await res.json()) as { data: any[] }).data;
    const sum = (k: string) => data.reduce((a, d) => a + (d[k] ?? 0), 0);
    const req = sum("request_hit_count") + sum("request_miss_count");
    const inv = sum("function_invocation_successful_count") + sum("function_invocation_error_count") + sum("function_invocation_throttle_count") + sum("function_invocation_timeout_count");
    const gbh = sum("function_execution_successful_gb_hours") + sum("function_execution_error_gb_hours") + sum("function_execution_timeout_gb_hours");
    console.log(`  requests       ${req.toLocaleString().padStart(9)} (plan: 1,000,000 function invocations)   ${bar(inv, 1_000_000)}  invocations ${inv.toLocaleString()}`);
    console.log(`  bandwidth out  ${(sum("bandwidth_outgoing_bytes") / 1073741824).toFixed(2).padStart(9)} GB of 100 GB   ${bar(sum("bandwidth_outgoing_bytes"), 100 * 1073741824)}`);
    console.log(`  function time  ${gbh.toFixed(2).padStart(9)} GB-hours (the CPU part is in the counted CPU above; Vercel shows Active CPU on its Usage page)`);
    console.log(`  throttled ${sum("function_invocation_throttle_count")}, timeouts ${sum("function_invocation_timeout_count")}, errors ${sum("function_invocation_error_count")}\n`);
  } catch (e) {
    console.log(`  not available: ${String((e as Error).message).slice(0, 80)}\n`);
  }
}

async function local() {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 1 });
  try {
    const r = (await db.query(`SELECT count(*) FILTER (WHERE kind = 'alert' AND ok)::int AS alerts, count(*) FILTER (WHERE ok)::int AS ok, count(*) FILTER (WHERE NOT ok)::int AS failed FROM telegram_messages WHERE sent_at > now() - interval '24 hours'`)).rows[0];
    console.log("== Telegram (free; the Bot API allows about 30 messages a second, one a second to one chat)");
    console.log(`  last 24 hours: ${r.ok} sent (${r.alerts} alerts, daily ceiling 40), ${r.failed} refused\n`);
  } catch {
    console.log("== Telegram: no local record yet\n");
  } finally {
    await db.end().catch(() => undefined);
  }
}

await hosted();
await vercel();
await local();
