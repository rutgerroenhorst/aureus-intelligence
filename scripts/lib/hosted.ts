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
  return client;
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
