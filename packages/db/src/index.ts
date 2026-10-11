/**
 * @aureus/db — Postgres pool + a minimal, ordered SQL migration runner.
 * The runner records applied migrations in schema_migrations and is idempotent:
 * re-running applies only new files. It executes each migration file inside a
 * transaction so a failed migration leaves no partial state.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { getConfig } from "@aureus/config";

const { Pool } = pg;
export type { PoolClient, QueryResult } from "pg";

import os from "node:os";

// One pool per PROCESS (per name), kept on globalThis. `next dev` re-evaluates modules on every hot reload and
// every copy used to open its own pool; the old ones were never closed, so a local Postgres with the
// default max_connections=100 ran out of connections ("53300 too many clients") and the Radar
// showed empty lists.
const holder = globalThis as unknown as { __aureusPgPool?: pg.Pool; __aureusNamedPools?: Record<string, pg.Pool> };

// ---- usage meter ----------------------------------------------------------------------------------------------
// Supabase's free plan allows 5 GB of egress a month, and everything the database sends to the app counts: the pages, the scans and the lab all
// read from it. The bytes that arrive on the pool's sockets are counted here (exact, and one addition per chunk) and added to one row per UTC day in
// scan_lease ('usage:egress:YYYY-MM-DD'), so the site can slow itself down before a limit is reached (apps/web/lib/cloudScan.ts) and the Ops page
// can show it. On while running on Vercel, or with AUREUS_EGRESS_METER=1; off on the laptop, where the database is local.
interface Meter {
  pending: number;
  lastFlush: number;
  flushing: boolean;
}
const meterHolder = globalThis as unknown as { __aureusMeter?: Meter };
const meter: Meter = (meterHolder.__aureusMeter ??= { pending: 0, lastFlush: Date.now(), flushing: false });
export const USAGE_FLUSH_EVERY_MS = 30_000;
export const USAGE_FLUSH_AT_BYTES = 512 * 1024;

/** Count bytes received from the database. */
export function meterAdd(bytes: number): void {
  if (bytes > 0) meter.pending += bytes;
}
/** Bytes counted in this process and not yet written to the database. */
export function meterPending(): number {
  return meter.pending;
}
export function meterReset(): void {
  meter.pending = 0;
  meter.lastFlush = Date.now();
  meter.flushing = false;
}
/** Time to write the count down: a lot has been read, or it has been a while. */
export function meterDue(now = Date.now()): boolean {
  return meter.pending >= USAGE_FLUSH_AT_BYTES || (meter.pending > 0 && now - meter.lastFlush >= USAGE_FLUSH_EVERY_MS);
}

/** Add what this process has read to today's row. Best effort: if the write fails the count is kept for the next try. */
export async function flushUsage(db: { query(text: string, params?: unknown[]): Promise<unknown> }): Promise<boolean> {
  if (meter.flushing || meter.pending <= 0) return false;
  meter.flushing = true;
  const bytes = meter.pending;
  meter.pending = 0;
  meter.lastFlush = Date.now();
  try {
    await db.query(
      `INSERT INTO scan_lease (name, locked_until, last_result)
       VALUES ('usage:egress:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'epoch', jsonb_build_object('bytes', $1::bigint))
       ON CONFLICT (name) DO UPDATE SET last_result = jsonb_build_object('bytes', COALESCE((scan_lease.last_result->>'bytes')::bigint, 0) + $1::bigint)`,
      [bytes],
    );
    return true;
  } catch {
    meter.pending += bytes;
    return false;
  } finally {
    meter.flushing = false;
  }
}

function installMeter(pool: pg.Pool): void {
  pool.on("connect", (client) => {
    const stream = (client as unknown as { connection?: { stream?: { on?: (ev: string, fn: (c: Buffer) => void) => void } } }).connection?.stream;
    stream?.on?.("data", (chunk: Buffer) => meterAdd(chunk.length));
  });
  pool.on("release", () => {
    if (meterDue()) void flushUsage(pool);
  });
}

function createPool(connectionString?: string): pg.Pool {
  const cs = connectionString ?? getConfig().env.DATABASE_URL;
  // Serverless (Vercel) instances multiply: keep each pool tiny so the shared pooler is not exhausted.
  const serverless = Boolean(process.env.VERCEL);
  const maxConnections =
    Number(process.env.DB_POOL_MAX) ||
    (serverless ? 3 : Math.min(25, Math.max(10, os.cpus().length * 2)));
  const minConnections =
    process.env.DB_POOL_MIN !== undefined ? Number(process.env.DB_POOL_MIN) : serverless ? 0 : 2;
  const pool = new Pool({
    connectionString: cs,
    max: maxConnections,  // 10-25 based on CPU cores (3 on Vercel; DB_POOL_MAX overrides)
    min: minConnections,  // 2 locally, 0 on Vercel; DB_POOL_MIN overrides
    idleTimeoutMillis: 30000,
    // A cold serverless instance opens its first TLS connection while still loading code; 2 s was not always enough.
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || (serverless ? 8000 : 2000),
    statement_timeout: 5000,
    query_timeout: 10000
  });

  // Log warnings on connection issues
  pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error:", err);
  });
  if (serverless || process.env.AUREUS_EGRESS_METER === "1") installMeter(pool);
  return pool;
}

/**
 * The shared pool. A `name` gives a separate pool of its own: the scan that runs inside the web app uses one, so its
 * queries can never use up the connections the pages are waiting for (a scan with 5 coins in flight emptied a pool of 3
 * and every page request behind it timed out).
 */
export function getPool(connectionString?: string, name?: string): pg.Pool {
  if (name && name !== "default") {
    const named = (holder.__aureusNamedPools ??= {});
    return (named[name] ??= createPool(connectionString));
  }
  return (holder.__aureusPgPool ??= createPool(connectionString));
}

/** Close every pool of this process (scripts call this before exiting). */
export async function closePool(): Promise<void> {
  const pools = [holder.__aureusPgPool, ...Object.values(holder.__aureusNamedPools ?? {})].filter(Boolean) as pg.Pool[];
  holder.__aureusPgPool = undefined;
  holder.__aureusNamedPools = {};
  await Promise.all(pools.map((p) => p.end()));
}

// Export cache utilities
export { withCache, getRedis, closeRedis, warmCache, invalidateCache, getCacheStats } from "./cache.js";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  total: number;
}

/** Apply all *.sql files in `dir` in lexical order, once each. */
export async function runMigrations(
  dir: string,
  connectionString?: string,
): Promise<MigrationResult> {
  const p = getPool(connectionString);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  const client = await p.connect();
  try {
    await client.query(MIGRATIONS_TABLE);
    const { rows } = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    const seen = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const name = basename(file);
      const prev = seen.get(name);

      if (prev) {
        if (prev !== checksum) {
          throw new Error(
            `Migration ${name} was modified after being applied ` +
              `(checksum mismatch). Migrations are immutable; add a new file.`,
          );
        }
        skipped.push(name);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
        applied.push(name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${name} failed: ${(err as Error).message}`,
          { cause: err },
        );
      }
    }
  } finally {
    client.release();
  }

  return { applied, skipped, total: files.length };
}
