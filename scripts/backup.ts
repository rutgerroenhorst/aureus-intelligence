/**
 * Back up what cannot be rebuilt from git (docs/DISASTER_RECOVERY.md).
 *
 *   corepack pnpm exec tsx scripts/backup.ts [--tier user|essentials|all] [--label text] [--out dir] [--local] [--git] [--no-hosted]
 *
 * - hosted database (Supabase): every table as gzipped JSON lines, plus the schema, the privileges, the clock's jobs, the names of the vault entries and the roles.
 *   READ ONLY, and it costs egress from the free database, so there are three sizes:
 *     --tier user         the journal, the Checks, the followed wallet and its reads, the alert state, the Telegram log, the lab's reports (under 3 MB: fine every day)
 *     --tier essentials   (default) everything except the big rolling history tables (about 30 MB: fine every week)
 *     --tier all          every table (about 190 MB, which is 4% of a month's free egress: before a risky change, or monthly)
 * - --local   a pg_dump of the laptop database (about 1 GB; the research record)
 * - --git     a git bundle of the whole repository (every branch and tag), so the code survives the loss of GitHub
 *
 * The backup lands next to the repository, never inside it: ../backups/<date>-<label>/. It holds personal data: keep it private, and never commit it.
 * Secrets are never exported (the vault is listed by name only, no connection string is written).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { REPO, HISTORY_TABLES, USER_TABLES, connectTo, hostedUrl, localUrl, maskUrl, quoteIdent } from "./lib/hosted.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const tier = (opt("tier") ?? "essentials") as "user" | "essentials" | "all";
if (!["user", "essentials", "all"].includes(tier)) throw new Error("--tier must be user, essentials or all");
const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const label = (opt("label") ?? tier).replace(/[^a-zA-Z0-9_-]+/g, "-");
const outDir = path.resolve(opt("out") ?? path.join(REPO, "..", "backups", `${stamp}-${label}`));
fs.mkdirSync(outDir, { recursive: true });
console.log(`backup -> ${outDir}`);

const q = quoteIdent;
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function exportHosted() {
  const url = hostedUrl();
  if (!url) {
    console.log("hosted database: no connection string (HOSTED_DATABASE_URL or .env.hosted.local): skipped");
    return;
  }
  const dir = path.join(outDir, "hosted");
  fs.mkdirSync(dir, { recursive: true });
  const c = await connectTo(url, "aureus-backup");
  console.log(`hosted database: ${maskUrl(url)}`);
  const version = (await c.query("select version() v")).rows[0].v as string;

  // ---- the tables
  const tables = (
    await c.query(
      `select c.relname as t, c.relkind = 'p' as partitioned from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition order by c.relname`,
    )
  ).rows as { t: string; partitioned: boolean }[];
  const wanted = tables.filter((x) => (tier === "all" ? true : tier === "user" ? USER_TABLES.has(x.t) : !HISTORY_TABLES.has(x.t)));
  const manifest: Array<{ table: string; rows: number; bytesGz: number; partitioned: boolean }> = [];
  let downloaded = 0;
  for (const { t, partitioned } of wanted) {
    const file = path.join(dir, `${t}.jsonl.gz`);
    const gz = zlib.createGzip({ level: 6 });
    const ws = fs.createWriteStream(file);
    gz.pipe(ws);
    await c.query("BEGIN READ ONLY");
    await c.query(`DECLARE bk NO SCROLL CURSOR FOR SELECT row_to_json(x)::text AS j FROM public.${q(t)} x`);
    let rows = 0;
    for (;;) {
      const r = await c.query("FETCH FORWARD 2000 FROM bk");
      if (!r.rows.length) break;
      for (const row of r.rows) {
        downloaded += (row.j as string).length + 1;
        if (!gz.write(`${row.j}\n`)) await once(gz, "drain");
      }
      rows += r.rows.length;
    }
    await c.query("CLOSE bk");
    await c.query("COMMIT");
    gz.end();
    await once(ws, "finish");
    manifest.push({ table: t, rows, bytesGz: fs.statSync(file).size, partitioned });
  }
  const total = manifest.reduce((s, m) => s + m.rows, 0);
  fs.writeFileSync(
    path.join(dir, "_manifest.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), tier, serverVersion: version, skippedTables: tables.filter((x) => !wanted.includes(x)).map((x) => x.t), tables: manifest }, null, 1),
  );

  // ---- everything around the data, so the setup can be compared and rebuilt
  const one = async (name: string, sql: string) => fs.writeFileSync(path.join(dir, name), JSON.stringify((await c.query(sql)).rows, null, 1));
  await one(
    "_schema.json",
    `select c.relname as "table", c.relkind, c.relispartition as is_partition, c.relrowsecurity as rls,
        (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
                'default', pg_get_expr(d.adbin, d.adrelid), 'generated', a.attgenerated, 'identity', a.attidentity) order by a.attnum)
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
        (select json_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid = c.oid) as constraints,
        (select json_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid = c.oid) as indexes
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  );
  await one(
    "_acl.json",
    `select 'table' as kind, c.relname::text as name, c.relacl::text as acl from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'v')
     union all select 'function', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     union all select 'default-acl', pg_get_userbyid(d.defaclrole)::text || ' ' || d.defaclobjtype::text, d.defaclacl::text from pg_default_acl d
     order by 1, 2`,
  );
  await one("_roles.json", `select rolname, rolsuper, rolcanlogin, rolbypassrls, rolinherit from pg_roles where rolname !~ '^pg_' order by 1`);
  await one("_extensions.json", `select extname, extversion from pg_extension order by 1`);
  try {
    await one("_cron.json", `select jobid, jobname, schedule, command, active from cron.job order by jobname`);
  } catch (e) {
    console.log(`  (no cron jobs listed: ${String((e as Error).message).slice(0, 80)})`);
  }
  try {
    // names only: the values of the vault are never read
    await one("_vault-names.json", `select name, description from vault.secrets order by name`);
  } catch (e) {
    console.log(`  (vault names not listed: ${String((e as Error).message).slice(0, 80)})`);
  }
  await c.end();
  console.log(`hosted database: ${wanted.length} tables, ${total.toLocaleString("en")} rows, ${mb(manifest.reduce((s, m) => s + m.bytesGz, 0))} compressed; about ${mb(downloaded)} came out of the free database (monthly free egress is 5,000 MB)`);
}

async function dumpLocal() {
  const file = path.join(outDir, "local-aureus.dump");
  const free = Number(execFileSync("df", ["-k", outDir]).toString().split("\n")[1]!.split(/\s+/)[3]) * 1024;
  console.log(`laptop database: pg_dump -Fc -Z 3 (free disk: ${mb(free)})`);
  if (free < 4 * 1024 ** 3) throw new Error("less than 4 GB free on the disk: not starting a laptop database dump");
  const u = new URL(localUrl());
  const child = spawn("docker", ["exec", "-e", `PGPASSWORD=${decodeURIComponent(u.password)}`, "aureus_postgres", "pg_dump", "-U", decodeURIComponent(u.username), "-Fc", "-Z", "3", u.pathname.slice(1)], { stdio: ["ignore", "pipe", "inherit"] });
  const ws = fs.createWriteStream(file);
  const written = new Promise<void>((resolve) => ws.on("finish", () => resolve()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  child.stdout.pipe(ws);
  const code = await exited;
  await written;
  if (code !== 0) throw new Error(`pg_dump exited with ${code}`);
  console.log(`laptop database: ${mb(fs.statSync(file).size)} -> local-aureus.dump (restore: docker exec -i aureus_postgres pg_restore -U aureus -d <empty db> --no-owner < local-aureus.dump)`);
}

function bundleGit() {
  const file = path.join(outDir, "repo.bundle");
  execFileSync("git", ["bundle", "create", file, "--all"], { cwd: REPO, stdio: "pipe" });
  console.log(`repository: ${mb(fs.statSync(file).size)} -> repo.bundle (every branch and tag; restore with: git clone repo.bundle aureus-intelligence)`);
}

function copyPrivate() {
  const src = path.join(REPO, ".private");
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, path.join(outDir, "private"), { recursive: true });
  console.log("private notes (.private/) copied");
}

let gitState = "";
try {
  gitState = execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { cwd: REPO }).toString().trim();
} catch {}
fs.writeFileSync(path.join(outDir, "_info.json"), JSON.stringify({ createdAt: new Date().toISOString(), tier, label, git: gitState, node: process.version }, null, 1));

if (!flag("no-hosted")) await exportHosted();
if (flag("local")) await dumpLocal();
if (flag("git")) bundleGit();
copyPrivate();
fs.chmodSync(outDir, 0o700);
console.log(`done. This folder holds personal data: keep it private (docs/DISASTER_RECOVERY.md says how to restore from it).`);
