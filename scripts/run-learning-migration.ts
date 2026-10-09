import { getPool } from "@aureus/db";
import * as fs from "fs";
import * as path from "path";

async function runMigration() {
  const pool = getPool();
  const migrationPath = path.join(
    __dirname,
    "../db/migrations/0022_coin_learning.sql"
  );

  try {
    console.log("[Migration] Starting coin learning system migration...");

    const sql = fs.readFileSync(migrationPath, "utf-8");
    await pool.query(sql);

    console.log("[Migration] ✅ Coin learning tables created successfully");
    console.log("[Migration] Tables created:");
    console.log("  - coin_qualifications");
    console.log("  - filter_suggestions");
    console.log("  - learning_progress");
    console.log("  - ab_tests");
    console.log("  - active_filters_snapshot");

    // Verify tables exist
    const tablesResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN (
        'coin_qualifications',
        'filter_suggestions',
        'learning_progress',
        'ab_tests',
        'active_filters_snapshot'
      )
      ORDER BY table_name
    `);

    console.log(`[Migration] ✅ Verified ${tablesResult.rows.length} tables exist`);
    tablesResult.rows.forEach((row: any) => {
      console.log(`  ✓ ${row.table_name}`);
    });

    process.exit(0);
  } catch (err) {
    console.error("[Migration] ❌ Error:", err);
    process.exit(1);
  }
}

runMigration();
