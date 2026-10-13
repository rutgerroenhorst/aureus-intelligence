/**
 * Put a backup of the hosted database back (docs/DISASTER_RECOVERY.md).
 *
 *   corepack pnpm exec tsx scripts/restore-hosted.ts --from ../backups/<folder>/hosted --target local:aur_restore_test [--only my_trades,coin_checks] [--replace] [--dry-run]
 *   corepack pnpm exec tsx scripts/restore-hosted.ts --from ../backups/<folder>/hosted --target hosted --only my_trades --replace --yes
 *
 * --target    local:<name>  a database on the laptop's Postgres (made empty and migrated first; this is the practice run)
 *             hosted        the Supabase database (needs --yes)
 *             <url>         any other connection string (needs --yes)
 * The tables must exist already: a new database is first migrated (`DATABASE_URL=<url> corepack pnpm db:migrate`), which makes the tables, roles and functions.
 * A table that already has rows is left alone unless --replace is given (it is then emptied with DELETE first; the lab's immutable tables refuse that, by design).
 * Rows go back through jsonb_populate_recordset, so every column keeps its type. Sequences are reset afterwards and every table's row count is compared with the backup's manifest.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { connectTo, hostedUrl, localUrl, maskUrl, quoteIdent } from "./lib/hosted.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const from = opt("from");
const targetArg = opt("target");
if (!from || !targetArg) {
  console.error("usage: tsx scripts/restore-hosted.ts --from <backup>/hosted --target local:<db>|hosted|<url> [--only a,b] [--replace] [--dry-run] [--yes]");
  process.exit(2);
}
const dir = path.resolve(from);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "_manifest.json"), "utf8")) as { createdAt: string; tier: string; tables: Array<{ table: string; rows: number }> };
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const wanted = manifest.tables.filter((t) => !only || only.includes(t.table));
if (only) for (const o of only) if (!manifest.tables.some((t) => t.table === o)) throw new Error(`the backup has no table ${o}`);

let url: string;
let isLocal = false;
if (targetArg.startsWith("local:")) {
  const u = new URL(localUrl());
  u.pathname = `/${targetArg.slice(6)}`;
  url = u.toString();
  isLocal = true;
} else if (targetArg === "hosted") {
  const h = hostedUrl();
  if (!h) throw new Error("no hosted connection string (.env.hosted.local)");
  url = h;
} else url = targetArg;
if (!isLocal && !flag("yes") && !flag("dry-run")) {
  console.error(`this writes to ${maskUrl(url)}; add --yes if that is what you want (--dry-run shows what would happen)`);
  process.exit(2);
}

const q = quoteIdent;
const c = await connectTo(url, "aureus-restore");
console.log(`restore from ${dir} (made ${manifest.createdAt}, tier ${manifest.tier}) into ${maskUrl(url)}${flag("dry-run") ? "  [dry run]" : ""}`);

// ---- which of the tables exist, and in which order they can be filled (parents before the tables that point at them)
const exists = new Map<string, boolean>();
for (const t of wanted) exists.set(t.table, Boolean((await c.query("select to_regclass($1) as r", [`public.${q(t.table)}`])).rows[0].r));
const missing = wanted.filter((t) => !exists.get(t.table)).map((t) => t.table);
if (missing.length) {
  console.error(`these tables do not exist in the target: ${missing.join(", ")}\nMigrate it first: DATABASE_URL=<target> corepack pnpm db:migrate`);
  process.exit(1);
}
const fks = (
  await c.query(
    `select cc.relname as child, pc.relname as parent from pg_constraint k join pg_class cc on cc.oid = k.conrelid join pg_class pc on pc.oid = k.confrelid
       join pg_namespace n on n.oid = cc.relnamespace where k.contype = 'f' and n.nspname = 'public' and cc.relname <> pc.relname`,
  )
).rows as { child: string; parent: string }[];
const names = new Set(wanted.map((t) => t.table));
const waiting = new Map<string, Set<string>>(wanted.map((t) => [t.table, new Set(fks.filter((f) => f.child === t.table && names.has(f.parent)).map((f) => f.parent))]));
const order: string[] = [];
while (waiting.size) {
  const ready = [...waiting].filter(([, deps]) => [...deps].every((d) => order.includes(d))).map(([t]) => t);
  const next = ready.length ? ready : [[...waiting.keys()][0]!]; // a cycle: take one and go on
  for (const t of next) {
    order.push(t);
    waiting.delete(t);
  }
}

let problems = 0;
const done: Array<{ table: string; rows: number }> = [];
for (const table of order) {
  const want = manifest.tables.find((t) => t.table === table)!.rows;
  const have = Number((await c.query(`select count(*) n from public.${q(table)}`)).rows[0].n);
  if (have > 0 && !flag("replace")) {
    console.log(`  ${table}: already has ${have} rows: left alone (use --replace to empty it first)`);
    continue;
  }
  if (flag("dry-run")) {
    console.log(`  ${table}: would load ${want} rows${have ? ` after deleting ${have}` : ""}`);
    continue;
  }
  if (have > 0) await c.query(`delete from public.${q(table)}`);
  const cols = (
    await c.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`, [table])
  ).rows.map((r) => r.column_name as string);
  const colList = cols.map(q).join(", ");
  const insert = `insert into public.${q(table)} (${colList}) overriding system value select ${colList} from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb)`;
  let batch: string[] = [];
  let bytes = 0;
  let loaded = 0;
  const flush = async () => {
    if (!batch.length) return;
    await c.query(insert, [`[${batch.join(",")}]`]);
    loaded += batch.length;
    batch = [];
    bytes = 0;
  };
  await c.query("begin");
  try {
    // the reader is made only now, right before it is read: a reader made earlier can have finished (or dropped its lines) while the database was answering
    const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, `${table}.jsonl.gz`)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      batch.push(line);
      bytes += line.length;
      if (batch.length >= 500 || bytes > 4_000_000) await flush();
    }
    await flush();
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    console.error(`  ${table}: FAILED, nothing of it was kept: ${String((e as Error).message).slice(0, 200)}`);
    problems++;
    continue;
  }
  const got = Number((await c.query(`select count(*) n from public.${q(table)}`)).rows[0].n);
  const ok = got === want;
  if (!ok) problems++;
  console.log(`  ${table}: ${loaded} rows loaded, ${got} in the table, backup had ${want}${ok ? "" : "   <-- DIFFERENT"}`);
  done.push({ table, rows: got });
}

// ---- sequences go on after the highest number that came back
if (!flag("dry-run") && done.length) {
  const seqs = (
    await c.query(
      `select c.relname as t, a.attname as col, pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq
         from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and c.relname = any($1)`,
      [done.map((d) => d.table)],
    )
  ).rows.filter((r) => r.seq) as { t: string; col: string; seq: string }[];
  for (const s of seqs) await c.query(`select setval($1, coalesce((select max(${q(s.col)}) from public.${q(s.t)}), 1), (select max(${q(s.col)}) is not null from public.${q(s.t)}))`, [s.seq]);
  if (seqs.length) console.log(`  ${seqs.length} sequences reset`);
}
await c.end();
console.log(problems ? `\n${problems} problem(s): see the lines above` : `\nrestored: ${done.length} tables, ${done.reduce((s, d) => s + d.rows, 0).toLocaleString("en")} rows${flag("dry-run") ? "" : ", every count matches the backup"}`);
process.exitCode = problems ? 1 : 0;
