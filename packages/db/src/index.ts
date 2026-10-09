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

let pool: pg.Pool | null = null;

export function getPool(connectionString?: string): pg.Pool {
  if (!pool) {
    const cs = connectionString ?? getConfig().env.DATABASE_URL;
    // Serverless (Vercel) instances multiply: keep each pool tiny so the shared pooler is not exhausted.
    const serverless = Boolean(process.env.VERCEL);
    const maxConnections =
      Number(process.env.DB_POOL_MAX) ||
      (serverless ? 3 : Math.min(100, Math.max(20, os.cpus().length * 5)));
    const minConnections =
      process.env.DB_POOL_MIN !== undefined ? Number(process.env.DB_POOL_MIN) : serverless ? 0 : 5;
    pool = new Pool({
      connectionString: cs,
      max: maxConnections,  // Dynamic: 20-100 based on CPU cores (3 on Vercel; DB_POOL_MAX overrides)
      min: minConnections,  // Keep minimum connections ready (0 on Vercel; DB_POOL_MIN overrides)
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      query_timeout: 10000
    });

    // Log warnings on connection issues
    pool.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
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
