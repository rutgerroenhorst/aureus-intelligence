import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check enrichment for a specific failing candidate
const candidateId = "89a04eaa-7d21-4917-9d4c-fcfff6b77ce5";

const enr = await pool.query(`
  SELECT
    intel,
    datasets
  FROM onchain_enrichment
  WHERE candidate_id = $1::uuid
`, [candidateId]);

console.log(`Enrichment for ${candidateId}:`);
if (enr.rows.length === 0) {
  console.log("NO ENRICHMENT FOUND");
} else {
  const row = enr.rows[0];
  const intel = row.intel as any;
  console.log("Intel:", JSON.stringify(intel, null, 2));

  const datasets = row.datasets as any;
  console.log("\nDatasets keys:", Object.keys(datasets || {}));
  console.log("deployer_identity:", datasets?.deployer_identity?.status);
  console.log("holders:", datasets?.holders?.status);
}

await pool.end();
