/**
 * The clock that makes the site run by itself, day and night, without the laptop and without a screen open.
 *
 * Six jobs live inside the hosted database (Supabase's pg_cron). Four call the site over HTTPS with the site's secret (pg_net does the call):
 *   aureus-exit-alerts   every 2 minutes   GET /api/cron/exit-alerts        the Telegram exit check (apps/web/lib/exitTick.ts)
 *   aureus-graduates     every 3 minutes   GET /api/cron/graduates         pump.fun's graduations read from the chain (lib/graduateFeed.ts), so the Graduations tab
 *                                                                           runs without the laptop
 *   aureus-maintenance   hourly, at :00    GET /api/scan                     the site's own round when nobody has a screen open: a market scan if one is due, then the
 *                                                                           learning round and the housekeeping (RETENTION_DAYS), exactly what a screen asks for
 *   aureus-learning      hourly, at :30    GET /api/scan?only=learning       follows and grades the coins already tracked (cheap: no market scan, little written)
 *   aureus-cron-cleanup  daily 03:15 UTC   (SQL only)                        deletes the clock's own run history older than 2 days (pg_cron never does; 720 rows a day)
 *   aureus-watchdog      every 5 minutes   (SQL only, db/hosted/watchdog.sql) messages the user on Telegram when the site's own exit check has stopped or gets no prices
 *                                                                           (only installed when EXIT_ALERT_TOKEN and EXIT_ALERT_CHAT_ID are in the environment: the bot token and
 *                                                                           the chat go to Supabase Vault, are read from there each time and never appear in a job's text)
 * Why the market scan is hourly while nobody looks: every coin it checks writes about 13 KB to the 500 MB free database (about 4,000 checks a day made it grow
 * 40-60 MB a day), a screen that is open still gets one every 10 minutes, and a screen that opens after a quiet spell asks for a catch-up scan itself.
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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hostedUrl } from "./lib/hosted.js";

const HOSTED = hostedUrl();
const SITE = (process.env.SITE_URL ?? "https://aureus-intelligence-nu.vercel.app").replace(/\/+$/, "");
const SECRET_NAME = "aureus_cron_secret";
const TOKEN_NAME = "aureus_telegram_token";
const CHAT_NAME = "aureus_telegram_chat";
const WATCHDOG_SQL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "hosted", "watchdog.sql");

const JOBS: ReadonlyArray<{ name: string; every: string; path?: string; sql?: string }> = [
  { name: "aureus-exit-alerts", every: "*/2 * * * *", path: "/api/cron/exit-alerts" },
  { name: "aureus-graduates", every: "*/3 * * * *", path: "/api/cron/graduates" },
  { name: "aureus-maintenance", every: "0 * * * *", path: "/api/scan" },
  { name: "aureus-learning", every: "30 * * * *", path: "/api/scan?only=learning" },
  { name: "aureus-cron-cleanup", every: "15 3 * * *", sql: "delete from cron.job_run_details where end_time < now() - interval '2 days';" },
];

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
  await putSecret(db, SECRET_NAME, secret, "sent by the database clock to the site as Authorization: Bearer");
  for (const j of JOBS) await schedule(db, j);

  // the watchdog: needs the bot token and the paired chat, which come from the environment and go straight into the vault
  const token = process.env.EXIT_ALERT_TOKEN ?? "";
  const chat = process.env.EXIT_ALERT_CHAT_ID ?? "";
  if (!token && !chat) {
    console.log("watchdog: not touched (EXIT_ALERT_TOKEN and EXIT_ALERT_CHAT_ID are not in the environment); one installed earlier keeps running, `status` shows whether it is there");
    return;
  }
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(token)) throw new Error("EXIT_ALERT_TOKEN does not look like a Telegram bot token");
  if (!/^-?\d{3,20}$/.test(chat)) throw new Error("EXIT_ALERT_CHAT_ID must be a number");
  await putSecret(db, TOKEN_NAME, token, "the Telegram bot token, read by the watchdog (db/hosted/watchdog.sql) when it has something to say");
  await putSecret(db, CHAT_NAME, chat, "the paired Telegram chat, read by the watchdog");
  await db.query(fs.readFileSync(WATCHDOG_SQL, "utf8"));
  console.log("watchdog: function public.aureus_watchdog installed");
  await schedule(db, { name: "aureus-watchdog", every: "*/5 * * * *", sql: "select public.aureus_watchdog();" });
}

async function putSecret(db: pg.Pool, name: string, value: string, description: string) {
  const have = (await db.query(`select id from vault.secrets where name = $1`, [name])).rows[0];
  if (have) await db.query(`select vault.update_secret($1::uuid, $2::text)`, [have.id, value]);
  else await db.query(`select vault.create_secret($1::text, $2::text, $3::text)`, [value, name, description]);
  console.log(`vault: secret ${name} ${have ? "updated" : "created"} (not shown)`);
}

async function schedule(db: pg.Pool, j: { name: string; every: string; path?: string; sql?: string }) {
  const r = await db.query(`select cron.schedule($1::text, $2::text, $3::text) as id`, [j.name, j.every, j.path ? jobCommand(SITE, j.path) : j.sql!]);
  console.log(`job ${j.name}: ${j.every} -> ${j.path ? `${SITE}${j.path}` : "SQL"} (id ${r.rows[0].id})`);
}

async function remove(db: pg.Pool, withSecret: boolean) {
  const jobs = (await db.query(`select jobname from cron.job where jobname like 'aureus-%'`)).rows;
  for (const j of jobs) await db.query(`select cron.unschedule($1::text)`, [j.jobname]);
  console.log(`jobs removed: ${jobs.length}`);
  if (withSecret) {
    const r = await db.query(`delete from vault.secrets where name = any($1::text[])`, [[SECRET_NAME, TOKEN_NAME, CHAT_NAME]]);
    console.log(`vault secrets removed: ${r.rowCount ?? 0}`);
    await db.query(`drop function if exists public.aureus_watchdog(boolean, text, text)`);
    await db.query(`drop function if exists public.aureus_dur(numeric)`);
    console.log("watchdog functions dropped");
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
  // the watchdog: is it there, can it speak, what does it think of the site's check right now (names and states only, never a secret)
  const w = (
    await db.query(
      `select to_regprocedure('public.aureus_watchdog(boolean,text,text)') is not null as installed,
              (select count(*)::int from vault.secrets where name in ($1, $2)) as secrets,
              (select value from exit_alert_kv where key = 'watchdog') as state,
              (select round((extract(epoch from (now() - updated_at)) / 60)::numeric, 1) from exit_alert_kv where key = 'hosted_tick_ok') as beat_min`,
      [TOKEN_NAME, CHAT_NAME],
    )
  ).rows[0];
  console.log(`-- watchdog: ${w.installed ? "installed" : "NOT installed"}, ${w.secrets}/2 secrets in the vault, the site's last finished check ${w.beat_min == null ? "never" : `${w.beat_min} min ago`}, state ${w.state ?? "none yet"}`);
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://***"));
  process.exit(1);
});
