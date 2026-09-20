import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Get the latest V2 evals that have enrichment
const latest = await pool.query(`
  SELECT
    ivs.candidate_id,
    ivs.v2_status,
    ivs.v2_confidence,
    ivs.result_json->'suppressionReasons'->>0 as first_reason,
    ivs.computed_at
  FROM intelligence_v2_scores ivs
  WHERE ivs.candidate_id IN (SELECT candidate_id::text FROM onchain_enrichment)
  ORDER BY ivs.computed_at DESC
  LIMIT 10
`);

console.log("=== Latest V2 Evaluations (with enrichment) ===\n");
latest.rows.forEach(r => {
  console.log(`${new Date(r.computed_at).toISOString()}`);
  console.log(`  Candidate: ${r.candidate_id}`);
  console.log(`  Status: ${r.v2_status} (confidence: ${r.v2_confidence}%)`);
  if (r.first_reason) console.log(`  Reason: ${r.first_reason}`);
});

// Now get status distribution for evals with enrichment
const dist = await pool.query(`
  SELECT
    v2_status,
    COUNT(*) as count
  FROM intelligence_v2_scores
  WHERE candidate_id IN (SELECT candidate_id::text FROM onchain_enrichment)
  GROUP BY v2_status
  ORDER BY count DESC
`);

console.log("\n=== Status Distribution (with enrichment) ===");
dist.rows.forEach(r => {
  console.log(`${r.v2_status}: ${r.count}`);
});

await pool.end();
