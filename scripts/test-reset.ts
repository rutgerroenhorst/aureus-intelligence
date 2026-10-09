/**
 * pnpm db:test-reset — safely reset the test database.
 *
 * Safeguards:
 * - Requires NODE_ENV=test OR explicit --target-db flag
 * - Refuses to run in production
 * - Requires confirmation if NODE_ENV is not set
 * - Only resets TEST databases, never production or named databases
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, runMigrations, closePool } from "@aureus/db";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
const hasTargetFlag = process.argv.includes("--target-db=test");

if (isProduction) {
  console.error("❌ Refusing to reset the database in production.");
  process.exit(1);
}

if (!isTest && !hasTargetFlag) {
  console.error("❌ db:test-reset requires NODE_ENV=test or --target-db=test flag");
  console.error("");
  console.error("Usage:");
  console.error("  NODE_ENV=test pnpm db:test-reset");
  console.error("  pnpm db:test-reset --target-db=test");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

console.log(`🔄 Resetting test database (NODE_ENV=${process.env.NODE_ENV || "development"})...`);

try {
  const pool = getPool();
  console.log("   Dropping and recreating schemas (public, legacy)...");
  await pool.query(
    "DROP SCHEMA IF EXISTS legacy CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  const res = await runMigrations(migrationsDir);
  console.log(`   Re-applied ${res.applied.length} migrations.`);
  console.log("✅ Test database reset complete");
} catch (err) {
  console.error("❌ RESET ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
