/**
 * pnpm db:reset — drop and recreate the public schema, then re-run migrations.
 * Guarded: refuses to run when NODE_ENV=production.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, runMigrations, closePool } from "@aureus/db";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset the database in production.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

try {
  const pool = getPool();
  console.log("Dropping and recreating schemas (public, legacy)...");
  await pool.query(
    "DROP SCHEMA IF EXISTS legacy CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  const res = await runMigrations(migrationsDir);
  console.log(`Re-applied ${res.applied.length} migrations.`);
  console.log("OK");
} catch (err) {
  console.error("RESET ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
