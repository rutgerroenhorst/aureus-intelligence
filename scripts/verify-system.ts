/**
 * Is everything still the way it should be? (docs/DISASTER_RECOVERY.md)
 *
 *   corepack pnpm exec tsx scripts/verify-system.ts [--tests]
 *
 * Run it before a risky change and again after: the two outputs say what the change did. It only reads and asks; it changes nothing.
 * PASS = as it should be, WARN = worth a look, FAIL = broken or open, SKIP = could not be checked here. Exit code 1 when something FAILs.
 * Needs: .env.hosted.local (the hosted database), .env.access.local (the site's access code), Docker for the laptop checks. Secrets are never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { REPO, connectTo, hostedUrl, loadEnvFile } from "./lib/hosted.js";

type Status = "PASS" | "WARN" | "FAIL" | "SKIP";
const results: Array<{ status: Status; name: string; detail: string }> = [];
const say = (status: Status, name: string, detail = "") => {
  results.push({ status, name, detail });
  console.log(`${status.padEnd(4)}  ${name}${detail ? `  (${detail})` : ""}`);
};
const section = (t: string) => console.log(`\n== ${t}`);
const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: REPO });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

loadEnvFile(path.join(REPO, ".env.access.local"));
const SITE = (process.env.SITE_URL ?? "https://aureus-intelligence-nu.vercel.app").replace(/\/+$/, "");
const get = (p: string, init: RequestInit = {}) => fetch(`${SITE}${p}`, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
const minutesAgo = (iso: string | Date) => (Date.now() - new Date(iso).getTime()) / 60_000;

// ------------------------------------------------------------------------------------------------------------------------------ the site
section(`the site (${SITE})`);
let cookie = "";
try {
  let r = await get("/api/telemetry");
  say(r.status === 401 ? "PASS" : "FAIL", "a stranger's API call is turned away", `got ${r.status}, want 401`);
  r = await get("/radar");
  say(r.status === 307 && (r.headers.get("location") ?? "").includes("/login") ? "PASS" : "FAIL", "a stranger's page request goes to the login page", `got ${r.status}`);
  r = await get("/login");
  const h = r.headers;
  say(r.status === 200 ? "PASS" : "FAIL", "the login page opens", `got ${r.status}`);
  const headers = ["x-robots-tag", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"].filter((k) => !h.get(k));
  say(headers.length === 0 ? "PASS" : "FAIL", "the security headers are on", headers.length ? `missing: ${headers.join(", ")}` : "");
  r = await get("/manifest.webmanifest");
  const manifest = r.ok ? ((await r.json()) as Record<string, unknown>) : {};
  say(r.ok && !("description" in manifest) ? "PASS" : "WARN", "the public manifest says nothing about what the app is", r.ok ? "" : `got ${r.status}`);
  const code = process.env.SITE_ACCESS_CODE;
  if (!code) say("SKIP", "logging in with the access code", "no .env.access.local");
  else {
    r = await get("/api/auth/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${encodeURIComponent(code)}&next=/` });
    cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    say(r.status === 303 && cookie ? "PASS" : "FAIL", "the access code in the file logs in", `got ${r.status}`);
    for (const p of ["/api/telemetry", "/api/radar-bundle", "/api/kennis-facts", "/api/my-trades"]) {
      const t0 = Date.now();
      const rr = await get(p, { headers: { cookie } });
      say(rr.status === 200 ? "PASS" : "FAIL", `logged in: ${p}`, `${rr.status}, ${Date.now() - t0} ms`);
    }
  }
} catch (e) {
  say("FAIL", "the site answers", String((e as Error).message).slice(0, 100));
}

// ------------------------------------------------------------------------------------------------------------------------------ the clock and the hosted database
section("the clock and the hosted database");
const url = hostedUrl();
if (!url) say("SKIP", "the hosted database", "no .env.hosted.local");
else {
  const c = await connectTo(url, "aureus-verify");
  try {
    await c.query("SET default_transaction_read_only = on");
    const q = async (sql: string) => (await c.query(sql)).rows;

    const jobs = await q("select jobname, active from cron.job order by jobname");
    const wanted = ["aureus-cron-cleanup", "aureus-exit-alerts", "aureus-graduates", "aureus-learning", "aureus-maintenance", "aureus-watchdog"];
    const missing = wanted.filter((j) => !jobs.some((x) => x.jobname === j && x.active));
    say(missing.length === 0 ? "PASS" : "FAIL", "the six clock jobs exist and are active", missing.length ? `missing or off: ${missing.join(", ")}` : "");

    const tick = (await q("select value, updated_at from exit_alert_kv where key = 'hosted_tick_ok'"))[0];
    const age = tick ? minutesAgo(tick.updated_at) : Infinity;
    say(age < 6 ? "PASS" : age < 15 ? "WARN" : "FAIL", "the site's exit-alert check ran recently", tick ? `${age.toFixed(1)} min ago` : "never");

    const grad = (await q("select last_result from scan_lease where name = 'grad-feed'"))[0];
    const gAt = grad?.last_result?.at ? minutesAgo(grad.last_result.at) : Infinity;
    say(gAt < 8 ? "PASS" : gAt < 20 ? "WARN" : "FAIL", "the graduations feed ran recently", Number.isFinite(gAt) ? `${gAt.toFixed(1)} min ago, ok=${grad?.last_result?.ok}` : "never");

    const fails = await q("select count(*) n from cron.job_run_details where start_time > now() - interval '1 hour' and status <> 'succeeded'");
    say(Number(fails[0].n) === 0 ? "PASS" : "WARN", "no clock job failed in the last hour", `${fails[0].n} failed`);

    const exposed = await q(
      `select count(*) n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'insert'))`,
    );
    say(Number(exposed[0].n) === 0 ? "PASS" : "FAIL", "the database's open web roles (anon, authenticated) can touch no table", `${exposed[0].n} tables are open`);

    const size = Number((await q("select pg_database_size(current_database()) as b"))[0].b) / 1048576;
    say(size < 380 ? "PASS" : size < 450 ? "WARN" : "FAIL", "the hosted database is inside the free 500 MB", `${size.toFixed(0)} MB`);

    const journal = (await q("select count(*) n, max(entered_at) as newest from my_trades"))[0];
    say(Number(journal.n) > 0 ? "PASS" : "WARN", "the journal is there", `${journal.n} coins`);

    const vault = await q("select name from vault.secrets");
    say(["aureus_cron_secret", "aureus_telegram_chat", "aureus_telegram_token"].every((n) => vault.some((v) => v.name === n)) ? "PASS" : "FAIL", "the three vault entries exist (names only checked)");

    // the service secret opens the site (this is how the clock gets in): read it from the vault, use it once, never print it
    const secret = (await q("select decrypted_secret from vault.decrypted_secrets where name = 'aureus_cron_secret'"))[0]?.decrypted_secret as string | undefined;
    if (secret) {
      const ok = await get("/api/health", { headers: { authorization: `Bearer ${secret}` } });
      const no = await get("/api/health", { headers: { authorization: `Bearer ${secret}x` } });
      say((ok.status === 200 || ok.status === 503) && no.status === 401 ? "PASS" : "FAIL", "the service secret from the vault opens the site, a wrong one does not", `${ok.status} / ${no.status}`);
    }
  } catch (e) {
    say("FAIL", "the hosted database checks", String((e as Error).message).slice(0, 120));
  } finally {
    await c.end();
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ the laptop
section("the laptop");
const docker = sh("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}\t{{.Status}}"]);
if (!docker.ok) say("FAIL", "Docker is running", "the daemon does not answer (start Docker Desktop)");
else {
  for (const name of ["aureus_postgres", "aureus_redis"]) {
    const line = docker.out.split("\n").find((l) => l.startsWith(`${name}\t`));
    if (!line) {
      say("FAIL", `${name} is running`);
      continue;
    }
    const [, ports, status] = line.split("\t") as [string, string, string];
    say(/healthy/.test(status) ? "PASS" : "WARN", `${name} is healthy`, status);
    say(/(^|, )(0\.0\.0\.0|\[::\]):/.test(ports) ? "FAIL" : "PASS", `${name} is reachable from this laptop only`, ports.replace(/\[::\]/g, "::"));
  }
}
const lan = sh("sh", ["-c", "ipconfig getifaddr en0 || ipconfig getifaddr en1"]).out.split("\n")[0];
if (lan && /^\d+\.\d+\.\d+\.\d+$/.test(lan)) {
  for (const port of [5432, 6379]) {
    const open = spawnSync("nc", ["-z", "-G", "2", lan, String(port)]).status === 0;
    say(open ? "FAIL" : "PASS", `port ${port} is closed on the network address ${lan}`);
  }
}
const worker = sh("pgrep", ["-f", "apps/worker/src/run.ts"]);
say(worker.ok ? "PASS" : "WARN", "the laptop worker is running (it is yours to start: corepack pnpm worker:start)", worker.ok ? "" : "not running: the websocket stream, the lab daemon's launch tables and the hot-network refresh are stale until it is");
const df = sh("df", ["-k", "/System/Volumes/Data"]).out.split("\n")[1]?.split(/\s+/);
if (df) {
  const freeGb = Number(df[3]) / 1048576;
  say(freeGb >= 15 ? "PASS" : freeGb >= 5 ? "WARN" : "FAIL", "the disk has room (the laptop database is 4 GB and grows)", `${freeGb.toFixed(0)} GB free`);
}

// ------------------------------------------------------------------------------------------------------------------------------ the code and the backups
section("the code and the backups");
const origin = sh("git", ["remote", "get-url", "origin"]).out;
const repo = origin.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1];
if (repo) {
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { "user-agent": "aureus-verify" }, signal: AbortSignal.timeout(20_000) });
    say(r.status === 404 ? "PASS" : r.status === 200 ? "WARN" : "SKIP", "the GitHub repository is private (a stranger gets 404)", r.status === 200 ? "PUBLIC: anyone can read the code and its history" : `got ${r.status}`);
  } catch (e) {
    say("SKIP", "the GitHub repository's visibility", String((e as Error).message).slice(0, 80));
  }
}
const tags = sh("git", ["tag", "--list", "restore/*"]).out.split("\n").filter(Boolean);
say(tags.length ? "PASS" : "FAIL", "there are restore points (git tags)", tags.slice(-3).join(", "));
const head = sh("git", ["rev-parse", "HEAD"]).out;
const remoteMain = sh("git", ["rev-parse", "origin/main"]).out;
say(sh("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).ok ? "PASS" : "WARN", "the local code contains what is on origin/main", head === remoteMain ? "same commit" : "local is ahead or on a branch");
const backupsDir = path.join(REPO, "..", "backups");
const folders = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => /^\d{4}-\d\d-\d\d/.test(f)).sort() : [];
const withHosted = folders.filter((f) => fs.existsSync(path.join(backupsDir, f, "hosted", "_manifest.json")));
const newest = withHosted.at(-1);
if (!newest) say("FAIL", "there is a backup of the hosted database", "none found");
else {
  const days = (Date.now() - fs.statSync(path.join(backupsDir, newest, "hosted", "_manifest.json")).mtimeMs) / 86_400_000;
  say(days < 8 ? "PASS" : days < 31 ? "WARN" : "FAIL", "the newest backup of the hosted database is recent", `${newest}, ${days.toFixed(1)} days old`);
}
const withLocal = folders.filter((f) => fs.existsSync(path.join(backupsDir, f, "local-aureus.dump")));
say(withLocal.length ? "PASS" : "WARN", "there is a dump of the laptop database", withLocal.at(-1) ?? "none");

if (process.argv.includes("--tests")) {
  section("tests");
  const r = sh("corepack", ["pnpm", "test"]);
  const line = r.out.split("\n").filter((l) => /Tests |Test Files/.test(l)).join(" | ");
  say(/ passed/.test(line) && !/ failed \|/.test(line.split("Tests")[1] ?? "") ? "PASS" : "WARN", "the test suite", line.replace(/\s+/g, " "));
}

const count = (s: Status) => results.filter((r) => r.status === s).length;
console.log(`\n${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail, ${count("SKIP")} skipped`);
process.exitCode = count("FAIL") ? 1 : 0;
