/**
 * Checks the watchdog (db/hosted/watchdog.sql) against a SCRATCH database, with stand-ins for pg_net and Vault: every state it can be in, the messages it sends and
 * does not send, that nothing is said twice, that the secrets stay out of the texts and the state, and that a test message is silent.
 *
 *   docker exec aureus_postgres psql -U aureus -d postgres -c "create database aureus_scratch"
 *   DATABASE_URL=postgres://...@localhost:5432/aureus_scratch corepack pnpm exec tsx scripts/cron-watchdog-test.ts
 *   docker exec aureus_postgres psql -U aureus -d postgres -c "drop database aureus_scratch"
 *
 * It refuses any database whose name does not contain "scratch": it creates schemas called net and vault, which the real hosted database already has
 * (and which must never be touched).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/\/[A-Za-z0-9_]*scratch[A-Za-z0-9_]*(\?.*)?$/.test(url)) {
  console.error("DATABASE_URL must point at a database whose name contains 'scratch' (see the top of this file).");
  process.exit(2);
}
const db = new pg.Pool({ connectionString: url, max: 1 });
const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "hosted", "watchdog.sql"), "utf8");

const TOKEN = "not-a-real-token-this-is-a-test-value";
const CHAT = "424242";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   ${detail}`}`);
};

async function reset(withSecrets = true) {
  await db.query(`
    drop schema if exists vault cascade; drop schema if exists net cascade;
    create schema vault;
    create table vault.stub_secrets (name text primary key, decrypted_secret text);
    create view vault.decrypted_secrets as select name, decrypted_secret from vault.stub_secrets;
    create schema net;
    create table net.calls (id serial primary key, url text, body jsonb, at timestamptz default now());
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;
    create table if not exists exit_alert_kv (key text primary key, value text not null, updated_at timestamptz not null default now());
    delete from exit_alert_kv;
  `);
  if (withSecrets) await db.query(`insert into vault.stub_secrets values ('aureus_telegram_token', $1), ('aureus_telegram_chat', $2)`, [TOKEN, CHAT]);
}
const beat = (ageMin: number, value: string) =>
  db.query(`insert into exit_alert_kv (key, value, updated_at) values ('hosted_tick_ok', $1, now() - make_interval(secs => $2::float8 * 60)) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`, [value, ageMin]);
const good = (age = 0) => beat(age, JSON.stringify({ positions: 166, priced: 102, sent: 0, ms: 1200, cpuMs: 50 }));
const run = async (...args: unknown[]) => (await db.query(`select public.aureus_watchdog(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r as string;
const calls = async () => (await db.query(`select url, body from net.calls order by id`)).rows as Array<{ url: string; body: any }>;
const setState = (o: Record<string, unknown>) => db.query(`insert into exit_alert_kv (key, value) values ('watchdog', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(o)]);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function main() {
  await reset();
  await db.query(sql);

  // 1. nothing has ever been written: that is a problem, said once
  check("no heartbeat at all: says so once", (await run()) === "told down");
  let c = await calls();
  check("  it names the problem and uses the token only in the address", c.length === 1 && c[0]!.body.text.includes("nog nooit een controle afgerond") && c[0]!.url.includes(TOKEN) && !c[0]!.body.text.includes(TOKEN) && c[0]!.body.chat_id === CHAT && c[0]!.body.disable_notification === false);
  check("  a second run says nothing more", (await run()) === "nothing to say" && (await calls()).length === 1);

  // 2. the check comes back
  await good();
  check("heartbeat fresh again: says it is over", (await run()) === "recovered");
  c = await calls();
  check("  the recovery message says when it was down", c.length === 2 && c[1]!.body.text.includes("loopt weer") && c[1]!.body.text.includes("Het was stil van"));
  check("  and then nothing more", (await run()) === "nothing to say" && (await calls()).length === 2);

  // 3. a stale heartbeat
  await beat(30, JSON.stringify({ positions: 166, priced: 102 }));
  check("heartbeat 30 minutes old: down", (await run()) === "told down");
  c = await calls();
  check("  it says how long ago the last check finished", c[2]!.body.text.includes("30 min geleden") && c[2]!.body.text.includes("staat stil"));
  await good(8);
  check("a heartbeat 8 minutes old is still fine (the clock ticks every 2)", (await run()) === "recovered");
  await good();
  check("  nothing more once it is fine", (await run()) === "nothing to say");

  // 4. passes finish but there are no prices
  const blind = JSON.stringify({ positions: 166, priced: 0, sent: 0 });
  await beat(0, blind);
  check("no prices at all: not said at once (a blip)", (await run()) === "nothing to say");
  await setState({ state: "blind", since: ago(20), told_at: null });
  check("  said once it has lasted 15 minutes", (await run()) === "told blind");
  c = await calls();
  check("  the message is about the prices", c.at(-1)!.body.text.includes("geen prijzen"));
  await good();
  check("  and over when prices come back", (await run()) === "recovered" && (await calls()).at(-1)!.body.text.includes("zonder prijzen"));
  const n0 = (await calls()).length;
  await beat(0, blind);
  await run();
  await good();
  check("a blip without prices that ends in time is never mentioned", (await run()) === "nothing to say" && (await calls()).length === n0);
  await beat(0, JSON.stringify({ positions: 0, priced: 0 }));
  check("no held coins at all is not 'no prices'", (await run()) === "nothing to say");
  await good();

  // 5. a problem that stays is repeated after 6 hours, not before
  await beat(400, "{}");
  await setState({ state: "down", since: ago(400), told_at: ago(120) });
  check("told 2 hours ago: quiet", (await run()) === "nothing to say");
  await setState({ state: "down", since: ago(400), told_at: ago(7 * 60) });
  check("told 7 hours ago and still down: reminds", (await run()) === "reminded down" && (await calls()).at(-1)!.body.text.includes("Nog steeds"));
  await good();
  await run();

  // 6. without secrets nothing can be said and nothing is marked as said
  await reset(false);
  await db.query(sql);
  await beat(30, "{}");
  check("no secrets in the vault: says it cannot tell", (await run()) === "cannot tell: no telegram secrets in the vault" && (await calls()).length === 0);
  check("  and the state still says nothing was told", !(await db.query(`select 1 from exit_alert_kv where key = 'watchdog'`)).rowCount);
  await db.query(`insert into vault.stub_secrets values ('aureus_telegram_token', $1), ('aureus_telegram_chat', $2)`, [TOKEN, CHAT]);
  check("  once the secrets are there the next run tells", (await run()) === "told down" && (await calls()).length === 1);

  // 7. a test message is silent and marked, and uses keys of its own
  await reset();
  await db.query(sql);
  await db.query(`insert into exit_alert_kv (key, value, updated_at) values ('test_hb', '{}', now() - interval '30 minutes')`);
  check("a test on its own heartbeat tells", (await run(true, "test_hb", "test_watchdog")) === "told down");
  c = await calls();
  check("  the test message is silent and marked as a test", c[0]!.body.disable_notification === true && c[0]!.body.text.startsWith("🧪 <b>Test</b>"));
  check("  the real heartbeat and state were not touched", !(await db.query(`select 1 from exit_alert_kv where key in ('hosted_tick_ok', 'watchdog')`)).rowCount);

  // 8. odd data does not break it
  await reset();
  await db.query(sql);
  await beat(0, "this is not json");
  check("a heartbeat that is not JSON counts as alive", (await run()) === "nothing to say");

  // 9. the secrets never end up in a stored state or in a text
  const kv = (await db.query(`select value from exit_alert_kv`)).rows.map((r) => r.value).join("|");
  check("the token and the chat are in no stored row", !kv.includes(TOKEN) && !kv.includes(CHAT));
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
}

main()
  .catch((e) => {
    console.error(String((e as Error)?.message ?? e));
    failed++;
  })
  .finally(async () => {
    await db.end();
    process.exit(failed ? 1 : 0);
  });
