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
