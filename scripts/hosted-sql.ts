/**
 * Ask the hosted (Supabase) database a question, from the laptop.
 *
 *   corepack pnpm exec tsx scripts/hosted-sql.ts "select count(*) from my_trades"
 *   corepack pnpm exec tsx scripts/hosted-sql.ts --local "select count(*) from my_trades"      the laptop database instead
 *   corepack pnpm exec tsx scripts/hosted-sql.ts --write "update ..."                          anything that changes data needs --write
 *
 * Read-only by default (the session itself is read only, so a statement that tries to write fails even when it is hidden in a function).
 * The connection string comes from HOSTED_DATABASE_URL or the git-ignored .env.hosted.local and is never printed. Output is JSON.
 */
import { connectTo, hostedUrl, localUrl } from "./lib/hosted.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const local = args.includes("--local");
// only the two flags are flags: an SQL text may itself start with "--" (a comment)
const sql = args.filter((a) => a !== "--write" && a !== "--local").join(" ").trim();
if (!sql) {
  console.error('usage: tsx scripts/hosted-sql.ts [--local] [--write] "<sql>"');
  process.exit(2);
}
const url = local ? localUrl() : hostedUrl();
if (!url) {
  console.error("no connection string: set HOSTED_DATABASE_URL or fill .env.hosted.local");
  process.exit(2);
}
const c = await connectTo(url, "aureus-sql");
try {
  if (!write) await c.query("SET default_transaction_read_only = on");
  const res = await c.query(sql);
  const last = Array.isArray(res) ? res[res.length - 1]! : res;
  console.log(JSON.stringify(last.rows, null, 1));
  if (!last.rows.length && last.rowCount != null) console.error(`(${last.command} ${last.rowCount})`);
} finally {
  await c.end();
}
