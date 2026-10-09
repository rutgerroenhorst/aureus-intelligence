import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check how many candidates have enrichment
const enrStats = await pool.query(`
  SELECT
    COUNT(DISTINCT c.id) as total_candidates,
    COUNT(DISTINCT oe.candidate_id) as enriched_candidates
  FROM candidates c
  LEFT JOIN onchain_enrichment oe ON c.id = oe.candidate_id
`);

console.log("Enrichment Statistics:");
console.log(`Total candidates: ${enrStats.rows[0]?.total_candidates}`);
console.log(`Enriched candidates: ${enrStats.rows[0]?.enriched_candidates}`);

// Check if V2 candidates have enrichment
const v2WithEnr = await pool.query(`
  SELECT
    COUNT(DISTINCT ivs.candidate_id::uuid) as v2_evaluated,
    COUNT(DISTINCT CASE WHEN oe.candidate_id IS NOT NULL THEN ivs.candidate_id::uuid END) as with_enrichment
  FROM intelligence_v2_scores ivs
  LEFT JOIN onchain_enrichment oe ON ivs.candidate_id::uuid = oe.candidate_id
`);

console.log("\nV2 Evaluation Status:");
console.log(`Total V2 evaluations: ${v2WithEnr.rows[0]?.v2_evaluated}`);
console.log(`V2 evals with enrichment: ${v2WithEnr.rows[0]?.with_enrichment}`);

// Check a sample V2 eval without enrichment
const noEnr = await pool.query(`
  SELECT
    ivs.candidate_id,
    ivs.result_json->'suppressionReasons'->>0 as first_reason
  FROM intelligence_v2_scores ivs
  WHERE ivs.candidate_id NOT IN (SELECT candidate_id::text FROM onchain_enrichment)
  LIMIT 3
`);

if (noEnr.rows.length > 0) {
  console.log("\nExamples of V2 evals without enrichment:");
  noEnr.rows.forEach(r => {
    console.log(`  ${r.candidate_id}: ${r.first_reason}`);
  });
}

await pool.end();
