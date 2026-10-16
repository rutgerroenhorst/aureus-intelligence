/**
 * What does the hosted database send, and to whom? (docs/LIMITS.md, item 13)
 *
 *   corepack pnpm exec tsx scripts/egress-probe.ts [--seconds 360]
 *
 * Read-only. Takes a snapshot of pg_stat_statements (Supabase keeps it on), waits, takes another and prints the statements that ran in between, most rows first: the rows a statement returned are what leaves the database
 * (the free plan counts 5 GB a month). Run it over a window that holds one Radar build to see what a build reads, or over a quiet window to see what the clock's jobs read. The connection string comes from HOSTED_DATABASE_URL or the
 * git-ignored .env.hosted.local and is never printed. The rows are counted, not the bytes: multiply by the width of a row (the base list is about 280 bytes a row, a chain graduation about 520).
 */
import { connectTo, hostedUrl } from "./lib/hosted.js";

const i = process.argv.indexOf("--seconds");
const seconds = i >= 0 ? Number(process.argv[i + 1]) : 360;
const url = hostedUrl();
if (!url) {
  console.error("no connection string: set HOSTED_DATABASE_URL or fill .env.hosted.local");
  process.exit(2);
}
const c = await connectTo(url, "aureus-egress-probe");
const snap = async () => {
  const r = await c.query(`select queryid::text, calls, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as q from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())`);
  return new Map<string, { calls: number; rows: number; q: string }>(r.rows.map((x: any) => [x.queryid, { calls: Number(x.calls), rows: Number(x.rows), q: x.q }]));
};
const a = await snap();
const t0 = Date.now();
await new Promise((r) => setTimeout(r, seconds * 1000));
const b = await snap();
const rows = [...b.entries()]
  .map(([id, x]) => ({ q: x.q, calls: x.calls - (a.get(id)?.calls ?? 0), rows: x.rows - (a.get(id)?.rows ?? 0) }))
  .filter((x) => x.calls > 0 && !/pg_stat_statements/.test(x.q))
  .sort((x, y) => y.rows - x.rows);
console.log(`window ${((Date.now() - t0) / 1000).toFixed(0)} s; ${rows.length} statements ran; rows returned or written, most first:`);
for (const r of rows.slice(0, 25)) console.log(String(r.rows).padStart(7), "rows", String(r.calls).padStart(4), "calls |", r.q.slice(0, 150));
await c.end();
