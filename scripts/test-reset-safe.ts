/**
 * pnpm db:test-reset — safely reset ONLY the aureus_test database.
 * 
 * CRITICAL SAFEGUARDS:
 * - Parses actual DATABASE_URL before any destructive action
 * - Refuses unless target database name ends in "_test"
 * - Refuses if NODE_ENV === "production"
 * - Never touches "aureus" (canonical dev database)
 * - Prints target connection before execution
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  console.error("❌ Refusing to reset database in production");
  process.exit(1);
}

// Parse DATABASE_URL or construct aureus_test URL
const dbUrl = process.env.DATABASE_URL || "postgres://aureus:aureus@localhost:5432/aureus_test";
const url = new URL(dbUrl);
const dbName = url.pathname.slice(1); // Remove leading /

console.log(`\n🔍 SAFETY CHECK: Test Database Reset`);
console.log(`   Connection: ${url.hostname}:${url.port || 5432}`);
console.log(`   Database: ${dbName}`);
console.log(`   Env: ${process.env.NODE_ENV || "development"}\n`);

// HARD SAFETY: Refuse if not a test database
if (!dbName.endsWith("_test") && dbName !== "aureus_test") {
  console.error(`❌ BLOCKED: Target database must end with "_test" (got: ${dbName})`);
  console.error(`\n   Usage:`);
  console.error(`     DATABASE_URL=postgres://aureus:aureus@localhost:5432/aureus_test pnpm db:test-reset`);
  process.exit(1);
}

// HARD SAFETY: Refuse if targeting canonical database
if (dbName === "aureus") {
  console.error(`❌ BLOCKED: Cannot reset canonical database "aureus"`);
  console.error(`   Use aureus_test instead`);
  process.exit(1);
}

console.log(`✅ Safety checks passed. Proceeding with ${dbName} reset...\n`);

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

async function resetDatabase() {
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    console.log(`   Connecting to ${dbName}...`);
    await pool.query("SELECT 1");
    
    console.log(`   Dropping and recreating schemas...`);
    await pool.query(
      "DROP SCHEMA IF EXISTS legacy CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    );
    
    console.log(`   Running migrations...`);
    // Import runMigrations
    const { runMigrations } = await import("@aureus/db");
    const res = await runMigrations(migrationsDir, pool);
    
    console.log(`   ✓ Applied ${res.applied.length} migrations`);
    console.log(`\n✅ ${dbName} reset complete\n`);
  } catch (err) {
    console.error(`\n❌ ERROR:`, (err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

resetDatabase();
