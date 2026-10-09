import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check the full intel structure
const result = await pool.query(`
  SELECT
    candidate_id,
    intel
  FROM onchain_enrichment
  ORDER BY computed_at DESC
  LIMIT 1
`);

if (result.rows.length > 0) {
  const row = result.rows[0];
  const intel = row.intel as any;

  console.log("=== Full Intel Structure ===\n");
  console.log(JSON.stringify(intel, null, 2));
}

await pool.end();
