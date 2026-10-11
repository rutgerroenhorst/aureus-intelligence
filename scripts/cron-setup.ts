/**
 * The clock that makes the site run by itself, day and night, without the laptop and without a screen open.
 *
 * Two jobs live inside the hosted database (Supabase's pg_cron). Each one calls the site over HTTPS with the site's secret (pg_net does the call):
 *   aureus-exit-alerts   every 2 minutes   GET /api/cron/exit-alerts   the Telegram exit check (apps/web/lib/exitTick.ts)
 *   aureus-maintenance   every 30 minutes  GET /api/scan                the site's own scan / learning round, the same one a screen asks for
 * Vercel's own cron cannot do this on the free plan (once a day at most), which is why the clock is in the database.
 *
 *   LAB_SYNC_URL=<hosted connection string> CRON_SECRET=<secret> corepack pnpm exec tsx scripts/cron-setup.ts install
 *   LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/cron-setup.ts status
 *   LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/cron-setup.ts remove [--secret]
 *
 * `install` is safe to run again (it updates what exists). The secret is stored in Supabase Vault (encrypted) and also has to be the CRON_SECRET of the
 * Vercel project, which is what the site compares it with; it is never printed, never written to a file by this script and never part of a job's text:
 * the jobs read it from the vault when they run. SITE_URL defaults to the production address. `remove` stops the clock (the site keeps working
 * as before; only the unattended checks stop). The extensions stay installed; `--secret` also deletes the vault entry.
 */
import pg from "pg";

const HOSTED = process.env.LAB_SYNC_URL ?? process.env.CLOUD_URL;
const SITE = (process.env.SITE_URL ?? "https://aureus-intelligence-nu.vercel.app").replace(/\/+$/, "");
const SECRET_NAME = "aureus_cron_secret";

const JOBS = [
  { name: "aureus-exit-alerts", every: "*/2 * * * *", path: "/api/cron/exit-alerts" },
  { name: "aureus-maintenance", every: "*/30 * * * *", path: "/api/scan" },
] as const;

/** What a job runs: one HTTPS call with the secret read from the vault at that moment (never copied into the job's text). */
const jobCommand = (site: string, path: string) =>
  `select net.http_get(url := '${site}${path}', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}' limit 1)), timeout_milliseconds := 30000);`;

async function main() {
  const cmd = process.argv[2] ?? "status";
  if (!["install", "status", "remove"].includes(cmd)) throw new Error("use: install | status | remove [--secret]");
  if (!HOSTED) throw new Error("set LAB_SYNC_URL to the hosted database's connection string");
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(SITE)) throw new Error("SITE_URL must look like https://host");
  const db = new pg.Pool({ connectionString: HOSTED, max: 1, connectionTimeoutMillis: 20_000, ssl: { rejectUnauthorized: false } });
  try {
    if (cmd === "install") await install(db);
    else if (cmd === "remove") await remove(db, process.argv.includes("--secret"));
    else await status(db);
  } finally {
    await db.end();
  }
}

async function install(db: pg.Pool) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!/^[A-Za-z0-9_\-=+/.]{32,200}$/.test(secret)) throw new Error("CRON_SECRET must be 32-200 plain characters (letters, digits and _-=+/.)");
  await db.query(`create extension if not exists pg_cron with schema pg_catalog`);
  await db.query(`create extension if not exists pg_net with schema extensions`);
  const have = (await db.query(`select id from vault.secrets where name = $1`, [SECRET_NAME])).rows[0];
  if (have) await db.query(`select vault.update_secret($1::uuid, $2::text)`, [have.id, secret]);
  else await db.query(`select vault.create_secret($1::text, $2::text, 'sent by the database clock to the site as Authorization: Bearer')`, [secret, SECRET_NAME]);
  console.log(`vault: secret ${SECRET_NAME} ${have ? "updated" : "created"} (not shown)`);
  for (const j of JOBS) {
    const r = await db.query(`select cron.schedule($1::text, $2::text, $3::text) as id`, [j.name, j.every, jobCommand(SITE, j.path)]);
    console.log(`job ${j.name}: ${j.every} -> ${SITE}${j.path} (id ${r.rows[0].id})`);
  }
}

async function remove(db: pg.Pool, withSecret: boolean) {
  const jobs = (await db.query(`select jobname from cron.job where jobname like 'aureus-%'`)).rows;
  for (const j of jobs) await db.query(`select cron.unschedule($1::text)`, [j.jobname]);
  console.log(`jobs removed: ${jobs.length}`);
  if (withSecret) {
    const r = await db.query(`delete from vault.secrets where name = $1`, [SECRET_NAME]);
    console.log(`vault secret removed: ${r.rowCount ?? 0}`);
  }
}

async function status(db: pg.Pool) {
  const jobs = (await db.query(`select jobname, schedule, active from cron.job where jobname like 'aureus-%' order by jobname`)).rows;
  if (!jobs.length) console.log("no clock jobs installed");
  for (const j of jobs) console.log(`job ${j.jobname}  ${j.schedule}  ${j.active ? "active" : "OFF"}`);
  const runs = (
    await db.query(
      `select j.jobname, d.status, to_char(d.start_time at time zone 'UTC','MM-DD HH24:MI:SS') as at, left(coalesce(d.return_message,''), 80) as msg
         from cron.job_run_details d join cron.job j using (jobid) where j.jobname like 'aureus-%' order by d.start_time desc limit 8`,
    )
  ).rows;
  console.log("-- last runs of the clock");
  for (const r of runs) console.log(`  ${r.at}  ${r.jobname}  ${r.status}  ${r.msg}`);
  // pg_net keeps the answers for a few hours; what the site answered shows here (counts and short results, no secrets)
  const answers = (await db.query(`select status_code, timed_out, left(coalesce(error_msg,''), 80) as err, left(coalesce(content,''), 150) as body, to_char(created at time zone 'UTC','MM-DD HH24:MI:SS') as at from net._http_response order by created desc limit 6`)).rows;
  console.log("-- last answers of the site");
  for (const a of answers) console.log(`  ${a.at}  http ${a.status_code ?? "-"}${a.timed_out ? " TIMED OUT" : ""}${a.err ? ` ${a.err}` : ""}  ${a.body}`);
  const hist = (await db.query(`select status_code, count(*)::int as n from net._http_response group by 1 order by 1`)).rows;
  console.log(`-- answers kept: ${hist.map((h) => `${h.status_code ?? "none"} x${h.n}`).join(", ") || "none"}`);
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://***"));
  process.exit(1);
});
