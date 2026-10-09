import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check the actual intel data stored in one row
const result = await pool.query(`
  SELECT
    candidate_id,
    intel
  FROM onchain_enrichment
  LIMIT 1
`);

if (result.rows.length > 0) {
  const row = result.rows[0];
  console.log("Raw intel from DB:");
  console.log(JSON.stringify(row.intel, null, 2));

  const intel = row.intel as any;
  console.log("\nIntel structure:");
  console.log("Keys:", Object.keys(intel));
  console.log("intel.onChain:", intel.onChain);
  console.log("intel.flags:", intel.flags);
}

await pool.end();
