import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** The repository folder (this file is scripts/lib/hosted.ts). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Load KEY=VALUE lines of a git-ignored file into process.env, without overriding what is already set. Returns whether the file was there. */
export function loadEnvFile(file: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
  return true;
}

/** The hosted (Supabase) database: HOSTED_DATABASE_URL from the environment or from the git-ignored `.env.hosted.local`. Older names still work. */
export function hostedUrl(): string | undefined {
  loadEnvFile(path.join(REPO, ".env.hosted.local"));
  return process.env.HOSTED_DATABASE_URL ?? process.env.LAB_SYNC_URL ?? process.env.CLOUD_URL;
}

/** The laptop's own database. */
export function localUrl(): string {
  return process.env.LOCAL_DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
}

export function sslFor(url: string): pg.ClientConfig["ssl"] {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) ? undefined : { rejectUnauthorized: false };
}

export async function connectTo(url: string, name = "aureus-script"): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url), application_name: name, connectionTimeoutMillis: 20_000 });
  await client.connect();
  // a long export must not be cut off by the database's default timeout (set after connecting: the pooler does not accept it as a startup option)
  await client.query("SET statement_timeout = 0").catch(() => {});
  // the hosted database's free plan counts everything it sends out, a backup's 190 MB included: count it into the day's row (the laptop's own database is not metered)
  if (sslFor(url)) meterClient(client, url);
  return client;
}

const EGRESS_SQL = `INSERT INTO scan_lease (name, locked_until, last_result)
       VALUES ('usage:egress:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'epoch', jsonb_build_object('bytes', $1::bigint))
       ON CONFLICT (name) DO UPDATE SET last_result = jsonb_build_object('bytes', COALESCE((scan_lease.last_result->>'bytes')::bigint, 0) + $1::bigint)`;

/** Add bytes the hosted database sent to today's row (usage:egress:<day>, the same row the site's meter fills), on a short connection of its own. Best effort: a script must not fail because its count could not be written. */
export async function addEgress(url: string, bytes: number): Promise<void> {
  if (!(bytes > 0)) return;
  const c = new pg.Client({ connectionString: url, ssl: sslFor(url), application_name: "aureus-egress-meter", connectionTimeoutMillis: 15_000 });
  c.on("error", () => {});
  try {
    await c.connect();
    await c.query(EGRESS_SQL, [Math.round(bytes)]);
  } catch {
    // not counted this time
  } finally {
    await Promise.race([c.end().catch(() => {}), new Promise((r) => setTimeout(r, 3_000))]);
  }
}

/** Reads smaller than this are not written down: a second connection to the pooler is not worth a few hundred KB (the margin of the allowance covers them). */
const MIN_COUNTED_BYTES = 1_048_576;

/**
 * Count the bytes this connection receives and write them down when it is ended, if they are a megabyte or more (a script that never ends it, or crashes, loses its count). The count is written on the connection
 * itself when it can be (one connection less for the pooler to give out), and on a short one of its own when it cannot (a read-only or failed transaction); the whole of it is bounded to 25 seconds, so metering can
 * never hold a script up. AUREUS_EGRESS_METER=0 switches it off.
 */
function meterClient(client: pg.Client, url: string): void {
  if (process.env.AUREUS_EGRESS_METER === "0") return;
  const stream = (client as unknown as { connection?: { stream?: { on?: (ev: string, fn: (c: Buffer) => void) => void } } }).connection?.stream;
  let bytes = 0;
  stream?.on?.("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });
  const end = client.end.bind(client) as () => Promise<void>;
  (client as unknown as { end: () => Promise<void> }).end = async () => {
    const n = Math.round(bytes);
    bytes = 0;
    const finish = async () => {
      let written = n < MIN_COUNTED_BYTES;
      if (!written) written = await client.query(EGRESS_SQL, [n]).then(() => true, () => false);
      await end().catch(() => {});
      if (!written) await addEgress(url, n);
    };
    const stalled = await Promise.race([finish().then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 25_000).unref())]);
    // a connection that does not answer (a sleeping laptop, a dropped network) must not keep the script alive
    if (stalled) (client as unknown as { connection?: { stream?: { destroy?: () => void } } }).connection?.stream?.destroy?.();
  };
}

/** A connection string without its password, for logs. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username.split(".")[0]}:***@` : ""}${u.host}${u.pathname}`;
  } catch {
    return "<unreadable connection string>";
  }
}

export const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Where the tables of the big, rolling history live: pruned every few hours on the hosted database, rebuilt by scanning; not worth the free egress in a routine backup. */
export const HISTORY_TABLES = new Set(["feature_values", "rule_evaluations", "intelligence_v2_scores", "raw_events", "observations", "lab_signals_ts", "research_notebook_entries"]);

/** The tables that hold what a person made or the system recorded about the person's own money: the Enter-button journal, the Checks, the followed wallet and its reads, the alert state, the Telegram log, the lab's reports. */
export const USER_TABLES = new Set(["my_trades", "coin_checks", "wallet_watch", "wallet_txs", "wallet_fills", "wallet_flows", "exit_alerts", "exit_alert_kv", "telegram_messages", "lab_reports", "lab_hypotheses"]);

/** The service secret (CRON_SECRET): from the environment, else read from the hosted database's vault. Never printed. */
export async function serviceSecret(): Promise<string | undefined> {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const url = hostedUrl();
  if (!url) return undefined;
  const c = await connectTo(url, "aureus-secret");
  try {
    await c.query("SET default_transaction_read_only = on");
    return (await c.query("select decrypted_secret from vault.decrypted_secrets where name = 'aureus_cron_secret'")).rows[0]?.decrypted_secret as string | undefined;
  } finally {
    await c.end();
  }
}
