/** pnpm db:migrate — apply all migrations in db/migrations in order. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, closePool } from "@aureus/db";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

try {
  const res = await runMigrations(migrationsDir);
  console.log(`Migrations dir: ${migrationsDir}`);
  console.log(`Applied (${res.applied.length}): ${res.applied.join(", ") || "-"}`);
  console.log(`Skipped (${res.skipped.length}): ${res.skipped.join(", ") || "-"}`);
  console.log("OK");
} catch (err) {
  console.error("MIGRATION ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
